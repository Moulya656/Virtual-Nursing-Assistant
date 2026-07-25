const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'healthcare.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('Failed to open DB:', err.message); process.exit(1); }
});

// Check medication entries and their user emails
db.all(`SELECT m.id, m.user_id, m.name, m.time, m.start_date, m.end_date, u.email, u.name as user_name
        FROM medications m
        LEFT JOIN users u ON m.user_id = u.id
        ORDER BY m.id`, (err, rows) => {
  if (err) {
    console.error('Error querying medications:', err.message);
    db.close();
    return;
  }
  console.log('Medications:');
  rows.forEach(r => console.log(JSON.stringify(r)));
  db.close();
});
