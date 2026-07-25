// contacts.js

document.addEventListener('DOMContentLoaded', function () {
    const contactsList = document.getElementById('contacts-list');
    const modal = document.getElementById('add-contact-modal');
    const form = document.getElementById('contact-form');

    // Example contacts (only keep caretakers and others; remove Patient Party and Doctor)
    let contacts = [
        { name: 'Sita Devi', relation: 'Caretaker', phone: '9988776655', details: 'Day shift' },
        { name: 'Anita Sharma', relation: 'Relative', phone: '9876501234', details: 'Family member' }
    ];

    // Load from backend if logged in, otherwise from localStorage
    const token = localStorage.getItem('token');
    if (token) {
        fetch('http://localhost:3000/api/contacts', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(r => r.ok ? r.json() : Promise.reject(r))
        .then(data => {
            contacts = data || [];
            renderContacts();
        })
        .catch(err => {
            console.warn('Failed to fetch contacts from server, falling back to localStorage', err);
            if (localStorage.getItem('contacts')) {
                contacts = JSON.parse(localStorage.getItem('contacts'));
            }
            renderContacts();
        });
    } else {
        if (localStorage.getItem('contacts')) {
            contacts = JSON.parse(localStorage.getItem('contacts'));
        }
    }

    function renderContacts() {
        // Group by relation (do not show Patient Party or Doctor categories)
        const groups = {
            'Caretaker': [],
            'Other': []
        };
        contacts.forEach((c, idx) => {
            const relation = (c.relation || c.relationship || '').toLowerCase();
            if (relation.includes('caretaker')) groups['Caretaker'].push({ contact: c, idx });
            else groups['Other'].push({ contact: c, idx });
        });
        let html = `<div class="contacts-grid">
            <div class="contact-col"><h3>Caretaker</h3>${groups['Caretaker'].map(obj => renderCard(obj.contact, obj.idx)).join('')}</div>
            <div class="contact-col"><h3>Other</h3>${groups['Other'].map(obj => renderCard(obj.contact, obj.idx)).join('')}</div>
        </div>`;
        contactsList.innerHTML = html;
        
        // Attach delete listeners
        document.querySelectorAll('.delete-contact-btn').forEach(btn => {
            btn.onclick = function () {
                const idx = this.getAttribute('data-idx');
                const contactId = this.getAttribute('data-id');
                const token = localStorage.getItem('token');
                
                if (!confirm('Are you sure you want to delete this contact?')) return;
                
                if (token && contactId) {
                    // Delete from backend if logged in and has ID
                    fetch(`http://localhost:3000/api/contacts/${contactId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).then(r => {
                        if (r.ok) {
                            contacts = contacts.filter(c => c.id !== contactId);
                            localStorage.setItem('contacts', JSON.stringify(contacts));
                            renderContacts();
                        } else {
                            alert('Failed to delete contact from server. Please try again.');
                        }
                    }).catch(err => {
                        console.error('Error deleting contact:', err);
                        alert('Error deleting contact. Please try again.');
                    });
                } else {
                    // Fallback: delete locally if no token or ID
                    contacts.splice(idx, 1);
                    localStorage.setItem('contacts', JSON.stringify(contacts));
                    renderContacts();
                }
            };
        });
    }
    function renderCard(c, idx) {
        return `<div class="contact-card">
            <div class="contact-name">${c.name}</div>
                <div class="contact-phone">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.08 4.18 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.72c.12 1.05.34 2.07.65 3.05a2 2 0 0 1-.45 2.11L8.09 11.91a16 16 0 0 0 6 6l1.03-1.03a2 2 0 0 1 2.11-.45c.98.31 2 .54 3.05.65A2 2 0 0 1 22 16.92z"></path>
                    </svg>
                    ${c.phone}
                </div>
            <div class="contact-details">${c.details || ''}</div>
            <button class="delete-contact-btn" data-id="${c.id || ''}" data-idx="${idx}" style="margin-top:8px;padding:6px 10px;background:#ffebee;color:#c62828;border:1px solid #c62828;border-radius:4px;cursor:pointer;font-size:0.9rem;">Delete</button>
        </div>`;
    }
    // Show modal
    window.showAddContactForm = function () {
        modal.classList.remove('hidden');
    };
    // Close modal
    window.closeContactModal = function () {
        modal.classList.add('hidden');
        form.reset();
    };
    // Handle form submit
    form.onsubmit = function (e) {
        e.preventDefault();
        const data = new FormData(form);
        const name = data.get('name');
        const phone = data.get('phone');
        if (!name || !phone) {
            alert('Name and phone are required');
            return;
        }
        const newContact = {
            name: name,
            relationship: data.get('relation'),
            phone: phone,
            details: data.get('details')
        };
        if (token) {
            fetch('http://localhost:3000/api/contacts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(newContact)
            })
            .then(r => r.ok ? r.json() : Promise.reject(r))
            .then(result => {
                if (result && result.contact) {
                    contacts.push(result.contact);
                    renderContacts();
                } else {
                    throw new Error('Invalid server response format');
                }
            })
            .catch(err => {
                console.error('Failed to save contact to server, saving locally', err);
                contacts.push(newContact);
                localStorage.setItem('contacts', JSON.stringify(contacts));
                renderContacts();
            });
        } else {
            contacts.push(newContact);
            localStorage.setItem('contacts', JSON.stringify(contacts));
            renderContacts();
        }
        closeContactModal();
    };
    renderContacts();
});
