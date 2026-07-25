// Medications.js

document.addEventListener('DOMContentLoaded', function () {
    const medicationsList = document.getElementById('medications-list');
    const modal = document.getElementById('add-medication-modal');
    const form = document.getElementById('medication-form');

    // Declare medications variable here
    let medications = [];

    // Load from backend if logged in, otherwise from localStorage
    const token = localStorage.getItem('token');
    if (token) {
        // fetch from backend
        fetch('http://localhost:3000/api/medications', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.ok ? r.json() : Promise.reject(r)).then(data => {
            medications = data || [];
            renderMedications();
        }).catch(err => {
            console.warn('Failed to fetch medications from server, falling back to localStorage', err);
            if (localStorage.getItem('medications')) medications = JSON.parse(localStorage.getItem('medications'));
            renderMedications();
        });
    } else {
        if (localStorage.getItem('medications')) {
            medications = JSON.parse(localStorage.getItem('medications'));
        }
    }

    function renderMedications() {
        medicationsList.innerHTML = '';
        if (medications.length === 0) {
            medicationsList.innerHTML = '<p>No medications set. Add a new medication.</p>';
            return;
        }
        medications.forEach((med, idx) => {
            const medDiv = document.createElement('div');
            medDiv.className = 'medication-card';
            medDiv.innerHTML = `
                <strong>${med.name}</strong> <br>
                Dosage: ${med.dosage} <br>
                Time: ${med.time} <br>
                <span style="font-size:0.95em;color:#555;">${med.instructions || ''}</span><br>
                <button class="delete-btn" data-id="${med.id || ''}" data-idx="${idx}">Delete</button>
            `;
            medicationsList.appendChild(medDiv);
        });
        // Attach delete listeners
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.onclick = async function () {
                const idxAttr = this.getAttribute('data-idx');
                const medId = this.getAttribute('data-id');
                const token = localStorage.getItem('token');
                const idx = parseInt(idxAttr, 10);

                // Helper to remove from local array by id (preferred) or index
                const removeLocally = (id, index) => {
                    let removed = false;
                    if (id) {
                        const i = medications.findIndex(m => String(m.id) === String(id));
                        if (i > -1) {
                            medications.splice(i, 1);
                            removed = true;
                        }
                    }
                    if (!removed && !isNaN(index)) {
                        medications.splice(index, 1);
                        removed = true;
                    }
                    localStorage.setItem('medications', JSON.stringify(medications));
                    renderMedications();
                };

                if (token && medId) {
                    try {
                        const res = await fetch(`http://localhost:3000/api/medications/${medId}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${token}` }
                        });

                        if (res.ok) {
                            removeLocally(medId, idx);
                        } else {
                            // parse error body if possible
                            let errBody = null;
                            try { errBody = await res.json(); } catch(e) { /* ignore */ }
                            if (res.status === 401) {
                                alert('You are not authorized. Please login and try again.');
                            } else if (errBody && errBody.error) {
                                alert('Failed to delete medication from server: ' + errBody.error);
                            } else {
                                alert('Failed to delete medication from server.');
                            }
                            console.error('Delete response status:', res.status, 'body:', errBody);
                        }
                    } catch (err) {
                        console.error('Error deleting medication:', err);
                        alert('Error deleting medication: ' + (err.message || err));
                    }
                } else {
                    console.warn('No token or medication ID. Deleting locally. Token:', !!token, 'ID:', medId);
                    removeLocally(medId, idx);
                }
            };
        });
    }

    // Show modal
    window.showAddMedicationForm = function () {
        modal.classList.remove('hidden');
    };
    // Close modal
    window.closeMedicationModal = function () {
        modal.classList.add('hidden');
        form.reset();
    };
    // Handle form submit
    form.onsubmit = function (e) {
        e.preventDefault();
        const data = new FormData(form);
        const name = data.get('name');
        const dosage = data.get('dosage');
        const time = data.get('time');
        if (!name || !dosage || !time) {
            alert('Name, dosage, and time are required');
            return;
        }
        const newMed = {
            name: name,
            dosage: dosage,
            time: time,
            instructions: data.get('instructions')
        };
        // if logged in, POST to backend; otherwise save locally
        if (token) {
            fetch('http://localhost:3000/api/medications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: newMed.name, dosage: newMed.dosage, frequency: 'daily', time: newMed.time, start_date: new Date().toISOString().split('T')[0], notes: newMed.instructions })
            }).then(r => r.json()).then(result => {
                if (result && result.medication) {
                    medications.push(result.medication);
                    renderMedications();
                } else {
                    // fallback
                    medications.push(newMed);
                    localStorage.setItem('medications', JSON.stringify(medications));
                    renderMedications();
                }
            }).catch(err => {
                console.error('Failed to save medication to server, saving locally', err);
                medications.push(newMed);
                localStorage.setItem('medications', JSON.stringify(medications));
                renderMedications();
            });
        } else {
            medications.push(newMed);
            localStorage.setItem('medications', JSON.stringify(medications));
            renderMedications();
        }
        closeMedicationModal();
    };

    renderMedications();
});
