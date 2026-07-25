const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'healthcare.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('DB error:', err); process.exit(1); }
});

// Check the medication scheduled for 12:32
db.all(`SELECT m.id, m.user_id, m.name, m.dosage, m.frequency, m.time, m.start_date, m.end_date, m.notes, u.id as user_id_check, u.email, u.name as user_name 
        FROM medications m 
        LEFT JOIN users u ON m.user_id = u.id 
        WHERE m.time = '12:32'`, (err, rows) => {
  if (err) { console.error('Query error:', err); db.close(); return; }
  
  console.log('=== Medications scheduled for 12:32 ===');
  if (rows.length === 0) {
    console.log('(none found)');
  } else {
    rows.forEach(r => {
      console.log(JSON.stringify(r, null, 2));
    });
  }
  db.close();
});
