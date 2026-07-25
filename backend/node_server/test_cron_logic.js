require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const twilio = require('twilio');

let smsClient = null;
let smsFromNumber = process.env.TWILIO_FROM_NUMBER || null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && smsFromNumber) {
  smsClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('Twilio SMS configured for test_cron_logic');
} else {
  console.log('Twilio not configured for test_cron_logic');
}

const dbPath = path.join(__dirname, '..', 'healthcare.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('DB error:', err); process.exit(1); }
});

function allAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function normalizeToE164(rawPhone) {
  if (!rawPhone) return null;
  let p = String(rawPhone).replace(/[\s\-()\.]/g, '');
  if (/^\+\d+$/.test(p)) return p;
  const defaultCountry = process.env.DEFAULT_TWILIO_COUNTRY_CODE || '';
  if (defaultCountry && /^\+\d+$/.test(defaultCountry)) {
    p = p.replace(/^0+/, '');
    return defaultCountry + p;
  }
  return null;
}

(async () => {
  try {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0,5); // HH:MM
    const today = now.toISOString().slice(0,10); // YYYY-MM-DD
    
    console.log('Current server time (IST):', now.toString());
    console.log('Current HH:MM:', currentTime);
    console.log('Today date:', today);
    console.log('');

    // Check medications
    const meds = await allAsync(
      `SELECT m.*, u.email, p.phone FROM medications m JOIN users u ON m.user_id = u.id LEFT JOIN profiles p ON p.user_id = u.id WHERE m.start_date <= ? AND (m.end_date IS NULL OR m.end_date >= ?)`,
      [today, today]
    );
    
    console.log('Active medications today:', meds.length);
    meds.forEach(m => {
      const willTrigger = m.time === currentTime;
      console.log(`  [${willTrigger ? 'MATCH' : '     '}] id:${m.id} time:${m.time} name:"${m.name}" email:${m.email} phone:${m.phone}`);
      if (process.argv.includes('--send-sms') && willTrigger && smsClient && m.phone) {
        const norm = normalizeToE164(m.phone) || m.phone;
        if (!/^\+[1-9]\d{1,14}$/.test(norm)) {
          console.error('Skipping SMS; number not in E.164 after normalization:', m.phone, '=>', norm);
        } else {
          smsClient.messages.create({ body: `Test Medication reminder: ${m.name} at ${m.time}`, from: smsFromNumber, to: norm })
            .then(msg => console.log('Test SMS sent:', msg.sid))
            .catch(err => console.error('Test SMS error:', err && err.message ? err.message : err));
        }
      }
    });

    // Check appointments
    const appts = await allAsync(
      `SELECT a.*, u.email, p.phone FROM appointments a JOIN users u ON a.user_id = u.id LEFT JOIN profiles p ON p.user_id = u.id WHERE a.date = ? AND a.time = ?`,
      [today, currentTime]
    );
    
    console.log('Appointments matching now:', appts.length);
    appts.forEach(a => {
      console.log(`  [MATCH] id:${a.id} time:${a.time} title:"${a.title}" email:${a.email} phone:${a.phone}`);
      if (process.argv.includes('--send-sms') && smsClient && a.phone) {
        const norm = normalizeToE164(a.phone) || a.phone;
        if (!/^\+[1-9]\d{1,14}$/.test(norm)) {
          console.error('Skipping SMS; number not in E.164 after normalization:', a.phone, '=>', norm);
        } else {
          smsClient.messages.create({ body: `Test Appointment reminder: ${a.title} on ${a.date} at ${a.time}`, from: smsFromNumber, to: norm })
            .then(msg => console.log('Test SMS sent:', msg.sid))
            .catch(err => console.error('Test SMS error:', err && err.message ? err.message : err));
        }
      }
    });

    db.close();
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    db.close();
    process.exit(1);
  }
})();
