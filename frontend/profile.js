// profile.js

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('profile-form');
    const display = document.getElementById('profile-display');
    const editToggle = document.getElementById('edit-toggle');
    const msgEl = document.getElementById('profile-msg');

    let profile = null;
    // Load from backend if logged in, otherwise from localStorage
    const token = localStorage.getItem('token');
    if (token) {
        fetch('http://localhost:3000/api/profile', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(r => r.ok ? r.json() : Promise.reject(r))
        .then(data => {
            profile = data;
            renderProfile();
            // when profile exists on server, show summary and lock form
            renderSummary(profile);
            setEditMode(false);
        })
        .catch(err => {
            console.warn('Failed to fetch profile from server, falling back to localStorage', err);
            if (localStorage.getItem('profile')) {
                profile = JSON.parse(localStorage.getItem('profile'));
                renderProfile();
            }
        });
    } else if (localStorage.getItem('profile')) {
        profile = JSON.parse(localStorage.getItem('profile'));
        renderProfile();
        renderSummary(profile);
        setEditMode(false);
    }

    // Helper to fill form fields from profile object
    function fillForm(p) {
        if (!p) return;
        form.elements['name'].value = p.name || '';
        form.elements['phone'].value = p.phone || '';
        form.elements['age'].value = p.age || '';
        form.elements['weight'].value = p.weight || '';
        form.elements['height'].value = p.height || '';
        form.elements['diseases'].value = p.diseases || '';
        form.elements['emergency'].value = p.emergency_contact || p.emergency || '';
        form.elements['emergencyNumber'].value = p.emergency_number || '';
        form.elements['details'].value = p.details || '';
    }

    // Render a summary view below the form
    function renderSummary(p) {
        if (!display) return;
        if (!p) {
            display.style.display = 'none';
            return;
        }
        display.style.display = 'block';
        display.innerHTML = `
            <div class="profile-summary">
                <h3>Profile Summary</h3>
                <div><strong>Name:</strong> ${p.name || '-'}</div>
                <div><strong>Phone:</strong> ${p.phone || '-'}</div>
                <div><strong>Age:</strong> ${p.age || '-'}</div>
                <div><strong>Weight:</strong> ${p.weight || '-'} kg</div>
                <div><strong>Height:</strong> ${p.height || '-'} cm</div>
                <div><strong>Diseases:</strong> ${p.diseases || '-'}</div>
                <div><strong>Emergency:</strong> ${p.emergency_contact || p.emergency || '-'} (${p.emergency_number || '-'})</div>
                <div><strong>Details:</strong> <div class="profile-details">${p.details || '-'}</div></div>
            </div>
        `;
    }

    // Toggle edit mode (only toggle form inputs, keep the Edit button enabled)
    function setEditMode(enabled) {
        Array.from(form.elements).forEach(el => {
            // keep buttons (edit, save) controllable separately
            if (el.tagName === 'BUTTON' || el.type === 'submit' || el.type === 'button') return;
            el.disabled = !enabled;
        });
        // Save button should be enabled only when editing
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) {
            saveBtn.disabled = !enabled;
            const label = saveBtn.querySelector('.btn-label');
            if (label) label.textContent = enabled ? 'Save' : 'Save';
        }
        if (editToggle) editToggle.textContent = enabled ? 'Cancel' : 'Edit';
    }

    // Initial edit mode will be set after we check if a profile exists (server or localStorage)

    form.onsubmit = function (e) {
        e.preventDefault();
        const data = new FormData(form);
        const name = data.get('name');
        if (!name || name.trim() === '') {
            msgEl.style.display = 'block';
            msgEl.style.color = 'red';
            msgEl.textContent = 'Name is required';
            return;
        }
        profile = {
            name: name,
            phone: data.get('phone'),
            age: data.get('age'),
            weight: data.get('weight'),
            height: data.get('height'),
            diseases: data.get('diseases'),
            emergency_contact: data.get('emergency'),
            emergency_number: data.get('emergencyNumber'),
            details: data.get('details')
        };
        if (token) {
            // send profile to server and handle success/failure explicitly
            fetch('http://localhost:3000/api/profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(profile)
            })
            .then(async (res) => {
                // parse body (if any)
                const bodyText = await res.text().catch(() => '');
                const body = bodyText ? JSON.parse(bodyText) : null;
                if (!res.ok) {
                    const errMsg = (body && (body.error || body.message)) || res.statusText || 'Server error';
                    throw new Error(errMsg);
                }
                return body || {};
            })
            .then(result => {
                // server returns profile object
                profile = result.profile || result || profile;
                // persist locally as cache so subsequent edits start from latest
                try { localStorage.setItem('profile', JSON.stringify(profile)); } catch(e) {}
                renderProfile();
                // show success message and lock form for editing
                msgEl.style.display = 'block';
                msgEl.style.color = 'green';
                msgEl.textContent = 'Saved successfully';
                renderSummary(profile);
                setTimeout(() => { msgEl.style.display = 'none'; }, 2000);
                setEditMode(false);
            })
            .catch(err => {
                console.error('Failed to save profile to server:', err);
                // show failure message and keep form editable
                msgEl.style.display = 'block';
                msgEl.style.color = 'red';
                msgEl.textContent = 'Save failed ';
                // allow user to retry save
                const saveBtn = document.getElementById('save-btn');
                if (saveBtn) saveBtn.disabled = false;
                // optionally save locally so user doesn't lose data
                localStorage.setItem('profile', JSON.stringify(profile));
            });
        } else {
            // No token: save locally
            localStorage.setItem('profile', JSON.stringify(profile));
            renderProfile();
            msgEl.style.display = 'block';
            msgEl.style.color = 'orange';
            msgEl.textContent = 'Saved locally (not synced to server)';
            setTimeout(() => { msgEl.style.display = 'none'; }, 2000);
            // keep in edit mode or lock? keep locked to mimic saved state
            setEditMode(false);
        }
    };

    // Edit toggle behavior
    if (editToggle) {
        editToggle.addEventListener('click', () => {
            const enabling = editToggle.textContent !== 'Cancel';
            if (enabling) {
                // start editing
                setEditMode(true);
                // clear any status message when editing
                if (msgEl) { msgEl.style.display = 'none'; }
                // focus first editable field
                const first = form.querySelector('input:not([disabled]), textarea:not([disabled])');
                if (first) first.focus();
            } else {
                // cancelling edits: restore values and lock
                fillForm(profile);
                setEditMode(false);
            }
        });
    }

    function renderProfile() {
        // Do not render profile details below the form. Keep form visible and filled.
        if (!profile) return;
        fillForm(profile);
        renderSummary(profile);
    }
});
