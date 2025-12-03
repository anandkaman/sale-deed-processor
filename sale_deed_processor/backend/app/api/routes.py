# backend/app/api/routes.py

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import pandas as pd
import io
from pathlib import Path
import shutil
import logging
import zipfile
from datetime import datetime

from app.database import get_db
from app.schemas import (
    DocumentDetailSchema,
    ProcessingStatsSchema,
    SystemInfoSchema,
    BatchResultSchema
)

# Request models
class StartProcessingRequest(BaseModel):
    max_workers: int = 2          # For legacy mode or total workers
    ocr_workers: Optional[int] = None  # For pipeline mode
    llm_workers: Optional[int] = None  # For pipeline mode
    stage2_queue_size: Optional[int] = None  # Bounded queue size for Stage-2
    enable_ocr_multiprocessing: Optional[bool] = None  # Enable OCR multiprocessing
    ocr_page_workers: Optional[int] = None  # OCR page-level workers
from app.models import DocumentDetail, PropertyDetail, BuyerDetail, SellerDetail
from app.utils.file_handler import FileHandler
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize processors based on pipeline mode
if settings.ENABLE_PIPELINE:
    # Version 2: Pipeline mode
    from app.workers.pipeline_processor_v2 import PipelineBatchProcessor
    from app.services.pdf_processor_v2 import PDFProcessorV2

    pipeline_processor = PipelineBatchProcessor(
        max_ocr_workers=settings.MAX_OCR_WORKERS,
        max_llm_workers=settings.MAX_LLM_WORKERS
    )
    pdf_processor_v2 = PDFProcessorV2(batch_processor=pipeline_processor)
    batch_processor = pipeline_processor  # For compatibility
    logger.info("API initialized with Pipeline Processor V2")
else:
    # Version 1: Legacy mode
    from app.workers.batch_processor import BatchProcessor
    from app.services.pdf_processor import PDFProcessor

    batch_processor = BatchProcessor()
    pdf_processor = PDFProcessor(batch_processor=batch_processor)
    logger.info("API initialized with Legacy Batch Processor V1")

# Vision processor (same for both versions)
from app.workers.vision_batch_processor import VisionBatchProcessor
vision_batch_processor = VisionBatchProcessor()

# ==================== UPLOAD ENDPOINTS ====================

@router.post("/upload", response_model=dict)
async def upload_pdfs(files: List[UploadFile] = File(...)):
    """Upload PDF files to newly_uploaded folder"""
    try:
        uploaded_files = []
        
        for file in files:
            if not file.filename.endswith('.pdf'):
                continue
            
            file_path = settings.NEWLY_UPLOADED_DIR / file.filename
            
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            uploaded_files.append(file.filename)
            logger.info(f"Uploaded: {file.filename}")
        
        return {
            "success": True,
            "uploaded_count": len(uploaded_files),
            "files": uploaded_files
        }
    
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== PROCESSING ENDPOINTS ====================

@router.post("/process/start", response_model=dict)
async def start_batch_processing(background_tasks: BackgroundTasks, request: StartProcessingRequest = StartProcessingRequest()):
    """Start PDF batch processing with configurable worker count (supports both V1 and V2)"""
    try:
        if batch_processor.is_running:
            raise HTTPException(status_code=400, detail="Batch processing already running")

        pdf_files = FileHandler.get_pdf_files(settings.NEWLY_UPLOADED_DIR)

        if not pdf_files:
            return {
                "success": False,
                "message": "No PDF files found in newly_uploaded folder"
            }

        if settings.ENABLE_PIPELINE:
            # Pipeline Mode (V2): Separate OCR and LLM workers
            ocr_workers = request.ocr_workers if request.ocr_workers is not None else settings.MAX_OCR_WORKERS
            llm_workers = request.llm_workers if request.llm_workers is not None else settings.MAX_LLM_WORKERS

            # Handle new settings (apply runtime overrides)
            if request.stage2_queue_size is not None:
                if request.stage2_queue_size < 1 or request.stage2_queue_size > 10:
                    raise HTTPException(status_code=400, detail="stage2_queue_size must be between 1 and 10")
                settings.STAGE2_QUEUE_SIZE = request.stage2_queue_size

            if request.enable_ocr_multiprocessing is not None:
                settings.ENABLE_OCR_MULTIPROCESSING = request.enable_ocr_multiprocessing

            if request.ocr_page_workers is not None:
                if request.ocr_page_workers < 1 or request.ocr_page_workers > 8:
                    raise HTTPException(status_code=400, detail="ocr_page_workers must be between 1 and 8")
                settings.OCR_PAGE_WORKERS = request.ocr_page_workers

            # Validate worker counts (1-20)
            if ocr_workers < 1 or ocr_workers > 20:
                raise HTTPException(status_code=400, detail="ocr_workers must be between 1 and 20")
            if llm_workers < 1 or llm_workers > 20:
                raise HTTPException(status_code=400, detail="llm_workers must be between 1 and 20")

            # Update pipeline processor
            pipeline_processor.max_ocr_workers = ocr_workers
            pipeline_processor.max_llm_workers = llm_workers

            logger.info(
                f"Starting pipeline processing: {ocr_workers} OCR + {llm_workers} LLM workers, "
                f"Queue size: {settings.STAGE2_QUEUE_SIZE}, "
                f"OCR multiprocessing: {settings.ENABLE_OCR_MULTIPROCESSING}, "
                f"OCR page workers: {settings.OCR_PAGE_WORKERS}"
            )

            # Start pipeline processing
            background_tasks.add_task(
                pipeline_processor.process_batch,
                pdf_files,
                pdf_processor_v2,  # Stage 1 processor
                pdf_processor_v2   # Stage 2 processor
            )

            return {
                "success": True,
                "message": f"Started processing {len(pdf_files)} PDFs with {ocr_workers} OCR + {llm_workers} LLM workers",
                "total_files": len(pdf_files),
                "ocr_workers": ocr_workers,
                "llm_workers": llm_workers,
                "stage2_queue_size": settings.STAGE2_QUEUE_SIZE,
                "enable_ocr_multiprocessing": settings.ENABLE_OCR_MULTIPROCESSING,
                "ocr_page_workers": settings.OCR_PAGE_WORKERS,
                "pipeline_mode": True
            }

        else:
            # Legacy Mode (V1): Single worker pool
            max_workers = request.max_workers

            # Validate max_workers range (1-20)
            if max_workers < 1 or max_workers > 20:
                raise HTTPException(status_code=400, detail="max_workers must be between 1 and 20")

            batch_processor.max_workers = max_workers
            logger.info(f"Starting batch processing with {max_workers} workers")

            # Start processing in background
            background_tasks.add_task(
                batch_processor.process_batch,
                pdf_files,
                pdf_processor.process_single_pdf
            )

            return {
                "success": True,
                "message": f"Started processing {len(pdf_files)} PDFs with {max_workers} workers",
                "total_files": len(pdf_files),
                "max_workers": max_workers,
                "pipeline_mode": False
            }

    except Exception as e:
        logger.error(f"Start processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/process/stop", response_model=dict)
async def stop_batch_processing():
    """Stop PDF OCR batch processing (completes current tasks)"""
    try:
        if not batch_processor.is_running:
            return {
                "success": False,
                "message": "No batch processing is running"
            }

        batch_processor.stop()

        # Get stats to calculate how many might be stopped
        stats = batch_processor.get_stats()
        remaining = stats.get("total", 0) - stats.get("processed", 0)

        return {
            "success": True,
            "message": f"Processing stopped. {remaining} PDF(s) remaining in newly uploaded folder.",
            "stopped_count": remaining
        }

    except Exception as e:
        logger.error(f"Stop processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/process/stats", response_model=ProcessingStatsSchema)
async def get_processing_stats():
    """Get current processing statistics"""
    return batch_processor.get_stats()

@router.post("/process/rerun-failed", response_model=dict)
async def rerun_failed_pdfs():
    """Move all PDFs from failed folder back to newly_uploaded folder for reprocessing"""
    try:
        failed_dir = settings.FAILED_DIR
        newly_uploaded_dir = settings.NEWLY_UPLOADED_DIR

        failed_files = list(failed_dir.glob("*.pdf"))

        if not failed_files:
            return {
                "success": False,
                "message": "No failed PDFs to rerun"
            }

        moved_count = 0
        for pdf_file in failed_files:
            dest_path = newly_uploaded_dir / pdf_file.name
            shutil.move(str(pdf_file), str(dest_path))
            moved_count += 1
            logger.info(f"Moved {pdf_file.name} from failed to newly_uploaded")

        return {
            "success": True,
            "message": f"Moved {moved_count} failed PDFs back to newly_uploaded folder",
            "moved_count": moved_count
        }

    except Exception as e:
        logger.error(f"Rerun failed PDFs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/process/download-failed")
async def download_failed_pdfs():
    """Download all failed PDFs as a ZIP file"""
    try:
        failed_dir = settings.FAILED_DIR
        failed_files = list(failed_dir.glob("*.pdf"))

        if not failed_files:
            raise HTTPException(status_code=404, detail="No failed PDFs found")

        # Create ZIP in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for pdf_file in failed_files:
                zip_file.write(pdf_file, pdf_file.name)
                logger.info(f"Added {pdf_file.name} to ZIP")

        zip_buffer.seek(0)

        filename = f"failed_pdfs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        logger.error(f"Download failed PDFs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== VISION PROCESSING ENDPOINTS ====================

@router.post("/vision/start", response_model=dict)
async def start_vision_processing(background_tasks: BackgroundTasks):
    """Start vision model batch processing for registration fee tables"""
    try:
        if vision_batch_processor.is_running:
            raise HTTPException(status_code=400, detail="Vision processing already running")
        
        # Start processing in background
        background_tasks.add_task(vision_batch_processor.process_batch)
        
        return {
            "success": True,
            "message": "Started vision processing for registration fee extraction"
        }
    
    except Exception as e:
        logger.error(f"Start vision processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/vision/stop", response_model=dict)
async def stop_vision_processing():
    """Stop vision batch processing"""
    try:
        if not vision_batch_processor.is_running:
            return {
                "success": False,
                "message": "No vision processing is running"
            }

        vision_batch_processor.stop()

        # Get stats
        stats = vision_batch_processor.get_stats()
        remaining = stats.get("total", 0) - stats.get("processed", 0)

        return {
            "success": True,
            "message": f"Vision processing stopped. {remaining} image(s) remaining in left over reg fee folder.",
            "stopped_count": remaining
        }

    except Exception as e:
        logger.error(f"Stop vision processing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/vision/stats", response_model=ProcessingStatsSchema)
async def get_vision_stats():
    """Get vision processing statistics"""
    return vision_batch_processor.get_stats()

# ==================== DATA RETRIEVAL ENDPOINTS ====================

@router.get("/documents", response_model=List[DocumentDetailSchema])
async def get_all_documents(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all documents with pagination"""
    documents = db.query(DocumentDetail).offset(skip).limit(limit).all()
    return documents

@router.get("/documents/{document_id}", response_model=DocumentDetailSchema)
async def get_document(document_id: str, db: Session = Depends(get_db)):
    """Get specific document by ID"""
    document = db.query(DocumentDetail).filter(
        DocumentDetail.document_id == document_id
    ).first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return document

def format_number(value):
    """Format number to remove unnecessary decimals"""
    if value is None:
        return None
    # If it's a whole number, convert to int, otherwise keep as float
    if isinstance(value, (int, float)) and value % 1 == 0:
        return int(value)
    return value

@router.get("/export/excel")
async def export_to_excel(
    start_index: int = 0,
    end_index: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Export data to Excel file"""
    try:
        query = db.query(DocumentDetail).offset(start_index)

        if end_index:
            query = query.limit(end_index - start_index)

        documents = query.all()

        # Prepare data for Excel with new format
        rows = []
        serial_number = 1

        for doc in documents:
            # Prepare property data
            prop = doc.property_details

            # Create Schedule C address with property name
            sched_c_address = ''
            if prop:
                parts = []
                if prop.schedule_c_property_address:
                    parts.append(prop.schedule_c_property_address)
                if prop.schedule_c_property_name:
                    parts.append(prop.schedule_c_property_name)
                sched_c_address = ', '.join(parts) if parts else None

            base_row = {
                "SL_NO": serial_number,
                "Document_ID": doc.document_id,
                "Schedule_B_Area_sqft": format_number(prop.schedule_b_area) if prop else None,
                "Schedule_C_Area_sqft": format_number(prop.schedule_c_property_area) if prop else None,
                "Schedule_C_Address_Name": sched_c_address,
                "Property_Pincode": prop.pincode if prop else None,
                "Property_State": prop.state if prop else None,
                "Sale_Consideration": format_number(prop.sale_consideration) if prop else None,
                "Stamp_Duty_Fee": format_number(prop.stamp_duty_fee) if prop else None,
                "Registration_Fee": format_number(prop.registration_fee) if prop else None,
                "Guidance_Value": format_number(prop.guidance_value) if prop else None,
                "Cash_Payment": prop.paid_in_cash_mode if prop else None,
                "Transaction_Date": doc.transaction_date,
                "Registration_Office": doc.registration_office
            }

            # Add sellers first (USER_TYPE = S)
            for seller in doc.sellers:
                row = base_row.copy()
                row.update({
                    "USER_TYPE": "S",
                    "Name": seller.name,
                    "Gender": seller.gender,
                    "Aadhaar": seller.aadhaar_number,
                    "PAN": seller.pan_card_number,
                    "Address": seller.address,
                    "Pincode": seller.pincode,
                    "State": seller.state,
                    "Phone": seller.phone_number,
                    "Secondary_Phone": seller.secondary_phone_number,
                    "Email": seller.email,
                    "Property_Share": seller.property_share
                })
                rows.append(row)

            # Add buyers (USER_TYPE = B)
            for buyer in doc.buyers:
                row = base_row.copy()
                row.update({
                    "USER_TYPE": "B",
                    "Name": buyer.name,
                    "Gender": buyer.gender,
                    "Aadhaar": buyer.aadhaar_number,
                    "PAN": buyer.pan_card_number,
                    "Address": buyer.address,
                    "Pincode": buyer.pincode,
                    "State": buyer.state,
                    "Phone": buyer.phone_number,
                    "Secondary_Phone": buyer.secondary_phone_number,
                    "Email": buyer.email,
                    "Property_Share": None
                })
                rows.append(row)

            serial_number += 1
        
        df = pd.DataFrame(rows)

        # Reorder columns to match desired format
        column_order = [
            "SL_NO", "USER_TYPE", "Document_ID",
            "Schedule_B_Area_sqft", "Schedule_C_Area_sqft", "Schedule_C_Address_Name",
            "Property_Pincode", "Property_State",
            "Sale_Consideration", "Stamp_Duty_Fee", "Registration_Fee", "Guidance_Value",
            "Cash_Payment", "Transaction_Date", "Registration_Office",
            "Name", "Gender", "Aadhaar", "PAN", "Address", "Pincode", "State",
            "Phone", "Secondary_Phone", "Email", "Property_Share"
        ]
        df = df[column_order]

        # Create Excel file in memory
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Sale_Deeds')
        
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=sale_deeds_export.xlsx"}
        )
    
    except Exception as e:
        logger.error(f"Export error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==================== SYSTEM INFO ENDPOINTS ====================

@router.get("/system/info", response_model=SystemInfoSchema)
async def get_system_info():
    """Get system information and health status"""
    import torch
    import subprocess
    
    # Check CUDA
    cuda_available = torch.cuda.is_available()
    cuda_count = torch.cuda.device_count() if cuda_available else 0
    
    # Check Poppler
    try:
        subprocess.run(["pdfinfo", "-v"], capture_output=True, timeout=5)
        poppler_available = True
    except:
        poppler_available = False
    
    # Check Tesseract
    try:
        subprocess.run(["tesseract", "--version"], capture_output=True, timeout=5)
        tesseract_available = True
    except:
        tesseract_available = False
    
    # Check Ollama (use correct processor based on pipeline mode)
    if settings.ENABLE_PIPELINE:
        ollama_connected = pdf_processor_v2.llm_service.check_connection()
    else:
        ollama_connected = pdf_processor.llm_service.check_connection()
    
    # Check YOLO model
    yolo_model_loaded = settings.YOLO_MODEL_PATH.exists()
    
    return {
        "cuda_available": cuda_available,
        "cuda_device_count": cuda_count,
        "poppler_available": poppler_available,
        "tesseract_available": tesseract_available,
        "ollama_connected": ollama_connected,
        "yolo_model_loaded": yolo_model_loaded
    }

@router.get("/system/config", response_model=dict)
async def get_system_config():
    """Get current pipeline and OCR configuration settings"""
    return {
        "enable_pipeline": settings.ENABLE_PIPELINE,
        "max_ocr_workers": settings.MAX_OCR_WORKERS,
        "max_llm_workers": settings.MAX_LLM_WORKERS,
        "stage2_queue_size": settings.STAGE2_QUEUE_SIZE,
        "enable_ocr_multiprocessing": settings.ENABLE_OCR_MULTIPROCESSING,
        "ocr_page_workers": settings.OCR_PAGE_WORKERS,
        "max_workers": settings.MAX_WORKERS,  # Legacy mode
        "llm_backend": settings.LLM_BACKEND,
        "tesseract_lang": settings.TESSERACT_LANG,
        "poppler_dpi": settings.POPPLER_DPI
    }

@router.get("/system/folders", response_model=dict)
async def get_folder_stats():
    """Get file counts in each folder"""
    return {
        "newly_uploaded": len(list(settings.NEWLY_UPLOADED_DIR.glob("*.pdf"))),
        "processed": len(list(settings.PROCESSED_DIR.glob("*.pdf"))),
        "failed": len(list(settings.FAILED_DIR.glob("*.pdf"))),
        "left_over_reg_fee": len(list(settings.LEFT_OVER_REG_FEE_DIR.glob("*.png"))) +
                             len(list(settings.LEFT_OVER_REG_FEE_DIR.glob("*.jpg")))
    }