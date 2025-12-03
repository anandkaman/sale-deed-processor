# backend/app/services/ocr_service.py

import pytesseract
from pdf2image import convert_from_path
from PIL import Image
from typing import List, Dict, Optional
import logging
from multiprocessing import Pool
from functools import partial
from app.config import settings

logger = logging.getLogger(__name__)

class OCRService:
    def __init__(
        self,
        lang: str = None,
        oem: int = None,
        psm: int = None,
        poppler_path: str = None,
        dpi: int = None
    ):
        """
        Initialize OCR service
        
        Args:
            lang: Tesseract language (default from config)
            oem: OCR Engine Mode (default from config)
            psm: Page Segmentation Mode (default from config)
            poppler_path: Path to Poppler binaries (default from config)
            dpi: DPI for PDF conversion (default from config)
        """
        self.lang = lang or settings.TESSERACT_LANG
        self.oem = oem or settings.TESSERACT_OEM
        self.psm = psm or settings.TESSERACT_PSM
        self.poppler_path = poppler_path or settings.POPPLER_PATH
        self.dpi = dpi or settings.POPPLER_DPI
        
        self.tesseract_config = f'--oem {self.oem} --psm {self.psm}'
        logger.info(
            f"OCR Service initialized: lang={self.lang}, oem={self.oem}, psm={self.psm}, dpi={self.dpi}, "
            f"multiprocessing={'enabled' if settings.ENABLE_OCR_MULTIPROCESSING else 'disabled'}"
        )
    
    def pdf_to_images(self, pdf_path: str, max_pages: Optional[int] = None) -> List[Image.Image]:
        """
        Convert PDF to list of images using Poppler

        Args:
            pdf_path: Path to PDF file
            max_pages: Maximum number of pages to convert (default: None = all pages)

        Returns:
            List of PIL Image objects
        """
        try:
            images = convert_from_path(
                pdf_path,
                dpi=self.dpi,
                poppler_path=self.poppler_path if self.poppler_path else None,
                last_page=max_pages  # Poppler stops at this page
            )
            logger.info(f"Converted PDF to {len(images)} images: {pdf_path}")
            return images
        except Exception as e:
            logger.error(f"Error converting PDF to images: {e}")
            raise
    
    def ocr_image(self, image: Image.Image, page_num: int) -> Dict:
        """
        Perform OCR on a single image

        Args:
            image: PIL Image object
            page_num: Page number (for reference)

        Returns:
            Dictionary with page_num and extracted text
        """
        try:
            text = pytesseract.image_to_string(
                image,
                lang=self.lang,
                config=self.tesseract_config
            )
            logger.debug(f"OCR completed for page {page_num}: {len(text)} characters")
            return {
                "page_num": page_num,
                "text": text.strip()
            }
        except Exception as e:
            logger.error(f"OCR error on page {page_num}: {e}")
            return {
                "page_num": page_num,
                "text": "",
                "error": str(e)
            }

    @staticmethod
    def _ocr_image_static(args: tuple) -> Dict:
        """
        Static method for multiprocessing OCR on a single image

        Args:
            args: Tuple of (image, page_num, lang, tesseract_config)

        Returns:
            Dictionary with page_num and extracted text
        """
        image, page_num, lang, tesseract_config = args
        try:
            text = pytesseract.image_to_string(
                image,
                lang=lang,
                config=tesseract_config
            )
            return {
                "page_num": page_num,
                "text": text.strip()
            }
        except Exception as e:
            logger.error(f"OCR error on page {page_num}: {e}")
            return {
                "page_num": page_num,
                "text": "",
                "error": str(e)
            }
    
    def ocr_pdf(self, pdf_path: str, max_pages: int = 25) -> List[Dict]:
        """
        Perform OCR on entire PDF (limited to max_pages)
        Uses multiprocessing if ENABLE_OCR_MULTIPROCESSING is True

        Args:
            pdf_path: Path to PDF file
            max_pages: Maximum pages to process (default: 25)

        Returns:
            List of dictionaries with page_num and text for each page
        """
        try:
            images = self.pdf_to_images(pdf_path, max_pages=max_pages)

            # Use multiprocessing if enabled and we have multiple pages
            if settings.ENABLE_OCR_MULTIPROCESSING and len(images) > 1:
                results = self._ocr_pdf_multiprocess(images)
            else:
                # Sequential processing (original behavior)
                results = []
                for idx, image in enumerate(images, start=1):
                    result = self.ocr_image(image, idx)
                    results.append(result)

            logger.info(
                f"OCR completed for {pdf_path}: {len(results)} pages processed "
                f"(max: {max_pages}, mode: {'parallel' if settings.ENABLE_OCR_MULTIPROCESSING and len(images) > 1 else 'sequential'})"
            )
            return results

        except Exception as e:
            logger.error(f"Error in OCR PDF processing: {e}")
            raise

    def _ocr_pdf_multiprocess(self, images: List[Image.Image]) -> List[Dict]:
        """
        Process OCR using multiprocessing for faster page-level parallelism

        Args:
            images: List of PIL Image objects

        Returns:
            List of dictionaries with page_num and text for each page
        """
        num_workers = min(settings.OCR_PAGE_WORKERS, len(images))

        # Prepare arguments for each page
        ocr_args = [
            (image, idx, self.lang, self.tesseract_config)
            for idx, image in enumerate(images, start=1)
        ]

        try:
            with Pool(processes=num_workers) as pool:
                results = pool.map(self._ocr_image_static, ocr_args, chunksize=1)

            logger.debug(f"Multiprocessing OCR completed: {len(results)} pages with {num_workers} workers")
            return results

        except Exception as e:
            logger.error(f"Error in multiprocessing OCR: {e}, falling back to sequential")
            # Fallback to sequential processing
            results = []
            for idx, image in enumerate(images, start=1):
                result = self.ocr_image(image, idx)
                results.append(result)
            return results
    
    def get_full_text(self, pdf_path: str, max_pages: int = 25) -> str:
        """
        Get complete OCR text from PDF with page markers (limited to max_pages)

        Args:
            pdf_path: Path to PDF file
            max_pages: Maximum pages to process (default: 25)

        Returns:
            Complete text with page markers
        """
        results = self.ocr_pdf(pdf_path, max_pages=max_pages)
        full_text = ""

        for result in results:
            page_num = result.get("page_num", 0)
            text = result.get("text", "")
            full_text += f"\n\n--- Page {page_num} ---\n\n{text}"

        return full_text.strip()