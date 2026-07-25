// records.js - Connected to backend API for persistent database storage

document.addEventListener('DOMContentLoaded', async function () {
    const form = document.getElementById('upload-form');
    const fileInput = document.getElementById('record-file');
    const nameInput = document.getElementById('record-name');
    const recordsList = document.getElementById('records-list');

    // Get JWT token from localStorage (set during login)
    const token = localStorage.getItem('token');
    if (!token) {
        recordsList.innerHTML = '<p style="color: red;">Error: Not logged in. Please log in first.</p>';
        return;
    }

    let records = [];
    let fileDataMap = {}; // Store file data by record ID

    // Fetch records from backend API
    async function fetchRecords() {
        try {
            const response = await fetch('http://localhost:3000/api/records', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            records = await response.json();
            console.log('Records fetched:', records);
            renderTable();
        } catch (err) {
            console.error('Fetch records error:', err);
            recordsList.innerHTML = `<p style="color: red;">Error loading records: ${err.message}</p>`;
        }
    }

    function renderTable() {
        if (records.length === 0) {
            recordsList.innerHTML = '<p>No records uploaded yet.</p>';
            return;
        }
        // Render stacked record cards
        recordsList.innerHTML = '';
        records.forEach((rec) => {
            const card = document.createElement('div');
            card.className = 'record-card';
            const uploadDate = rec.upload_date ? new Date(rec.upload_date).toLocaleString() : 'Unknown';
            card.innerHTML = `
                <div class="record-main">
                  <div class="record-name">${rec.name}</div>
                  <div class="record-type">${rec.type}</div>
                </div>
                <div class="record-meta">
                    <small>Uploaded: ${uploadDate}</small>
                    ${rec.description ? `<br><small>${rec.description}</small>` : ''}
                </div>
                <div class="record-actions">
                  <button class="open-record-btn" data-id="${rec.id}" title="Open">📖 Open</button>
                  <button class="download-record-btn" data-id="${rec.id}" title="Download">⬇️ Download</button>
                  <button class="delete-record-btn" data-id="${rec.id}" title="Delete">🗑️ Delete</button>
                </div>
            `;
            recordsList.appendChild(card);
        });
        
        // Open record handler - show modal with file content
        const previewModal = document.getElementById('record-preview-modal');
        const previewBody = document.getElementById('record-preview-body');
        const previewClose = document.getElementById('record-preview-close');
        if (previewClose) previewClose.addEventListener('click', () => {
            previewModal.classList.add('hidden');
            previewBody.innerHTML = '';
        });
        // Close modal when background clicked
        if (previewModal) previewModal.addEventListener('click', (e) => {
            if (e.target === previewModal) {
                previewModal.classList.add('hidden');
                previewBody.innerHTML = '';
            }
        });

        document.querySelectorAll('.open-record-btn').forEach(btn => {
            btn.onclick = function () {
                const id = this.getAttribute('data-id');
                const rec = records.find(r => r.id == id);
                if (rec) {
                    // Build details header
                    let detailsHtml = `<h3>${rec.name}</h3>`;
                    detailsHtml += `<div><small>Type: ${rec.type}</small></div>`;
                    detailsHtml += `<div><small>${rec.description || ''}</small></div>`;
                    detailsHtml += `<div><small>Uploaded: ${rec.uploaded_by || 'Unknown'} | ${rec.upload_date || ''}</small></div>`;
                    detailsHtml += `<hr>`;

                    // If file data exists, show preview depending on type
                    if (rec.file_data) {
                        const dataUrl = `data:${rec.type};base64,${rec.file_data}`;
                        if (rec.type && rec.type.startsWith('image/')) {
                            detailsHtml += `<div style="text-align:center;"><img src="${dataUrl}" alt="${rec.name}" style="max-width:100%;height:auto;border-radius:8px;" /></div>`;
                        } else if (rec.type === 'application/pdf') {
                            detailsHtml += `<iframe src="${dataUrl}" title="${rec.name}" style="width:100%;height:60vh;border:0;border-radius:6px;"></iframe>`;
                        } else {
                            // For non-previewable types show download link
                            detailsHtml += `<p>File available: <a href="${dataUrl}" download="${rec.file_name || rec.name}">Download ${rec.file_name || rec.name}</a></p>`;
                        }
                    } else {
                        detailsHtml += `<p>No file stored for this record.</p>`;
                    }

                    previewBody.innerHTML = detailsHtml;
                    previewModal.classList.remove('hidden');
                }
            };
        });
        
        // Download record handler
        document.querySelectorAll('.download-record-btn').forEach(btn => {
            btn.onclick = function () {
                const id = this.getAttribute('data-id');
                const rec = records.find(r => r.id == id);
                if (rec) {
                    downloadRecord(rec);
                }
            };
        });
        
        // Delete record handler
        document.querySelectorAll('.delete-record-btn').forEach(btn => {
            btn.onclick = function () {
                const id = this.getAttribute('data-id');
                const rec = records.find(r => r.id == id);
                if (rec && confirm(`Are you sure you want to delete "${rec.name}"?`)) {
                    deleteRecord(id);
                }
            };
        });
    }

    function downloadRecord(rec) {
        // If file data exists, download it
        if (rec.file_data) {
            try {
                const binaryString = atob(rec.file_data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: rec.type || 'application/octet-stream' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = rec.file_name || `${rec.name}.bin`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
                console.log(`Downloaded file: ${rec.file_name || rec.name}`);
            } catch (err) {
                console.error('Download error:', err);
                alert('Error downloading file: ' + err.message);
            }
        } else {
            // Create a text file with record details
            const content = `Medical Record: ${rec.name}
Type: ${rec.type}
Description: ${rec.description || 'N/A'}
Uploaded by: ${rec.uploaded_by || 'Unknown'}
Date: ${rec.upload_date || 'Unknown'}

ID: ${rec.id}
Database: healthcare.db
`;
            
            const blob = new Blob([content], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${rec.name}.txt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            
            console.log(`Downloaded record info: ${rec.name}.txt`);
        }
    }

    async function deleteRecord(id) {
        try {
            const response = await fetch(`http://localhost:3000/api/records/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`Failed to delete record: ${response.status}`);
            }
            const result = await response.json();
            console.log(`Record ${id} deleted:`, result);
            alert('Record deleted successfully');
            await fetchRecords(); // Refresh list from database
        } catch (err) {
            console.error('Delete record error:', err);
            alert(`Error deleting record: ${err.message}`);
        }
    }

    form.onsubmit = async function (e) {
        e.preventDefault();
        
        const file = fileInput.files[0];
        const name = nameInput.value.trim();

        if (!file || !name) {
            alert('Please select a file and enter a record name.');
            return;
        }

        // Read file as base64
        const reader = new FileReader();
        reader.onload = async function(event) {
            const fileData = event.target.result.split(',')[1]; // Get base64 part
            const fileSize = file.size;
            const fileName = file.name;
            const type = file.type || 'document';
            const description = `File: ${fileName} (${(fileSize / 1024).toFixed(2)} KB)`;

            try {
                const response = await fetch('http://localhost:3000/api/records', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name,
                        type,
                        description,
                        file_data: fileData,
                        file_size: fileSize,
                        file_name: fileName,
                        uploaded_by: 'User'
                    })
                });
                if (!response.ok) {
                    throw new Error(`Failed to create record: ${response.status}`);
                }
                const result = await response.json();
                console.log('Record created:', result);
                alert('Record uploaded successfully!');
                form.reset();
                await fetchRecords(); // Refresh list from database
            } catch (err) {
                console.error('Create record error:', err);
                alert(`Error creating record: ${err.message}`);
            }
        };
        reader.readAsDataURL(file);
    };

    // Load records on page load
    await fetchRecords();
});
