# backend/app/config.py

import os
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Application
    APP_NAME: str = "Sale Deed Processor"
    DEBUG: bool = True
    
    # Database
    DATABASE_URL: str = "postgresql://postgres:admin@localhost:5432/sale_deed_db"
    
    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    NEWLY_UPLOADED_DIR: Path = DATA_DIR / "newly_uploaded"
    PROCESSED_DIR: Path = DATA_DIR / "processed"
    FAILED_DIR: Path = DATA_DIR / "failed"
    LEFT_OVER_REG_FEE_DIR: Path = DATA_DIR / "left_over_reg_fee"
    VISION_FAILED_DIR: Path = DATA_DIR / "vision_failed"
    MODELS_DIR: Path = BASE_DIR / "models"
    
    # YOLO Model
    YOLO_MODEL_PATH: Path = MODELS_DIR / "table1.19.1.onnx"
    YOLO_CONF_THRESHOLD: float = 0.80
    
    # Tesseract
    TESSERACT_LANG: str = "eng+kan"
    TESSERACT_OEM: int = 1
    TESSERACT_PSM: int = 4
    
    # Poppler
    POPPLER_PATH: str = r"C:\Program Files\poppler\Library\bin"  # Update for your system
    POPPLER_DPI: int = 300
    
    # LLM Backend Configuration
    # Available backends: "ollama", "llamacpp", "vllm", "groq", "gemini"
    LLM_BACKEND: str = "gemini"  # Primary backend to use

    # Ollama Configuration
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_LLM_MODEL: str = "qwen2.5:3b-instruct"
    OLLAMA_VISION_MODEL: str = "qwen3-vl:4b"

    # llama.cpp Configuration
    USE_LLAMACPP: bool = False
    LLAMACPP_BASE_URL: str = "http://localhost:8080"
    LLAMACPP_LLM_MODEL: str = "qwen2.5-3b-instruct"
    LLAMACPP_VISION_MODEL: str = "qwen3-vl-4b"

    # vLLM Configuration (Production - High Performance)
    USE_VLLM: bool = False
    VLLM_BASE_URL: str = "http://localhost:8000"
    VLLM_LLM_MODEL: str = "Qwen/Qwen2.5-3B-Instruct"
    VLLM_VISION_MODEL: str = "Qwen/Qwen3-VL-4B"

    # Groq Configuration (Cloud API)
    USE_GROQ: bool = False
    GROQ_API_KEY: str = ""  # Add your Groq API key here or set via environment variable
    GROQ_MODEL: str = "meta-llama/llama-4-scout-17b-16e-instruct"

    # Gemini Configuration (Google Cloud API)
    USE_GEMINI: bool = True
    GEMINI_API_KEY: str = "AIzaSyBA6vJhyqYp1dZ92A4MphoqOxxCIo7MVfc"  # Add your Gemini API key here or set via environment variable
    GEMINI_MODEL: str = "gemini-2.5-flash-lite"
    GEMINI_VISION_MODEL: str = "gemini-2.5-flash-lite"  # Gemini Flash Lite supports vision

    # LLM General Settings
    LLM_TEMPERATURE: float = 0.6
    LLM_MAX_TOKENS: int = 4096
    LLM_TIMEOUT: int = 300

    # Pipeline Processing (Version 2)
    ENABLE_PIPELINE: bool = True  # Enable pipeline parallelism
    MAX_OCR_WORKERS: int = 5      # CPU-intensive workers (OCR/Tesseract)
    MAX_LLM_WORKERS: int = 5      # I/O-intensive workers (LLM API calls)
    STAGE2_QUEUE_SIZE: int = 2    # Max documents waiting between OCR and LLM stages (bounded queue)

    # OCR Multiprocessing (Per-PDF page-level parallelism)
    ENABLE_OCR_MULTIPROCESSING: bool = True  # Enable multiprocessing for OCR pages
    OCR_PAGE_WORKERS: int = 2     # Number of parallel workers per PDF (2-4 recommended, keep low to avoid CPU thrashing)

    # OCR Registration Fee Extraction (Backup extraction from OCR text)
    ENABLE_OCR_REG_FEE_EXTRACTION: bool = False  # Enable extraction of registration fee from OCR text (fallback when pdfplumber fails)

    # Embedded OCR Mode (PyMuPDF)
    USE_EMBEDDED_OCR: bool = False  # Enable PyMuPDF to read embedded OCR instead of Poppler+Tesseract

    # Legacy Processing (Version 1)
    MAX_WORKERS: int = 2          # Used only if ENABLE_PIPELINE = False
    BATCH_SIZE: int = 10
    
    # Validation
    MIN_REGISTRATION_FEE: float = 4000.0
    MAX_MISC_FEE: float = 4000.0
    
    class Config:
        env_file = ".env"
        case_sensitive = True

    def create_directories(self):
        """Create necessary directories if they don't exist"""
        for dir_path in [
            self.DATA_DIR,
            self.NEWLY_UPLOADED_DIR,
            self.PROCESSED_DIR,
            self.FAILED_DIR,
            self.LEFT_OVER_REG_FEE_DIR,
            self.VISION_FAILED_DIR,
            self.MODELS_DIR
        ]:
            dir_path.mkdir(parents=True, exist_ok=True)

settings = Settings()
settings.create_directories()