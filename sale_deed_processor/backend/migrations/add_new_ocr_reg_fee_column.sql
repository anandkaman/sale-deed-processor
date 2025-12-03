-- Migration: Add new_ocr_reg_fee column to property_details table
-- Date: 2025-11-30
-- Description: Adds a new column to store registration fee extracted from OCR text

-- Add the new column
ALTER TABLE property_details
ADD COLUMN new_ocr_reg_fee VARCHAR;

-- Add comment to the column
COMMENT ON COLUMN property_details.new_ocr_reg_fee IS 'Registration fee extracted from OCR text during Stage 1 processing';
