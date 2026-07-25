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
  console.log('Twilio SMS configured for trigger_send_med');
} else {
  console.log('Twilio not configured (trigger_send_med)');
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

const dbPath = path.join(__dirname, '..', 'healthcare.db');
const db = new sqlite3.Database(dbPath, (err) => { if (err) { console.error('DB open error', err); process.exit(1); } });

const medIdToSend = process.argv[2] ? Number(process.argv[2]) : null;
if (!medIdToSend) {
  console.error('Usage: node trigger_send_med.js <medication_id>');
  process.exit(1);
}

db.get('SELECT m.*, u.email, u.name as user_name, p.phone FROM medications m LEFT JOIN users u ON m.user_id = u.id LEFT JOIN profiles p ON p.user_id = u.id WHERE m.id = ?', [medIdToSend], async (err, med) => {
  if (err) { console.error('Query error:', err); db.close(); process.exit(1); }
  if (!med) { console.error('No medication found with id', medIdToSend); db.close(); process.exit(1); }

  if (!med.email && !med.phone) {
    console.error('Medication has no associated user contact (email or phone):', med);
    db.close(); process.exit(1);
  }

  const transporter = nodemailer.createTransport({ service: process.env.SMTP_SERVICE || 'gmail', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });

  const mailOptions = {
    from: process.env.SMTP_USER,
    to: med.email,
    subject: `Medication Reminder (TEST): ${med.name}`,
    html: `<h2>Medication Reminder (TEST)</h2><p>Medication: ${med.name}</p><p>Dosage: ${med.dosage || ''}</p><p>Time: ${med.time}</p>`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    const logEntry = { type: 'manual_test_med', medId: med.id, to: med.email, timestamp: new Date().toISOString(), error: err ? (err.message || err) : null, info: info ? (info.response || info) : null };
    console.log('Send result:', logEntry);
    try { fs.appendFileSync(path.join(__dirname, 'reminder_sends.log'), JSON.stringify(logEntry) + '\n'); } catch (e) { console.warn('Failed to write log', e); }
    // Attempt SMS if Twilio configured and phone exists
    if (smsClient && med.phone) {
      // normalize phone
      const norm = normalizeToE164(med.phone) || med.phone;
      if (!/^\+[1-9]\d{1,14}$/.test(norm)) {
        console.error('Skipping SMS; phone not E.164 after normalization:', med.phone, '=>', norm);
      } else {
        smsClient.messages.create({ body: `Medication Reminder (TEST): ${med.name} - ${med.dosage} at ${med.time}`, from: smsFromNumber, to: norm })
          .then(msg => console.log('Test medication SMS sent, sid:', msg.sid))
          .catch(err => {
            console.error('Test medication SMS error:', err && err.message ? err.message : err);
            // If Twilio returns invalid To error attempt fallback email or log
            if (err && (err.code === 21211 || (err.message && err.message.toLowerCase().includes('invalid')))) {
              console.error('Twilio invalid To number error for:', norm);
            }
          });
      }
    }
    db.close();
    process.exit(err ? 1 : 0);
  });
});
