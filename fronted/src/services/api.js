import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

class ApiService {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // Upload APIs
  async uploadPDFs(files) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    const response = await this.client.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  // Processing Control APIs
  async startProcessing(ocrWorkers = 5, llmWorkers = 5, stage2QueueSize = null, enableOcrMultiprocessing = null, ocrPageWorkers = null) {
    const payload = {
      ocr_workers: ocrWorkers,
      llm_workers: llmWorkers
    };

    // Add optional settings only if provided
    if (stage2QueueSize !== null) payload.stage2_queue_size = stage2QueueSize;
    if (enableOcrMultiprocessing !== null) payload.enable_ocr_multiprocessing = enableOcrMultiprocessing;
    if (ocrPageWorkers !== null) payload.ocr_page_workers = ocrPageWorkers;

    const response = await this.client.post('/process/start', payload);
    return response.data;
  }

  async stopProcessing() {
    const response = await this.client.post('/process/stop');
    return response.data;
  }

  async getProcessingStats() {
    const response = await this.client.get('/process/stats');
    return response.data;
  }

  async rerunFailedPDFs() {
    const response = await this.client.post('/process/rerun-failed');
    return response.data;
  }

  async downloadFailedPDFs() {
    const response = await this.client.get('/process/download-failed', {
      responseType: 'blob',
    });
    return response.data;
  }

  // Vision Processing APIs
  async startVisionProcessing() {
    const response = await this.client.post('/vision/start');
    return response.data;
  }

  async stopVisionProcessing() {
    const response = await this.client.post('/vision/stop');
    return response.data;
  }

  async getVisionStats() {
    const response = await this.client.get('/vision/stats');
    return response.data;
  }

  // Data Retrieval APIs
  async getDocuments(skip = 0, limit = 100) {
    const response = await this.client.get('/documents', {
      params: { skip, limit },
    });
    return response.data;
  }

  async getDocument(documentId) {
    const response = await this.client.get(`/documents/${documentId}`);
    return response.data;
  }

  async exportToExcel(startIndex = 0, endIndex = null) {
    const params = { start_index: startIndex };
    if (endIndex !== null) {
      params.end_index = endIndex;
    }
    const response = await this.client.get('/export/excel', {
      params,
      responseType: 'blob',
    });
    return response.data;
  }

  // System Info APIs
  async getSystemInfo() {
    const response = await this.client.get('/system/info');
    return response.data;
  }

  async getFolderStats() {
    const response = await this.client.get('/system/folders');
    return response.data;
  }

  async getSystemConfig() {
    const response = await this.client.get('/system/config');
    return response.data;
  }

  // Health Check
  async healthCheck() {
    try {
      const response = await axios.get('http://localhost:8000/health');
      return response.data;
    } catch (error) {
      throw error;
    }
  }
}

export default new ApiService();
