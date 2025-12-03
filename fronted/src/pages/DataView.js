import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, Search, Loader, AlertCircle } from 'lucide-react';
import api from '../services/api';
import ExcelJS from 'exceljs';
import '../styles/DataView.css';

const DataView = () => {
  // Format number to remove unnecessary decimals
  const formatNumber = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return '-';
    // If it's a whole number, show without decimals, otherwise keep decimals
    return num % 1 === 0 ? num.toFixed(0) : num;
  };
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadOption, setDownloadOption] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const rowsPerPage = 8;

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDocuments(0, 1000);
      setDocuments(data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadExcel = async () => {
    setDownloading(true);
    try {
      // Fetch data from database via API
      const blob = await api.exportToExcel();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sale_deeds_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to download Excel file');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadClientSide = async () => {
    await handleDownloadClientSideWithDocs(documents);
  };

  const handleDownloadClientSideWithDocs = async (docsToExport) => {
    // Prepare data for Excel export with new format (no row spanning)
    const rows = [];
    let serialNumber = 1;

    docsToExport.forEach((doc) => {
      const buyers = doc.buyers || [];
      const sellers = doc.sellers || [];
      const allPeople = [...sellers.map(s => ({...s, type: 'S'})), ...buyers.map(b => ({...b, type: 'B'}))];

      if (allPeople.length === 0) return;

      const currentSerialNumber = serialNumber;

      // Create schedule C address with property name
      const schedCAddress = [
        doc.property_details?.schedule_c_property_address,
        doc.property_details?.schedule_c_property_name
      ].filter(Boolean).join(', ') || '-';

      // Create one row per person (sellers first, then buyers) - all fields repeat
      allPeople.forEach((person) => {
        const row = [
          currentSerialNumber, // SL.NO - same for all people in this document
          person.type, // USER_TYPE (S or B)
          doc.document_id || '-',
          formatNumber(doc.property_details?.schedule_b_area),
          formatNumber(doc.property_details?.schedule_c_property_area),
          schedCAddress,
          doc.property_details?.pincode || '-',
          doc.property_details?.state || '-',
          formatNumber(doc.property_details?.sale_consideration),
          formatNumber(doc.property_details?.stamp_duty_fee),
          formatNumber(doc.property_details?.registration_fee),
          formatNumber(doc.property_details?.guidance_value),
          doc.property_details?.paid_in_cash_mode || '-',
          doc.transaction_date || '-',
          doc.registration_office || '-',
          person.name || '-',
          person.gender || '-',
          person.aadhaar_number || '-',
          person.pan_card_number || '-',
          person.address || '-',
          person.pincode || '-',
          person.state || '-',
          person.phone_number || '-',
          person.secondary_phone_number || '-',
          person.email || '-',
          person.property_share || '-',
        ];

        rows.push(row);
      });

      // Increment serial number only after processing all rows for this document
      serialNumber++;
    });

    // Create workbook with ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sale Deeds');

    // Define columns with headers and widths
    worksheet.columns = [
      { header: 'SL.NO', key: 'slno', width: 8 },
      { header: 'USER_TYPE', key: 'userType', width: 10 },
      { header: 'Document ID', key: 'docId', width: 22 },
      { header: 'Schedule B Area (sqft)', key: 'schedBArea', width: 18 },
      { header: 'Schedule C Area (sqft)', key: 'schedCArea', width: 18 },
      { header: 'Schedule C Address & Name', key: 'schedCAddr', width: 45 },
      { header: 'Property Pincode', key: 'propPin', width: 14 },
      { header: 'Property State', key: 'propState', width: 14 },
      { header: 'Sale Consideration', key: 'saleCon', width: 16 },
      { header: 'Stamp Duty', key: 'stampDuty', width: 13 },
      { header: 'Registration Fee', key: 'regFee', width: 15 },
      { header: 'Guidance Value', key: 'guidVal', width: 15 },
      { header: 'Cash Payment', key: 'cashPayment', width: 35 },
      { header: 'Transaction Date', key: 'transDate', width: 14 },
      { header: 'Registration Office', key: 'regOffice', width: 20 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Aadhaar', key: 'aadhaar', width: 15 },
      { header: 'PAN', key: 'pan', width: 12 },
      { header: 'Address', key: 'address', width: 35 },
      { header: 'Pincode', key: 'pincode', width: 10 },
      { header: 'State', key: 'state', width: 14 },
      { header: 'Phone', key: 'phone', width: 14 },
      { header: 'Secondary Phone', key: 'secPhone', width: 14 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'Property Share', key: 'propShare', width: 14 },
    ];

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 25;

    // Add borders to header
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });

    // Add data rows (no merging - all fields repeat)
    rows.forEach((row) => {
      worksheet.addRow(row);
    });

    // Style data rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.height = 20;
        row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
          };
          cell.font = { size: 10 };
        });
      }
    });

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // Download file
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sale_deeds_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  // Transform data for Excel-like display
  const transformDataForDisplay = () => {
    const rows = [];

    documents.forEach((doc) => {
      const buyers = doc.buyers || [];
      const sellers = doc.sellers || [];
      const maxPeople = Math.max(buyers.length, sellers.length, 1);

      for (let i = 0; i < maxPeople; i++) {
        const buyer = buyers[i];
        const seller = sellers[i];

        rows.push({
          document_id: doc.document_id,
          index: i,
          transaction_date: doc.transaction_date,
          registration_office: doc.registration_office,
          property: doc.property_details,
          buyer,
          seller,
        });
      }
    });

    return rows;
  };

  const filteredData = transformDataForDisplay().filter((row) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      row.document_id?.toLowerCase().includes(search) ||
      row.buyer?.name?.toLowerCase().includes(search) ||
      row.seller?.name?.toLowerCase().includes(search) ||
      row.property?.address?.toLowerCase().includes(search)
    );
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  const handleDownloadExcelWithOptions = () => {
    setShowDownloadModal(true);
  };

  const handleConfirmDownload = async () => {
    setShowDownloadModal(false);

    if (downloadOption === 'all') {
      await handleDownloadClientSide();
    } else {
      // Filter by date range
      const filteredDocs = documents.filter((doc) => {
        const createdDate = new Date(doc.created_at);
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        // Set start to beginning of day
        if (start) {
          start.setHours(0, 0, 0, 0);
        }

        // Set end to end of day
        if (end) {
          end.setHours(23, 59, 59, 999);
        }

        if (start && createdDate < start) return false;
        if (end && createdDate > end) return false;
        return true;
      });

      // Pass filtered documents directly instead of using state
      await handleDownloadClientSideWithDocs(filteredDocs);
    }
  };

  // Group rows by document_id for rowspan rendering (using paginated data)
  const groupedData = [];
  let currentDocId = null;
  let rowSpanCount = 0;

  paginatedData.forEach((row, idx) => {
    if (row.document_id !== currentDocId) {
      if (currentDocId !== null) {
        // Update the rowspan for previous group
        const firstIdx = groupedData.findIndex(r => r.document_id === currentDocId && r.isFirst);
        if (firstIdx !== -1) {
          groupedData[firstIdx].rowSpan = rowSpanCount;
        }
      }
      currentDocId = row.document_id;
      rowSpanCount = 1;
      groupedData.push({ ...row, isFirst: true, rowSpan: 1 });
    } else {
      rowSpanCount++;
      groupedData.push({ ...row, isFirst: false });
    }
  });

  // Update last group
  if (currentDocId !== null && groupedData.length > 0) {
    const firstIdx = groupedData.findIndex(r => r.document_id === currentDocId && r.isFirst);
    if (firstIdx !== -1) {
      groupedData[firstIdx].rowSpan = rowSpanCount;
    }
  }

  return (
    <div className="data-view">
      <div className="data-header">
        <h2>Data View</h2>

        <div className="data-controls">
          <div className="search-box">
            <Search size={20} />
            <input
              type="text"
              placeholder="Search documents, names, addresses..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <button className="btn btn-secondary" onClick={fetchDocuments} disabled={loading}>
            {loading ? <Loader className="spin" size={20} /> : <RefreshCw size={20} />}
            Refresh
          </button>

          <button
            className="btn btn-primary"
            onClick={handleDownloadExcel}
            disabled={downloading || documents.length === 0}
          >
            {downloading ? <Loader className="spin" size={20} /> : <Download size={20} />}
            Download Excel (DB)
          </button>

          <button
            className="btn btn-success"
            onClick={handleDownloadExcelWithOptions}
            disabled={documents.length === 0}
          >
            <Download size={20} />
            Download Excel
          </button>
        </div>
      </div>

      {/* Download Modal */}
      {showDownloadModal && (
        <div className="modal-overlay" onClick={() => setShowDownloadModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Download Excel Options</h3>

            <div className="modal-body">
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="all"
                    checked={downloadOption === 'all'}
                    onChange={(e) => setDownloadOption(e.target.value)}
                  />
                  Download All Documents
                </label>

                <label>
                  <input
                    type="radio"
                    value="dateRange"
                    checked={downloadOption === 'dateRange'}
                    onChange={(e) => setDownloadOption(e.target.value)}
                  />
                  Download by Date Range
                </label>
              </div>

              {downloadOption === 'dateRange' && (
                <div className="date-range-inputs">
                  <div className="input-group">
                    <label>Start Date (Created At):</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="input-group">
                    <label>End Date (Created At):</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDownloadModal(false)}>
                Cancel
              </button>
              <button className="btn btn-success" onClick={handleConfirmDownload}>
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <Loader className="spin" size={48} />
          <p>Loading data...</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="empty-state">
          <p>No documents found. Upload and process PDFs to see data here.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Document ID</th>
                <th>Transaction Date</th>
                <th>Registration Office</th>
                <th>Schedule B Area (sqft)</th>
                <th>Schedule C Area (sqft)</th>
                <th>Schedule C Address & Name</th>
                <th>Cash Payment</th>
                <th>Property Pincode</th>
                <th>Property State</th>
                <th>Sale Consideration</th>
                <th>Stamp Duty</th>
                <th>Registration Fee</th>
                <th>Guidance Value</th>
                <th>Buyer Name</th>
                <th>Buyer Gender</th>
                <th>Buyer Aadhaar</th>
                <th>Buyer PAN</th>
                <th>Buyer Address</th>
                <th>Buyer Pincode</th>
                <th>Buyer State</th>
                <th>Buyer Phone</th>
                <th>Buyer Email</th>
                <th>Seller Name</th>
                <th>Seller Gender</th>
                <th>Seller Aadhaar</th>
                <th>Seller PAN</th>
                <th>Seller Address</th>
                <th>Seller Pincode</th>
                <th>Seller State</th>
                <th>Seller Phone</th>
                <th>Seller Email</th>
                <th>Seller Share</th>
              </tr>
            </thead>
            <tbody>
              {groupedData.map((row, idx) => (
                <tr key={`${row.document_id}-${idx}`}>
                  {row.isFirst && (
                    <>
                      <td rowSpan={row.rowSpan} className="doc-id-cell">
                        {row.document_id}
                      </td>
                      <td rowSpan={row.rowSpan}>{row.transaction_date || '-'}</td>
                      <td rowSpan={row.rowSpan}>{row.registration_office || '-'}</td>
                      <td rowSpan={row.rowSpan}>{formatNumber(row.property?.schedule_b_area)}</td>
                      <td rowSpan={row.rowSpan}>{formatNumber(row.property?.schedule_c_property_area)}</td>
                      <td rowSpan={row.rowSpan}>
                        {row.property?.schedule_c_property_address || '-'}
                        {row.property?.schedule_c_property_name && row.property?.schedule_c_property_address ? ', ' : ''}
                        {row.property?.schedule_c_property_name || ''}
                      </td>
                      <td rowSpan={row.rowSpan}>{row.property?.paid_in_cash_mode || '-'}</td>
                      <td rowSpan={row.rowSpan}>{row.property?.pincode || '-'}</td>
                      <td rowSpan={row.rowSpan}>{row.property?.state || '-'}</td>
                      <td rowSpan={row.rowSpan}>{formatNumber(row.property?.sale_consideration)}</td>
                      <td rowSpan={row.rowSpan}>{formatNumber(row.property?.stamp_duty_fee)}</td>
                      <td rowSpan={row.rowSpan}>{formatNumber(row.property?.registration_fee)}</td>
                      <td rowSpan={row.rowSpan}>{formatNumber(row.property?.guidance_value)}</td>
                    </>
                  )}
                  <td>{row.buyer?.name || '-'}</td>
                  <td>{row.buyer?.gender || '-'}</td>
                  <td>{row.buyer?.aadhaar_number || '-'}</td>
                  <td>{row.buyer?.pan_card_number || '-'}</td>
                  <td>{row.buyer?.address || '-'}</td>
                  <td>{row.buyer?.pincode || '-'}</td>
                  <td>{row.buyer?.state || '-'}</td>
                  <td>{row.buyer?.phone_number || '-'}</td>
                  <td>{row.buyer?.email || '-'}</td>
                  <td>{row.seller?.name || '-'}</td>
                  <td>{row.seller?.gender || '-'}</td>
                  <td>{row.seller?.aadhaar_number || '-'}</td>
                  <td>{row.seller?.pan_card_number || '-'}</td>
                  <td>{row.seller?.address || '-'}</td>
                  <td>{row.seller?.pincode || '-'}</td>
                  <td>{row.seller?.state || '-'}</td>
                  <td>{row.seller?.phone_number || '-'}</td>
                  <td>{row.seller?.email || '-'}</td>
                  <td>{row.seller?.property_share || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="data-footer">
        <div className="footer-info">
          <p>Total Documents: {documents.length}</p>
          <p>Showing: {startIndex + 1}-{Math.min(endIndex, filteredData.length)} of {filteredData.length} rows</p>
        </div>

        <div className="pagination-controls">
          <button
            className="btn btn-secondary"
            onClick={handlePrevPage}
            disabled={currentPage === 1}
          >
            Previous
          </button>
          <span className="page-info">
            Page {currentPage} of {totalPages || 1}
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleNextPage}
            disabled={currentPage === totalPages || totalPages === 0}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataView;
