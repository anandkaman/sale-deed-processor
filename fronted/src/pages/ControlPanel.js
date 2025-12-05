import React, { useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Play,
  Square,
  Eye,
  Download,
  FileText,
  Loader,
  AlertCircle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import api from '../services/api';
import '../styles/ControlPanel.css';

const ControlPanel = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [processingStats, setProcessingStats] = useState(null);
  const [visionStats, setVisionStats] = useState(null);
  const [folderStats, setFolderStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [workerCount, setWorkerCount] = useState(2); // Default: 2 workers (legacy)
  const [ocrWorkers, setOcrWorkers] = useState(5);  // OCR workers
  const [llmWorkers, setLlmWorkers] = useState(5);  // LLM workers
  const [stage2QueueSize, setStage2QueueSize] = useState(2);  // Stage-2 queue size
  const [enableOcrMultiprocessing, setEnableOcrMultiprocessing] = useState(false);  // OCR multiprocessing
  const [ocrPageWorkers, setOcrPageWorkers] = useState(2);  // OCR page workers
  const [useEmbeddedOcr, setUseEmbeddedOcr] = useState(false);  // Embedded OCR mode
  const [systemConfig, setSystemConfig] = useState(null);  // System configuration

  // Manual tracking for stop button states (always enabled once started)
  const [isPdfProcessingActive, setIsPdfProcessingActive] = useState(false);
  const [isVisionProcessingActive, setIsVisionProcessingActive] = useState(false);

  // Define callback functions first
  const fetchStats = useCallback(async () => {
    try {
      const [procStats, visStats, fStats] = await Promise.all([
        api.getProcessingStats().catch(() => null),
        api.getVisionStats().catch(() => null),
        api.getFolderStats().catch(() => null),
      ]);
      setProcessingStats(procStats);
      setVisionStats(visStats);
      setFolderStats(fStats);

      // Update manual tracking based on backend status
      if (procStats && !procStats.is_running && isPdfProcessingActive) {
        setIsPdfProcessingActive(false);
      }
      if (visStats && !visStats.is_running && isVisionProcessingActive) {
        setIsVisionProcessingActive(false);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, [isPdfProcessingActive, isVisionProcessingActive]);

  const fetchSystemConfig = useCallback(async () => {
    try {
      const sysConfig = await api.getSystemConfig();
      if (sysConfig) {
        setSystemConfig(sysConfig);
        setOcrWorkers(sysConfig.max_ocr_workers || 5);
        setLlmWorkers(sysConfig.max_llm_workers || 5);
        setStage2QueueSize(sysConfig.stage2_queue_size || 2);
        setEnableOcrMultiprocessing(sysConfig.enable_ocr_multiprocessing || false);
        setOcrPageWorkers(sysConfig.ocr_page_workers || 2);
        setUseEmbeddedOcr(sysConfig.use_embedded_ocr || false);
      }
    } catch (err) {
      console.error('Error fetching system config:', err);
    }
  }, []);

  const fetchActiveStats = useCallback(async () => {
    try {
      const [procStats, visStats] = await Promise.all([
        api.getProcessingStats().catch(() => null),
        api.getVisionStats().catch(() => null),
      ]);
      if (procStats) {
        setProcessingStats(procStats);
        // Auto-disable stop button when backend reports not running
        if (!procStats.is_running && isPdfProcessingActive) {
          setIsPdfProcessingActive(false);
        }
      }
      if (visStats) {
        setVisionStats(visStats);
        // Auto-disable stop button when backend reports not running
        if (!visStats.is_running && isVisionProcessingActive) {
          setIsVisionProcessingActive(false);
        }
      }
    } catch (err) {
      console.error('Error fetching active stats:', err);
    }
  }, [isPdfProcessingActive, isVisionProcessingActive]);

  const fetchFolderStats = useCallback(async () => {
    try {
      const fStats = await api.getFolderStats().catch(() => null);
      if (fStats) setFolderStats(fStats);
    } catch (err) {
      console.error('Error fetching folder stats:', err);
    }
  }, []);

  // Initial fetch - load system config only once
  useEffect(() => {
    fetchSystemConfig();
  }, [fetchSystemConfig]);

  // Initial stats fetch
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Polling - only when processing is active
  useEffect(() => {
    const isPdfProcessing = processingStats?.is_running || isPdfProcessingActive;
    const isVisionProcessing = visionStats?.is_running || isVisionProcessingActive;

    if (isPdfProcessing || isVisionProcessing) {
      // Immediate fetch
      fetchActiveStats();

      // Poll active stats every 5 seconds while processing
      const activeStatsInterval = setInterval(fetchActiveStats, 5000);

      return () => {
        clearInterval(activeStatsInterval);
      };
    }
    // No polling when idle - stats are only fetched on user actions
  }, [processingStats?.is_running, visionStats?.is_running, isPdfProcessingActive, isVisionProcessingActive, fetchActiveStats]);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files).filter((file) =>
      file.name.toLowerCase().endsWith('.pdf')
    );
    setSelectedFiles(files);
    setUploadStatus(null);
    setError(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
      file.name.toLowerCase().endsWith('.pdf')
    );

    if (droppedFiles.length > 0) {
      setSelectedFiles(droppedFiles);
      setUploadStatus(null);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select PDF files to upload');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await api.uploadPDFs(selectedFiles);
      setUploadStatus(result);
      setSelectedFiles([]);
      // Reset file input
      document.getElementById('file-input').value = '';
      // Refresh folder stats after upload
      await fetchFolderStats();
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleStartProcessing = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.startProcessing(
        ocrWorkers,
        llmWorkers,
        stage2QueueSize,
        enableOcrMultiprocessing,
        ocrPageWorkers
      );
      if (result.success) {
        setUploadStatus({ ...result, type: 'processing' });
        setIsPdfProcessingActive(true); // Enable stop button
        // Immediate fetch to update stats
        await fetchActiveStats();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start processing');
    } finally {
      setLoading(false);
    }
  };

  const increaseWorkers = () => {
    setWorkerCount(prev => Math.min(prev + 1, 5));
  };

  const decreaseWorkers = () => {
    setWorkerCount(prev => Math.max(prev - 1, 1));
  };

  const increaseOcrWorkers = () => {
    setOcrWorkers(prev => Math.min(prev + 1, 20));
  };

  const decreaseOcrWorkers = () => {
    setOcrWorkers(prev => Math.max(prev - 1, 1));
  };

  const increaseLlmWorkers = () => {
    setLlmWorkers(prev => Math.min(prev + 1, 20));
  };

  const decreaseLlmWorkers = () => {
    setLlmWorkers(prev => Math.max(prev - 1, 1));
  };

  const increaseQueueSize = () => {
    setStage2QueueSize(prev => Math.min(prev + 1, 10));
  };

  const decreaseQueueSize = () => {
    setStage2QueueSize(prev => Math.max(prev - 1, 1));
  };

  const increaseOcrPageWorkers = () => {
    setOcrPageWorkers(prev => Math.min(prev + 1, 8));
  };

  const decreaseOcrPageWorkers = () => {
    setOcrPageWorkers(prev => Math.max(prev - 1, 1));
  };

  const handleStopProcessing = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.stopProcessing();
      setUploadStatus({ ...result, type: 'stop' });
      setIsPdfProcessingActive(false); // Disable stop button
      // Refresh stats after stopping
      await fetchStats();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to stop processing');
    } finally {
      setLoading(false);
    }
  };

  const handleStartVision = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.startVisionProcessing();
      if (result.success) {
        setUploadStatus({ ...result, type: 'vision' });
        setIsVisionProcessingActive(true); // Enable stop button
        // Immediate fetch to update stats
        await fetchActiveStats();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start vision processing');
    } finally {
      setLoading(false);
    }
  };

  const handleStopVision = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.stopVisionProcessing();
      setUploadStatus({ ...result, type: 'stop-vision' });
      setIsVisionProcessingActive(false); // Disable stop button
      // Refresh stats after stopping
      await fetchStats();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to stop vision processing');
    } finally {
      setLoading(false);
    }
  };

  const handleRerunFailed = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.rerunFailedPDFs();
      if (result.success) {
        setUploadStatus({ ...result, type: 'rerun-failed' });
        await fetchStats(); // Refresh stats after rerunning

        // Automatically start processing the failed PDFs
        const startResult = await api.startProcessing();
        if (startResult.success) {
          setUploadStatus({
            ...startResult,
            message: `${result.message}. Processing started automatically.`,
            type: 'rerun-and-process'
          });
          setIsPdfProcessingActive(true); // Enable stop button
        }
      } else {
        setError(result.message || 'No failed PDFs to rerun');
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to rerun failed PDFs');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadFailed = async () => {
    setLoading(true);
    setError(null);
    try {
      const blob = await api.downloadFailedPDFs();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `failed_pdfs_${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setUploadStatus({
        success: true,
        message: 'Failed PDFs downloaded successfully',
        type: 'download-failed'
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to download failed PDFs');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEmbeddedOcr = async (enabled) => {
    try {
      const response = await api.toggleEmbeddedOcr(enabled);
      setUseEmbeddedOcr(enabled);
      setUploadStatus({
        success: true,
        message: response.message,
        type: 'toggle-ocr'
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to toggle embedded OCR');
      // Revert the checkbox state on error
      setUseEmbeddedOcr(!enabled);
    }
  };

  const ProgressBar = ({ value, max, label }) => {
    const percentage = max > 0 ? (value / max) * 100 : 0;
    return (
      <div className="progress-container">
        <div className="progress-label">
          <span>{label}</span>
          <span>
            {value} / {max} ({percentage.toFixed(1)}%)
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${percentage}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="control-panel">
      <h2>Control Panel</h2>

      {/* Upload Section */}
      <div className="panel-section">
        <h3>
          <Upload size={20} />
          PDF Upload
        </h3>
        <div
          className="upload-area"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            id="file-input"
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
            className="file-input"
          />
          <label htmlFor="file-input" className="file-label">
            <FileText size={48} />
            <span>Click to select PDF files or drag and drop</span>
            <span className="file-hint">Multiple files supported</span>
          </label>

          {selectedFiles.length > 0 && (
            <div className="selected-files">
              <h4>Selected Files ({selectedFiles.length}):</h4>
              <ul>
                {selectedFiles.map((file, index) => (
                  <li key={index}>
                    {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={loading || selectedFiles.length === 0}
          >
            {loading ? <Loader className="spin" size={20} /> : <Upload size={20} />}
            Upload PDFs
          </button>
        </div>

        {uploadStatus && uploadStatus.success && (
          <div className="alert alert-success">
            <CheckCircle size={20} />
            <span>{uploadStatus.message || `Uploaded ${uploadStatus.uploaded_count} files successfully`}</span>
          </div>
        )}

        {error && (
          <div className="alert alert-error">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* PDF Processing Section */}
      <div className="panel-section">
        <h3>
          <Play size={20} />
          PDF Processing (OCR + LLM)
        </h3>

        {/* Worker Count Controls */}
        <div className="worker-controls-pipeline">
          <div className="worker-control-row">
            <label className="worker-label">OCR Workers (CPU):</label>
            <div className="worker-buttons">
              <button
                className="btn btn-sm btn-secondary"
                onClick={decreaseOcrWorkers}
                disabled={loading || isPdfProcessingActive || ocrWorkers <= 1}
                title="Decrease OCR workers"
              >
                -
              </button>
              <span className="worker-count">{ocrWorkers}</span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={increaseOcrWorkers}
                disabled={loading || isPdfProcessingActive || ocrWorkers >= 20}
                title="Increase OCR workers"
              >
                +
              </button>
            </div>
          </div>

          <div className="worker-control-row">
            <label className="worker-label">LLM Workers (I/O):</label>
            <div className="worker-buttons">
              <button
                className="btn btn-sm btn-secondary"
                onClick={decreaseLlmWorkers}
                disabled={loading || isPdfProcessingActive || llmWorkers <= 1}
                title="Decrease LLM workers"
              >
                -
              </button>
              <span className="worker-count">{llmWorkers}</span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={increaseLlmWorkers}
                disabled={loading || isPdfProcessingActive || llmWorkers >= 20}
                title="Increase LLM workers"
              >
                +
              </button>
            </div>
          </div>
          <span className="worker-hint">(Max: 20 each)</span>
        </div>

        {/* Advanced OCR Settings */}
        <div className="advanced-settings">
          <h4 className="settings-header">Advanced OCR Settings</h4>

          <div className="worker-control-row">
            <label className="worker-label">Stage-2 Queue Size:</label>
            <div className="worker-buttons">
              <button
                className="btn btn-sm btn-secondary"
                onClick={decreaseQueueSize}
                disabled={loading || isPdfProcessingActive || stage2QueueSize <= 1}
                title="Decrease queue size"
              >
                -
              </button>
              <span className="worker-count">{stage2QueueSize}</span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={increaseQueueSize}
                disabled={loading || isPdfProcessingActive || stage2QueueSize >= 10}
                title="Increase queue size"
              >
                +
              </button>
            </div>
            <span className="setting-hint">(Prevents memory overflow)</span>
          </div>

          <div className="worker-control-row">
            <label className="worker-label">
              <input
                type="checkbox"
                checked={enableOcrMultiprocessing}
                onChange={(e) => setEnableOcrMultiprocessing(e.target.checked)}
                disabled={loading || isPdfProcessingActive}
                className="checkbox-input"
              />
              Enable OCR Multiprocessing
            </label>
            <span className="setting-hint">(Faster for large PDFs, higher CPU/memory)</span>
          </div>

          {enableOcrMultiprocessing && (
            <div className="worker-control-row indent">
              <label className="worker-label">OCR Page Workers:</label>
              <div className="worker-buttons">
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={decreaseOcrPageWorkers}
                  disabled={loading || isPdfProcessingActive || ocrPageWorkers <= 1}
                  title="Decrease OCR page workers"
                >
                  -
                </button>
                <span className="worker-count">{ocrPageWorkers}</span>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={increaseOcrPageWorkers}
                  disabled={loading || isPdfProcessingActive || ocrPageWorkers >= 8}
                  title="Increase OCR page workers"
                >
                  +
                </button>
              </div>
              <span className="setting-hint">(2-4 recommended)</span>
            </div>
          )}

          <div className="worker-control-row">
            <label className="worker-label">
              <input
                type="checkbox"
                checked={useEmbeddedOcr}
                onChange={(e) => handleToggleEmbeddedOcr(e.target.checked)}
                disabled={loading || isPdfProcessingActive}
                className="checkbox-input"
              />
              Use Embedded OCR (PyMuPDF)
            </label>
            <span className="setting-hint">(Read embedded text instead of Tesseract OCR)</span>
          </div>
        </div>

        <div className="control-buttons">
          <button
            className="btn btn-success"
            onClick={handleStartProcessing}
            disabled={loading || isPdfProcessingActive}
          >
            <Play size={20} />
            Start Processing
          </button>
          <button
            className="btn btn-danger"
            onClick={handleStopProcessing}
            disabled={loading}
          >
            <Square size={20} />
            Stop Processing
          </button>
          <button
            className="btn btn-warning"
            onClick={handleRerunFailed}
            disabled={loading || isPdfProcessingActive || (folderStats?.failed || 0) === 0}
            title="Rerun failed PDFs"
          >
            <RefreshCw size={20} />
            Rerun Failed ({folderStats?.failed || 0})
          </button>
          <button
            className="btn btn-info"
            onClick={handleDownloadFailed}
            disabled={loading || (folderStats?.failed || 0) === 0}
            title="Download failed PDFs as ZIP"
          >
            <Download size={20} />
            Download Failed
          </button>
        </div>

        {processingStats && (
          <div className="stats-section">
            <div className="status-badge">
              {processingStats.is_running || isPdfProcessingActive ? (
                <span className="badge running">
                  <Loader className="spin" size={16} />
                  Processing...
                </span>
              ) : (
                <span className="badge idle">Idle</span>
              )}
            </div>

            <ProgressBar
              value={processingStats.processed}
              max={processingStats.total}
              label="Processing Progress"
            />

            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Total</span>
                <span className="stat-value">{processingStats.total}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Processed</span>
                <span className="stat-value success">{processingStats.processed}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Failed</span>
                <span className="stat-value error">{processingStats.failed}</span>
              </div>
              {processingStats.ocr_active !== undefined && (
                <>
                  <div className="stat-card pipeline">
                    <span className="stat-label">OCR Active</span>
                    <span className="stat-value">{processingStats.ocr_active}</span>
                  </div>
                  <div className="stat-card pipeline">
                    <span className="stat-label">In Queue</span>
                    <span className="stat-value">{processingStats.in_queue || 0}</span>
                  </div>
                  <div className="stat-card pipeline">
                    <span className="stat-label">LLM Active</span>
                    <span className="stat-value">{processingStats.llm_active}</span>
                  </div>
                </>
              )}
              {processingStats.ocr_active === undefined && (
                <div className="stat-card">
                  <span className="stat-label">Active Workers</span>
                  <span className="stat-value">{processingStats.active_workers || 0}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Vision Processing Section */}
      <div className="panel-section">
        <h3>
          <Eye size={20} />
          Vision Processing (Registration Fee Extraction)
        </h3>

        <div className="control-buttons">
          <button
            className="btn btn-success"
            onClick={handleStartVision}
            disabled={loading || isVisionProcessingActive}
          >
            <Eye size={20} />
            Start Vision
          </button>
          <button
            className="btn btn-danger"
            onClick={handleStopVision}
            disabled={loading}
          >
            <Square size={20} />
            Stop Vision
          </button>
        </div>

        {visionStats && (
          <div className="stats-section">
            <div className="status-badge">
              {visionStats.is_running || isVisionProcessingActive ? (
                <span className="badge running">
                  <Loader className="spin" size={16} />
                  Processing...
                </span>
              ) : (
                <span className="badge idle">Idle</span>
              )}
            </div>

            <ProgressBar
              value={visionStats.processed}
              max={visionStats.total}
              label="Vision Progress"
            />

            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Total</span>
                <span className="stat-value">{visionStats.total}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Processed</span>
                <span className="stat-value success">{visionStats.processed}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Failed</span>
                <span className="stat-value error">{visionStats.failed}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Active Workers</span>
                <span className="stat-value">{visionStats.active_workers || 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;
