// appointments.js

document.addEventListener('DOMContentLoaded', function () {
    const calendarDiv = document.getElementById('calendar');
    const upcomingDiv = document.getElementById('upcoming-appointments');
    const modal = document.getElementById('add-appointment-modal');
    const form = document.getElementById('appointment-form');

    // Example appointments
    let appointments = [
        { title: 'Teeth Checkup', date: getFutureDate(2), time: '09:30', location: 'Dental Clinic', notes: 'Routine cleaning', completed: false },
        { title: 'Doctor Visit', date: getFutureDate(5), time: '11:00', location: 'City Hospital', notes: 'General checkup', completed: false }
    ];

    function generateUid() { return `${Date.now()}-${Math.random().toString(36).slice(2,9)}`; }

    // Load from backend if logged in, otherwise from localStorage
    const token = localStorage.getItem('token');
    // Wire up WhoAmI debug button (shows userId encoded in token via /debug/whoami)
    const whoamiBtn = document.getElementById('whoami-btn');
    const whoamiDisplay = document.getElementById('whoami-display');
    if (whoamiBtn) {
        whoamiBtn.addEventListener('click', () => {
            const t = localStorage.getItem('token');
            if (!t) {
                whoamiDisplay.textContent = 'Not logged in';
                return;
            }
            whoamiDisplay.textContent = 'Checking...';
            fetch('http://localhost:3000/debug/whoami', { headers: { 'Authorization': `Bearer ${t}` } })
                .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(b)))
                .then(j => {
                    whoamiDisplay.textContent = `userId: ${j.userId}`;
                })
                .catch(err => {
                    console.error('WhoAmI error', err);
                    whoamiDisplay.textContent = err && err.error ? err.error : 'Error';
                });
        });
    }
    if (token) {
        fetch('http://localhost:3000/api/appointments', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.ok ? r.json() : Promise.reject(r)).then(data => {
            appointments = (data || []).map(a => {
                // Ensure objects are consistent in the frontend: add a local uid for persistence when needed
                // Normalize completed field (can be numeric or string from DB) to boolean
                const completed = Number(a.completed) === 1 || Boolean(a.completed === true);
                return { ...a, completed, uid: a.id ? (a.uid || '') : (a.uid || generateUid()) };
            });
            renderCalendar();
            renderUpcoming();
        }).catch(err => {
            console.warn('Failed to fetch appointments from server, falling back to localStorage', err);
            if (localStorage.getItem('appointments')) appointments = JSON.parse(localStorage.getItem('appointments'));
            renderCalendar();
            renderUpcoming();
        });
    } else {
        if (localStorage.getItem('appointments')) {
            appointments = JSON.parse(localStorage.getItem('appointments')) || [];
            // Ensure local-only appointments have a uid and completed is boolean
            appointments = appointments.map(a => ({ ...a, completed: Boolean(a.completed), uid: a.id ? (a.uid || '') : (a.uid || generateUid()) }));
        }
    }

    function getFutureDate(daysAhead) {
        const d = new Date();
        d.setDate(d.getDate() + daysAhead);
        return d.toISOString().slice(0, 10);
    }

    // state for displayed month
    let viewYear = new Date().getFullYear();
    let viewMonth = new Date().getMonth(); // 0-based

    // Register delegated click handler once so it works for dynamically-rendered appointment blocks
    upcomingDiv.addEventListener('click', function (e) {
        const target = e.target;
        function findIndexByAttrs(apptId, apptUid) {
            if (apptId) return appointments.findIndex(a => String(a.id) === String(apptId));
            if (apptUid) return appointments.findIndex(a => String(a.uid) === String(apptUid));
            return -1;
        }

        if (target.classList && target.classList.contains('delete-appt-btn')) {
            const apptId = target.getAttribute('data-id');
            const apptUid = target.getAttribute('data-uid');
            let idx = findIndexByAttrs(apptId, apptUid);
            const token = localStorage.getItem('token');
            const backup = idx > -1 ? { ...appointments[idx] } : null;
            if (idx > -1) appointments.splice(idx, 1);
            localStorage.setItem('appointments', JSON.stringify(appointments));
            renderCalendar();
            renderUpcoming();

            if (token && apptId) {
                fetch(`http://localhost:3000/api/appointments/${apptId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                }).then(r => {
                    if (r.ok) return r.json().catch(() => ({}));
                    return r.json().then(b => Promise.reject(b));
                }).then(() => {
                    localStorage.setItem('appointments', JSON.stringify(appointments));
                    renderCalendar();
                    renderUpcoming();
                }).catch(err => {
                    console.error('Failed to delete appointment:', err);
                    if (backup) appointments.splice(idx, 0, backup);
                    localStorage.setItem('appointments', JSON.stringify(appointments));
                    renderCalendar();
                    renderUpcoming();
                    alert('Failed to delete appointment. Please try again.');
                });
            }
        }

        if (target.classList && target.classList.contains('complete-appt-btn')) {
            const apptId = target.getAttribute('data-id');
            const apptUid = target.getAttribute('data-uid');
            let idx = findIndexByAttrs(apptId, apptUid);
            if (idx > -1) {
                appointments[idx].completed = true;
                localStorage.setItem('appointments', JSON.stringify(appointments));
                renderCalendar();
                renderUpcoming();
            } else {
                console.warn('Appointment to complete not found locally', apptId, apptUid);
            }
        }
    });

    function updateMonthLabel() {
        const d = new Date(viewYear, viewMonth, 1);
        const label = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
        document.getElementById('month-label').textContent = label;
    }

    function renderCalendar() {
        // Show calendar for viewYear/viewMonth
        const firstDay = new Date(viewYear, viewMonth, 1);
        const lastDay = new Date(viewYear, viewMonth + 1, 0);
        let html = `<div class="calendar-grid"><div class="cal-head">Sun</div><div class="cal-head">Mon</div><div class="cal-head">Tue</div><div class="cal-head">Wed</div><div class="cal-head">Thu</div><div class="cal-head">Fri</div><div class="cal-head">Sat</div>`;
        for (let i = 0; i < firstDay.getDay(); i++) html += '<div class="cal-empty"></div>';
            for (let d = 1; d <= lastDay.getDate(); d++) {
            const dateStr = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dayAppts = appointments.filter(a => a.date === dateStr && !a.completed);
            html += `<div class="cal-day${dayAppts.length ? ' cal-has-appt' : ''}" data-date="${dateStr}">${d}`;
            if (dayAppts.length) {
                // show a small dot or count
                html += `<div class="appts-indicator">${dayAppts.length}</div>`;
            }
            html += `</div>`;
        }
        html += '</div>';
        calendarDiv.innerHTML = html;
        updateMonthLabel();

        // clicking on a day can scroll to upcoming list or filter
        document.querySelectorAll('.cal-day').forEach(el => {
            el.addEventListener('click', () => {
                const d = el.getAttribute('data-date');
                // filter upcoming to that date
                const filtered = appointments.filter(a => a.date === d && !a.completed);
                if (filtered.length) {
                    upcomingDiv.innerHTML = '';
                    filtered.forEach((appt, idx) => {
                        const block = document.createElement('div');
                        block.className = 'appointment-block';
                        // Use the appointment id as the stable identifier (data-id)
                        const apptIdAttr = appt.id || '';
                        const apptUidAttr = appt.uid || '';
                        block.innerHTML = `
                                    <strong>${appt.title}</strong> <br>
                                    <span class="appt-date">${appt.date} at ${appt.time}</span><br>
                                    <span class="appt-location">${appt.location || ''}</span><br>
                                    <span class="appt-notes">${appt.notes || ''}</span><br>
                                    <button class="delete-appt-btn" data-id="${apptIdAttr}" data-uid="${apptUidAttr}">Delete</button>
                                    <button class="complete-appt-btn" data-id="${apptIdAttr}" data-uid="${apptUidAttr}">Mark as Visited</button>
                                `;
                        upcomingDiv.appendChild(block);
                    });
                }
            });
        });
    }

    function renderUpcoming() {
        // Show upcoming appointments in beautiful blocks
        let upcoming = appointments.filter(a => !a.completed && new Date(a.date) >= new Date());
        upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
        if (upcoming.length === 0) {
            upcomingDiv.innerHTML = '<p>No upcoming appointments. Add one below.</p>';
            return;
        }
        upcomingDiv.innerHTML = '';
        upcoming.forEach((appt, idx) => {
            const block = document.createElement('div');
            block.className = 'appointment-block';
            const apptIdAttr = appt.id || '';
            const apptUidAttr = appt.uid || '';
            block.innerHTML = `
                <strong>${appt.title}</strong> <br>
                <span class="appt-date">${appt.date} at ${appt.time}</span><br>
                <span class="appt-location">${appt.location || ''}</span><br>
                <span class="appt-notes">${appt.notes || ''}</span><br>
                <button class="delete-appt-btn" data-id="${apptIdAttr}" data-uid="${apptUidAttr}">Delete</button>
                <button class="complete-appt-btn" data-id="${apptIdAttr}" data-uid="${apptUidAttr}">Mark as Visited</button>
            `;
            upcomingDiv.appendChild(block);
        });
        
    }

    // Show modal
    window.showAddAppointmentForm = function () {
        modal.classList.remove('hidden');
    };
    // Close modal
    window.closeAppointmentModal = function () {
        modal.classList.add('hidden');
        form.reset();
    };
    // Handle form submit
    form.onsubmit = function (e) {
        e.preventDefault();
        const data = new FormData(form);
        const title = data.get('title');
        const date = data.get('date');
        const time = data.get('time');
        if (!title || !date || !time) {
            alert('Title, date, and time are required');
            return;
        }
        const newAppt = {
            title: title,
            doctor: data.get('doctor') || 'Not specified',
            date: date,
            time: time,
            location: data.get('location') || '',
            notes: data.get('subject') || '',
            completed: false
        };
        if (token) {
            fetch('http://localhost:3000/api/appointments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(newAppt)
            }).then(r => r.json()).then(result => {
                if (result && result.appointment) {
                    // server-created appointment includes an id; normalize completed
                    const srvAppt = { ...result.appointment, completed: Number(result.appointment.completed) === 1 };
                    appointments.push(srvAppt);
                } else {
                    // saving locally: give it a uid for indexing
                    newAppt.uid = newAppt.uid || generateUid();
                    appointments.push(newAppt);
                }
                localStorage.setItem('appointments', JSON.stringify(appointments));
                renderCalendar();
                renderUpcoming();
            }).catch(err => {
                console.error('Failed to save appointment to server, saving locally', err);
                newAppt.uid = newAppt.uid || generateUid();
                appointments.push(newAppt);
                localStorage.setItem('appointments', JSON.stringify(appointments));
                renderCalendar();
                renderUpcoming();
            });
        } else {
            newAppt.uid = newAppt.uid || generateUid();
            appointments.push(newAppt);
            localStorage.setItem('appointments', JSON.stringify(appointments));
            renderCalendar();
            renderUpcoming();
        }
        closeAppointmentModal();
    };

    // Month navigation
    document.getElementById('prev-month').addEventListener('click', () => {
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        renderCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        renderCalendar();
    });

    renderCalendar();
    renderUpcoming();
});
