# backend/app/workers/pipeline_processor_v2.py

"""
Pipeline Batch Processor - Version 2

This processor implements true pipeline parallelism with separate worker pools:
- OCR Pool: CPU-intensive tasks (RegFee extraction + Tesseract OCR)
- LLM Pool: I/O-intensive tasks (LLM API calls + Validation + DB save)

Architecture:
  [PDF Files] → [OCR Pool (5 workers)] → [Queue] → [LLM Pool (5 workers)] → [Complete]

Benefits:
- Maximum CPU utilization (OCR workers always busy)
- No blocking during LLM API waits
- True parallelism: 10 PDFs processing simultaneously (5 OCR + 5 LLM)
- Automatic load balancing via queue
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Dict, Callable, Optional
from queue import Queue
from dataclasses import dataclass
import logging
from threading import Lock
from app.config import settings
from app.database import get_db_context

logger = logging.getLogger(__name__)


@dataclass
class Stage1Result:
    """Data structure for passing results from Stage 1 to Stage 2"""
    pdf_path: Path
    document_id: str
    registration_fee: Optional[float]  # From pdfplumber
    new_ocr_reg_fee: Optional[float]  # From OCR text
    ocr_text: str
    status: str
    error: Optional[str] = None


class PipelineBatchProcessor:
    """
    Pipeline processor with separate OCR and LLM worker pools
    """

    def __init__(self, max_ocr_workers: int = None, max_llm_workers: int = None):
        """
        Initialize pipeline processor

        Args:
            max_ocr_workers: Number of OCR workers (default from config)
            max_llm_workers: Number of LLM workers (default from config)
        """
        self.max_ocr_workers = max_ocr_workers or settings.MAX_OCR_WORKERS
        self.max_llm_workers = max_llm_workers or settings.MAX_LLM_WORKERS
        self.is_running = False
        self.lock = Lock()

        self.stats = {
            "total": 0,
            "processed": 0,
            "successful": 0,
            "failed": 0,
            "stopped": 0,
            "ocr_active": 0,      # Currently processing in OCR stage
            "llm_active": 0,      # Currently processing in LLM stage
            "in_queue": 0,        # Waiting in queue between stages
            "current_file": None
        }

        logger.info(
            f"Pipeline Processor V2 initialized: "
            f"{self.max_ocr_workers} OCR workers + "
            f"{self.max_llm_workers} LLM workers + "
            f"Stage-2 Queue Size: {settings.STAGE2_QUEUE_SIZE}"
        )

    def get_stats(self) -> Dict:
        """Get current processing statistics"""
        with self.lock:
            stats = self.stats.copy()
            stats["is_running"] = self.is_running
            stats["active_workers"] = (
                (self.max_ocr_workers + self.max_llm_workers) if self.is_running else 0
            )
            stats["ocr_workers"] = self.max_ocr_workers if self.is_running else 0
            stats["llm_workers"] = self.max_llm_workers if self.is_running else 0
            return stats

    def update_stats(self, **kwargs):
        """Thread-safe stats update"""
        with self.lock:
            self.stats.update(kwargs)

    def process_batch(
        self,
        pdf_files: List[Path],
        stage1_processor,  # PDFProcessor instance for stage 1
        stage2_processor,  # PDFProcessor instance for stage 2
        progress_callback: Callable = None
    ) -> Dict:
        """
        Process PDFs using pipeline parallelism

        Args:
            pdf_files: List of PDF file paths
            stage1_processor: Processor for Stage 1 (OCR)
            stage2_processor: Processor for Stage 2 (LLM)
            progress_callback: Optional callback for progress updates

        Returns:
            Summary of batch processing results
        """
        self.is_running = True
        total_files = len(pdf_files)

        self.update_stats(
            total=total_files,
            processed=0,
            successful=0,
            failed=0,
            stopped=0,
            ocr_active=0,
            llm_active=0,
            in_queue=0,
            current_file=None
        )

        logger.info(
            f"Starting pipeline processing: {total_files} files "
            f"({self.max_ocr_workers} OCR + {self.max_llm_workers} LLM workers)"
        )

        results = []
        # Bounded queue to prevent memory overflow if LLM stage is slower than OCR
        stage2_queue = Queue(maxsize=settings.STAGE2_QUEUE_SIZE)

        try:
            # Create both worker pools
            with ThreadPoolExecutor(max_workers=self.max_ocr_workers) as ocr_executor, \
                 ThreadPoolExecutor(max_workers=self.max_llm_workers) as llm_executor:

                # Submit all PDFs to Stage 1 (OCR)
                stage1_futures = {}
                for pdf_path in pdf_files:
                    future = ocr_executor.submit(
                        self._stage1_ocr,
                        stage1_processor,
                        pdf_path
                    )
                    stage1_futures[future] = pdf_path

                # Process Stage 1 completions and submit to Stage 2
                stage2_futures = {}
                stage1_completed = 0

                for future in as_completed(stage1_futures):
                    if not self.is_running:
                        logger.info("Pipeline processing stopped by user")
                        ocr_executor.shutdown(wait=False)
                        llm_executor.shutdown(wait=False)
                        break

                    pdf_path = stage1_futures[future]

                    try:
                        stage1_result = future.result()
                        stage1_completed += 1

                        logger.info(
                            f"Stage 1 complete ({stage1_completed}/{total_files}): "
                            f"{stage1_result.document_id} - {stage1_result.status}"
                        )

                        if stage1_result.status == "success":
                            # Submit to Stage 2 (LLM)
                            self.update_stats(in_queue=self.stats["in_queue"] + 1)

                            stage2_future = llm_executor.submit(
                                self._stage2_llm,
                                stage2_processor,
                                stage1_result
                            )
                            stage2_futures[stage2_future] = stage1_result

                        else:
                            # Stage 1 failed, record result
                            results.append({
                                "document_id": stage1_result.document_id,
                                "status": stage1_result.status,
                                "error": stage1_result.error,
                                "registration_fee": stage1_result.registration_fee,
                                "llm_extracted": False,
                                "saved_to_db": False
                            })
                            self._update_completion_stats(results[-1], progress_callback)

                    except Exception as e:
                        logger.error(f"Stage 1 exception for {pdf_path.name}: {e}")
                        results.append({
                            "document_id": pdf_path.stem,
                            "status": "failed",
                            "error": f"Stage 1 exception: {str(e)}",
                            "llm_extracted": False,
                            "saved_to_db": False
                        })
                        self._update_completion_stats(results[-1], progress_callback)

                # Wait for all Stage 2 tasks to complete
                for future in as_completed(stage2_futures):
                    if not self.is_running:
                        break

                    stage1_result = stage2_futures[future]

                    try:
                        stage2_result = future.result()
                        results.append(stage2_result)

                        logger.info(
                            f"Stage 2 complete: {stage2_result['document_id']} - "
                            f"{stage2_result['status']}"
                        )

                        self._update_completion_stats(stage2_result, progress_callback)

                    except Exception as e:
                        logger.error(
                            f"Stage 2 exception for {stage1_result.document_id}: {e}"
                        )
                        results.append({
                            "document_id": stage1_result.document_id,
                            "status": "failed",
                            "error": f"Stage 2 exception: {str(e)}",
                            "registration_fee": stage1_result.registration_fee,
                            "llm_extracted": False,
                            "saved_to_db": False
                        })
                        self._update_completion_stats(results[-1], progress_callback)

        finally:
            self.is_running = False

        # Summary
        summary = {
            "total": total_files,
            "processed": self.stats["processed"],
            "successful": self.stats["successful"],
            "failed": self.stats["failed"],
            "stopped": self.stats["stopped"],
            "results": results
        }

        logger.info(
            f"Pipeline processing completed: {summary['successful']}/{summary['total']} successful"
        )

        return summary

    def _stage1_ocr(self, processor, pdf_path: Path) -> Stage1Result:
        """
        Stage 1: CPU-intensive processing (RegFee + OCR)
        """
        self.update_stats(
            ocr_active=self.stats["ocr_active"] + 1,
            current_file=pdf_path.name
        )

        try:
            with get_db_context() as db:
                result = processor.process_stage1_ocr(pdf_path, db)
                return result

        finally:
            self.update_stats(ocr_active=self.stats["ocr_active"] - 1)

    def _stage2_llm(self, processor, stage1_result: Stage1Result) -> Dict:
        """
        Stage 2: I/O-intensive processing (LLM + Validation + DB)
        """
        self.update_stats(
            llm_active=self.stats["llm_active"] + 1,
            in_queue=self.stats["in_queue"] - 1,
            current_file=stage1_result.document_id
        )

        try:
            with get_db_context() as db:
                result = processor.process_stage2_llm(stage1_result, db)
                return result

        finally:
            self.update_stats(llm_active=self.stats["llm_active"] - 1)

    def _update_completion_stats(self, result: Dict, callback: Callable):
        """Update completion statistics"""
        processed = self.stats["processed"] + 1
        successful = self.stats["successful"] + (1 if result["status"] == "success" else 0)
        failed = self.stats["failed"] + (1 if result["status"] == "failed" else 0)
        stopped = self.stats["stopped"] + (1 if result["status"] == "stopped" else 0)

        self.update_stats(
            processed=processed,
            successful=successful,
            failed=failed,
            stopped=stopped
        )

        if callback:
            callback(processed, self.stats["total"], result)

    def stop(self):
        """Stop pipeline processing"""
        logger.info("Stopping pipeline processor...")
        self.is_running = False
