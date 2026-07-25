const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'healthcare.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
});

function nowInfo() {
  const now = new Date();
  // server runs in IST; format same as cron
  const currentTime = now.toTimeString().slice(0,5); // HH:MM
  const today = now.toISOString().slice(0,10); // YYYY-MM-DD (UTC-derived but server in IST yields local date)
  return { now, currentTime, today };
}

const { currentTime, today } = nowInfo();
console.log('Checking triggers for IST time:', currentTime, 'date:', today);

function allAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

(async () => {
  try {
    // Medications that are within active date range
    const meds = await allAsync(
      `SELECT m.id,m.user_id,m.name,m.time,m.start_date,m.end_date,u.email FROM medications m JOIN users u ON m.user_id = u.id WHERE m.start_date <= ? AND (m.end_date IS NULL OR m.end_date >= ?)`,
      [today,today]
    );

    console.log('\nMedications considered (active today):', meds.length);
    let medMatches = 0;
    meds.forEach(m => {
      const stored = (m.time || '').slice(0,5);
      const willTrigger = stored === currentTime;
      if (willTrigger) medMatches++;
      console.log(`- [${willTrigger ? 'TRIGGER' : '    '}] id:${m.id} user:${m.user_id} name:"${m.name}" time:${m.time} start:${m.start_date} end:${m.end_date || 'null'} email:${m.email}`);
    });

    // Appointments scheduled exactly for now
    const appts = await allAsync(
      `SELECT a.id,a.user_id,a.title,a.date,a.time,u.email FROM appointments a JOIN users u ON a.user_id = u.id WHERE a.date = ? AND a.time = ?`,
      [today, currentTime]
    );

    console.log('\nAppointments matching now:', appts.length);
    appts.forEach(a => {
      console.log(`- [TRIGGER] id:${a.id} user:${a.user_id} title:"${a.title}" date:${a.date} time:${a.time} email:${a.email}`);
    });

    if (medMatches===0 && appts.length===0) {
      console.log('\nNo reminders would be sent at this exact minute.');
    }
  } catch (err) {
    console.error('Error checking triggers:', err && err.message ? err.message : err);
  } finally {
    db.close();
  }
})();
