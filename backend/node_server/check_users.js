const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'healthcare.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
});

db.all("SELECT id, name, email, role FROM users LIMIT 10", (err, rows) => {
  if (err) {
    console.error('Error querying users:', err.message);
  } else {
    console.log('Users in database:');
    if (rows.length === 0) {
      console.log('  (no users found)');
    } else {
      rows.forEach(r => console.log(`  ID ${r.id}: ${r.name} (${r.email}) - ${r.role}`));
    }
  }
  db.close();
});
