const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });


const app = express();
app.use(cors());
// Increase JSON and URL-encoded body size limits to allow base64 file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Firebase integration removed

// Initialize SQLite DB (use root workspace DB so DB Browser and server match)
const dbPath = path.join(__dirname, '..', 'healthcare.db');
const db = new sqlite3.Database(dbPath, (err) => {
	if (err) {
		console.error('Failed to open DB:', err.message || err);
		process.exit(1);
	}
});

// Configure sqlite pragmas to reduce lock contention
db.serialize(() => {
	// Set a busy timeout (in ms) so concurrent quick retries are attempted
	db.run("PRAGMA busy_timeout = 5000", [], (err) => {
		if (err) console.warn('Failed to set busy_timeout:', err.message || err);
		else console.log('Set SQLite busy_timeout = 5000ms');
	});
	// Use WAL mode for better concurrency between readers and writers
	db.run("PRAGMA journal_mode = WAL", [], (err) => {
		if (err) console.warn('Failed to set journal_mode:', err.message || err);
		else console.log('Set SQLite journal_mode = WAL');
	});
});

// Import password reset handlers
const passwordResetModule = require('./passwordReset');
let handleForgotPassword, handleResetPassword;

// Import chatbot handler
const { getResponse, loadedPromise } = require('./chatbot');

// Create tables
db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		role TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);

    
	db.run(`CREATE TABLE IF NOT EXISTS profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		phone TEXT,
		age TEXT,
		weight TEXT,
		height TEXT,
		diseases TEXT,
		emergency_contact TEXT,
		emergency_number TEXT,
		details TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);

    // Ensure `phone` column exists on older DBs where it wasn't present
    db.all("PRAGMA table_info(profiles)", [], (err, cols) => {
        if (err) {
            console.warn('Failed to check profiles table columns:', err && err.message ? err.message : err);
            return;
        }
        const hasPhone = Array.isArray(cols) && cols.some(c => c && c.name === 'phone');
        if (!hasPhone) {
            db.run("ALTER TABLE profiles ADD COLUMN phone TEXT", [], (alterErr) => {
                if (alterErr) console.warn('Failed to add phone column to profiles:', alterErr && alterErr.message ? alterErr.message : alterErr);
                else console.log('Added missing profiles.phone column');
            });
        }
    });

	db.run(`CREATE TABLE IF NOT EXISTS medications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		dosage TEXT NOT NULL,
		frequency TEXT NOT NULL,
		time TEXT NOT NULL,
		start_date DATE NOT NULL,
		end_date DATE,
		notes TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);

	// contacts table (includes optional email and emergency flag)
	db.run(`CREATE TABLE IF NOT EXISTS contacts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		relationship TEXT NOT NULL,
		phone TEXT NOT NULL,
		email TEXT,
		is_emergency_contact INTEGER DEFAULT 0,
		details TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS appointments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		doctor TEXT NOT NULL,
		location TEXT,
		date DATE NOT NULL,
		time TEXT NOT NULL,
		notes TEXT,
		completed INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);

	// Medical records table
	db.run(`CREATE TABLE IF NOT EXISTS records (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		file_data TEXT,
		file_size INTEGER,
		file_name TEXT,
		uploaded_by TEXT DEFAULT 'System',
		description TEXT,
		upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`);

	// Ensure legacy `remainders` table is removed (feature deprecated)
	db.run("DROP TABLE IF EXISTS remainders", [], (err) => {
		if (err) console.warn('Failed to drop legacy remainders table:', err && err.message ? err.message : err);
		else console.log('Removed legacy remainders table (if existed)');
	});

	// (Previously created fcm_tokens table removed from initialization)
});

// Helpers
function runAsync(sql, params=[]) {
	return new Promise((resolve, reject) => {
		db.run(sql, params, function(err) {
			if (err) return reject(err);
			resolve(this);
		});
	});
}

function getAsync(sql, params=[]) {
	return new Promise((resolve, reject) => {
		db.get(sql, params, (err, row) => {
			if (err) return reject(err);
			resolve(row);
		});
	});
}

function allAsync(sql, params=[]) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

// Notification support: optional SMTP transporter, Twilio client, and cron
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
	transporter = nodemailer.createTransport({
		service: process.env.SMTP_SERVICE || 'gmail',
		auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
	});
	console.log('SMTP transporter configured');
} else {
	console.log('SMTP not configured; reminder emails will be logged but not sent');
}

// Twilio SMS client
let smsClient = null;
let smsFromNumber = process.env.TWILIO_FROM_NUMBER || null;

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && smsFromNumber) {
	smsClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
	console.log('Twilio SMS configured');
} else {
	console.log('Twilio SMS not configured; SMS reminders will be skipped');
}

// Helper: normalize a phone to E.164 using optional default country code in env
function normalizeToE164(rawPhone) {
	if (!rawPhone) return null;
	// Remove spaces, dashes, brackets
	let p = String(rawPhone).replace(/[\s\-()\.]/g, '');
	if (!p) return null;
	// already E.164
	if (/^\+\d+$/.test(p)) return p;
	// If it starts with 0, strip leading zeroes (often local formatting)
	p = p.replace(/^0+/, '');
	// If there's a default country code, use it. Must be in +<digits> form
	const defaultCountry = process.env.DEFAULT_TWILIO_COUNTRY_CODE || '';
	if (defaultCountry && /^\+\d+$/.test(defaultCountry)) {
		return defaultCountry + p; // e.g. +91 + 8848826669 => +918848826669
	}
	// otherwise cannot safely normalize; return null so caller can handle
	return null;
}

function isValidE164(number) {
	return !!number && /^\+[1-9]\d{1,14}$/.test(number);
}

// Initialize password reset handlers with db instance
const passwordResetHandlers = passwordResetModule(db);
handleForgotPassword = passwordResetHandlers.handleForgotPassword;
handleResetPassword = passwordResetHandlers.handleResetPassword;

// Register
// Password reset routes
app.post('/api/auth/forgot-password', handleForgotPassword);
app.post('/api/auth/reset-password', handleResetPassword);

app.post('/api/auth/register', async (req, res) => {
	try {
        console.log('POST /api/auth/register body=', req.body);
		const { name, email, password, role } = req.body || {};
		if (!name || !email || !password || !role) return res.status(400).json({ error: 'All fields (name, email, password, role) are required.' });

		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format.' });
		if (!['patient','caregiver'].includes(role)) return res.status(400).json({ error: "Role must be 'patient' or 'caregiver'." });

		const existing = await getAsync('SELECT id FROM users WHERE email = ?', [email]);
		if (existing) return res.status(409).json({ error: 'Email already registered.' });

		const hashed = await bcrypt.hash(password, 10);
		await runAsync('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [name, email, hashed, role]);
		const user = await getAsync('SELECT id, name, email, role FROM users WHERE email = ?', [email]);
		return res.status(201).json({ message: 'User registered successfully', user });
	} catch (err) {
		console.error('Registration error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Registration failed due to server error.' });
	}
});

// Login
app.post('/api/auth/login', async (req, res) => {
	try {
        console.log('POST /api/auth/login body=', req.body);
		const { email, password } = req.body || {};
		if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

		const user = await getAsync('SELECT * FROM users WHERE email = ?', [email]);
		if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

		const valid = await bcrypt.compare(password, user.password);
		if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

		const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' });
		return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
	} catch (err) {
		console.error('Login error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Login failed due to server error.' });
	}
});

// Auth middleware
function auth(req, res, next) {
	try {
		const header = req.header('Authorization');
		if (!header) return res.status(401).json({ error: 'Authorization header missing.' });
		const token = header.replace('Bearer ', '');
		const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
		req.userId = decoded.userId;
		next();
	} catch (err) {
		return res.status(401).json({ error: 'Please authenticate.' });
	}
}

// Example protected route
// Medications endpoints
app.get('/api/medications', auth, async (req, res) => {
	try {
		const meds = await allAsync('SELECT * FROM medications WHERE user_id = ?', [req.userId]);
		return res.json(meds || []);
	} catch (err) {
		console.error('Get medications error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to fetch medications.' });
	}
});

app.post('/api/medications', auth, async (req, res) => {
	console.log('POST /api/medications called. userId=', req.userId, 'body=', req.body);
	try {
		const { name, dosage, frequency, time, start_date, end_date, notes } = req.body || {};
		if (!name || !dosage || !frequency || !time || !start_date) return res.status(400).json({ error: 'Missing required medication fields.' });
		const result = await runAsync('INSERT INTO medications (user_id, name, dosage, frequency, time, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.userId, name, dosage, frequency, time, start_date, end_date || null, notes || null]);
		const lastId = result.lastID || result.id || result.insertId;
		const created = await getAsync('SELECT * FROM medications WHERE id = ?', [lastId]);
		console.log('Medication created successfully:', created);
		return res.status(201).json({ medication: created });
	} catch (err) {
		console.error('Create medication error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to create medication.' });
	}
});

// Delete medication
app.delete('/api/medications/:id', auth, async (req, res) => {
	try {
		// Debug logging: show who is requesting deletion and the target id
		console.log('DELETE /api/medications/:id called. req.userId=', req.userId, 'targetId=', req.params.id);

		// Verify the medication belongs to the user
		const med = await getAsync('SELECT user_id FROM medications WHERE id = ?', [req.params.id]);
		if (!med) {
			return res.status(404).json({ error: 'Medication not found.' });
		}
		console.log('Medication owner user_id=', med.user_id);
		if (med.user_id !== req.userId) {
			return res.status(403).json({ error: 'Not authorized to delete this medication.' });
		}

		await runAsync('DELETE FROM medications WHERE id = ?', [req.params.id]);
		return res.json({ message: 'Medication deleted successfully.' });
	} catch (err) {
		console.error('Delete medication error:', err);
		return res.status(500).json({ error: 'Failed to delete medication.' });
	}
});

// Debug route to return userId extracted from Authorization token
app.get('/debug/whoami', (req, res) => {
	try {
		const header = req.header('Authorization');
		if (!header) return res.status(400).json({ error: 'Authorization header missing.' });
		const token = header.replace('Bearer ', '');
		const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
		return res.json({ userId: decoded.userId });
	} catch (err) {
		return res.status(401).json({ error: 'Invalid token or missing Authorization header.' });
	}
});

// Appointments endpoints
app.get('/api/appointments', auth, async (req, res) => {
	try {
		const appts = await allAsync('SELECT * FROM appointments WHERE user_id = ?', [req.userId]);
		return res.json(appts || []);
	} catch (err) {
		console.error('Get appointments error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to fetch appointments.' });
	}
});

app.post('/api/appointments', auth, async (req, res) => {
	console.log('POST /api/appointments called. userId=', req.userId, 'body=', req.body);
	try {
		const { title, doctor, location, date, time, notes } = req.body || {};
		if (!title || !date || !time) return res.status(400).json({ error: 'Missing required appointment fields (title, date, time).' });
	// doctor column is defined NOT NULL in the DB schema; use default if missing
	const doctorValue = doctor && doctor.trim() ? doctor : 'Not specified';
	const result = await runAsync('INSERT INTO appointments (user_id, title, doctor, location, date, time, notes, completed) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', [req.userId, title, doctorValue, location || null, date, time, notes || null]);
		const lastId = result.lastID || result.id || result.insertId;
		const created = await getAsync('SELECT * FROM appointments WHERE id = ?', [lastId]);
		console.log('Appointment created successfully:', created);
		return res.status(201).json({ appointment: created });
	} catch (err) {
		console.error('Create appointment error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to create appointment.' });
	}
});

// Delete appointment
app.delete('/api/appointments/:id', auth, async (req, res) => {
	try {
		console.log('DELETE /api/appointments/:id called. req.userId=', req.userId, 'targetId=', req.params.id);
		// Verify the appointment belongs to the user
		const appt = await getAsync('SELECT user_id FROM appointments WHERE id = ?', [req.params.id]);
		if (!appt) {
			return res.status(404).json({ error: 'Appointment not found.' });
		}
		console.log('Appointment owner user_id=', appt.user_id);
		if (appt.user_id !== req.userId) {
			return res.status(403).json({ error: 'Not authorized to delete this appointment.' });
		}

		await runAsync('DELETE FROM appointments WHERE id = ?', [req.params.id]);
		return res.json({ message: 'Appointment deleted successfully.' });
	} catch (err) {
		console.error('Delete appointment error:', err);
		return res.status(500).json({ error: 'Failed to delete appointment.' });
	}
});

// Mark appointment as complete
app.patch('/api/appointments/:id/complete', auth, async (req, res) => {
	try {
		console.log('PATCH /api/appointments/:id/complete called. req.userId=', req.userId, 'targetId=', req.params.id);
		// Verify the appointment belongs to the user
		const appt = await getAsync('SELECT user_id FROM appointments WHERE id = ?', [req.params.id]);
		if (!appt) {
			return res.status(404).json({ error: 'Appointment not found.' });
		}
		if (appt.user_id !== req.userId) {
			return res.status(403).json({ error: 'Not authorized to update this appointment.' });
		}

		await runAsync('UPDATE appointments SET completed = 1 WHERE id = ?', [req.params.id]);
		const updated = await getAsync('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
		return res.json({ appointment: updated });
	} catch (err) {
		console.error('Complete appointment error:', err);
		return res.status(500).json({ error: 'Failed to mark appointment as complete.' });
	}
});

// ==================== RECORDS ENDPOINTS ====================

// Get all records for user
app.get('/api/records', auth, async (req, res) => {
	try {
		const records = await allAsync('SELECT * FROM records WHERE user_id = ? ORDER BY upload_date DESC', [req.userId]);
		return res.json(records);
	} catch (err) {
		console.error('Get records error:', err);
		return res.status(500).json({ error: 'Failed to retrieve records.' });
	}
});

// Upload/Create record
app.post('/api/records', auth, async (req, res) => {
	try {
		const { name, type, description, file_data, file_size, file_name, uploaded_by } = req.body;
		
		if (!name || !type) {
			return res.status(400).json({ error: 'Name and type are required.' });
		}

		const result = await runAsync(
			`INSERT INTO records (user_id, name, type, description, file_data, file_size, file_name, uploaded_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[req.userId, name, type, description || null, file_data || null, file_size || null, file_name || null, uploaded_by || 'User']
		);

		const lastId = result.lastID || result.id || result.insertId;
		console.log('Record inserted with ID:', lastId);
		const created = await getAsync('SELECT * FROM records WHERE id = ?', [lastId]);
		console.log('Record created successfully:', created);
		
		return res.status(201).json({
			record: created,
			message: 'Record created successfully.'
		});
	} catch (err) {
		console.error('Create record error:', err);
		return res.status(500).json({ error: 'Failed to create record.' });
	}
});

// Get single record
app.get('/api/records/:id', auth, async (req, res) => {
	try {
		const record = await getAsync('SELECT * FROM records WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
		
		if (!record) {
			return res.status(404).json({ error: 'Record not found.' });
		}

		return res.json(record);
	} catch (err) {
		console.error('Get record error:', err);
		return res.status(500).json({ error: 'Failed to retrieve record.' });
	}
});

// Update record
app.put('/api/records/:id', auth, async (req, res) => {
	try {
		const { name, type, description } = req.body;
		
		// Verify the record belongs to the user
		const record = await getAsync('SELECT user_id FROM records WHERE id = ?', [req.params.id]);
		if (!record) {
			return res.status(404).json({ error: 'Record not found.' });
		}
		if (record.user_id !== req.userId) {
			return res.status(403).json({ error: 'Not authorized to update this record.' });
		}

		const updateFields = [];
		const updateValues = [];

		if (name !== undefined) {
			updateFields.push('name = ?');
			updateValues.push(name);
		}
		if (type !== undefined) {
			updateFields.push('type = ?');
			updateValues.push(type);
		}
		if (description !== undefined) {
			updateFields.push('description = ?');
			updateValues.push(description);
		}

		if (updateFields.length === 0) {
			return res.status(400).json({ error: 'No fields to update.' });
		}

		updateValues.push(req.params.id);
		const sql = `UPDATE records SET ${updateFields.join(', ')} WHERE id = ?`;

		await runAsync(sql, updateValues);
		return res.json({ message: 'Record updated successfully.' });
	} catch (err) {
		console.error('Update record error:', err);
		return res.status(500).json({ error: 'Failed to update record.' });
	}
});

// Delete record
app.delete('/api/records/:id', auth, async (req, res) => {
	try {
		// Verify the record belongs to the user
		const record = await getAsync('SELECT user_id FROM records WHERE id = ?', [req.params.id]);
		if (!record) {
			return res.status(404).json({ error: 'Record not found.' });
		}
		if (record.user_id !== req.userId) {
			return res.status(403).json({ error: 'Not authorized to delete this record.' });
		}

		await runAsync('DELETE FROM records WHERE id = ?', [req.params.id]);
		return res.json({ message: 'Record deleted successfully.' });
	} catch (err) {
		console.error('Delete record error:', err);
		return res.status(500).json({ error: 'Failed to delete record.' });
	}
});


// Canonical Profile endpoints (single implementation)
app.get('/api/profile', auth, async (req, res) => {
	try {
		const profile = await getAsync('SELECT * FROM profiles WHERE user_id = ?', [req.userId]);
		return res.json(profile || null);
	} catch (err) {
		console.error('Get profile error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to fetch profile.' });
	}
});

app.post('/api/profile', auth, async (req, res) => {
	try {
		console.log('POST /api/profile called. userId=', req.userId, 'body=', req.body);
		const { name, phone, age, weight, height, diseases, emergency_contact, emergency_number, details } = req.body || {};
		if (!name) return res.status(400).json({ error: 'Name is required.' });

		// Check if profile exists
		const existing = await getAsync('SELECT id FROM profiles WHERE user_id = ?', [req.userId]);
		if (existing) {
			console.log('Updating existing profile for userId:', req.userId);
			await runAsync(
				'UPDATE profiles SET name = ?, phone = ?, age = ?, weight = ?, height = ?, diseases = ?, emergency_contact = ?, emergency_number = ?, details = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
				[name, phone || null, age || null, weight || null, height || null, diseases || null, emergency_contact || null, emergency_number || null, details || null, req.userId]
			);
		} else {
			console.log('Creating new profile for userId:', req.userId);
			await runAsync(
				'INSERT INTO profiles (user_id, name, phone, age, weight, height, diseases, emergency_contact, emergency_number, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
				[req.userId, name, phone || null, age || null, weight || null, height || null, diseases || null, emergency_contact || null, emergency_number || null, details || null]
			);
		}

		const profile = await getAsync('SELECT * FROM profiles WHERE user_id = ?', [req.userId]);
		console.log('Profile saved successfully:', profile);
		return res.status(201).json({ profile });
	} catch (err) {
		console.error('Save profile error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to save profile.' });
	}
});

// ==================== CONTACTS ENDPOINTS ====================
// Get all contacts for user
app.get('/api/contacts', auth, async (req, res) => {
	try {
		const contacts = await allAsync('SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC', [req.userId]);
		return res.json(contacts || []);
	} catch (err) {
		console.error('Get contacts error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to fetch contacts.' });
	}
});

// Create contact
app.post('/api/contacts', auth, async (req, res) => {
	try {
		console.log('POST /api/contacts called. userId=', req.userId, 'body=', req.body);
		const { name, relation, relationship, phone, details } = req.body || {};
		if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required.' });

		const relationValue = relation || relationship || 'Other';
		const result = await runAsync(
			'INSERT INTO contacts (user_id, name, relationship, phone, details) VALUES (?, ?, ?, ?, ?)',
			[req.userId, name, relationValue, phone, details || null]
		);

		const lastId = result.lastID || result.id || result.insertId;
		const contact = await getAsync('SELECT * FROM contacts WHERE id = ?', [lastId]);
		console.log('Contact created successfully:', contact);
		return res.status(201).json({ contact });
	} catch (err) {
		console.error('Create contact error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to create contact.' });
	}
});

// Delete contact
app.delete('/api/contacts/:id', auth, async (req, res) => {
	try {
		// Verify the contact belongs to the user
		const contact = await getAsync('SELECT user_id FROM contacts WHERE id = ?', [req.params.id]);
		if (!contact) {
			return res.status(404).json({ error: 'Contact not found.' });
		}
		if (contact.user_id !== req.userId) {
			return res.status(403).json({ error: 'Not authorized to delete this contact.' });
		}

		await runAsync('DELETE FROM contacts WHERE id = ?', [req.params.id]);
		return res.json({ message: 'Contact deleted successfully.' });
	} catch (err) {
		console.error('Delete contact error:', err && err.message ? err.message : err);
		return res.status(500).json({ error: 'Failed to delete contact.' });
	}
});

// Chatbot endpoint
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;
    console.log("Chat request received:", userMessage);
    console.log("Request body:", req.body);
    
    if (!userMessage) {
      console.log("No message provided");
      return res.status(400).json({ error: 'Message is required.' });
    }
    
    console.log("Calling getResponse with:", userMessage);
    const botReply = await getResponse(userMessage);
    console.log("Bot reply:", botReply);
    
    if (!botReply) {
      return res.json({ reply: "I'm here to help! Could you please describe your symptoms?" });
    }
    
    res.json({ reply: botReply });
  } catch (error) {
    console.error('Chatbot error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to get chatbot response.', details: error.message });
  }
});

// Start server after dataset has loaded
const PORT = process.env.PORT || 3000;
// Health check endpoint (quick connectivity and DB basic check)
app.get('/health', async (req, res) => {
	try {
		// basic DB check
		let dbOk = true;
		try {
			await new Promise((resolve, reject) => {
				db.get('SELECT 1 as ok', [], (err, row) => {
					if (err) return reject(err);
					resolve(row);
				});
			});
		} catch (dbErr) {
			console.warn('DB health check failed:', dbErr && dbErr.message ? dbErr.message : dbErr);
			dbOk = false;
		}

		if (!dbOk) return res.status(500).json({ status: 'error', reason: 'database' });

		return res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
	} catch (err) {
		console.error('Health check error:', err);
		return res.status(500).json({ status: 'error' });
	}
});
loadedPromise.then(() => {
	// Start server with fallback: try PORT, then PORT+1, up to MAX_ATTEMPTS
	function startServer(port, attempts = 0, maxAttempts = 10) {
		const s = app.listen(port, () => {
			console.log(`Server running on port ${port} (dataset loaded)`);
		});

		s.once('error', (err) => {
			if (err && err.code === 'EADDRINUSE') {
				console.error(`Port ${port} is already in use.`);
				if (attempts < maxAttempts) {
					const nextPort = Number(port) + 1;
					console.error(`Attempting port ${nextPort} (attempt ${attempts + 1}/${maxAttempts}) ...`);
					s.close();
					return startServer(nextPort, attempts + 1, maxAttempts);
				}
				console.error(`Tried ${maxAttempts} ports and could not bind. Please stop the other process or run this app on a different port by setting the PORT environment variable (e.g. $env:PORT = '3001' in PowerShell).`);
				console.error(`Helpful commands (PowerShell):`);
				console.error(`  -> Get process using port ${port}: netstat -ano | findstr :${port}`);
				console.error(`  -> Then inspect PID and kill it (if safe): Stop-Process -Id <PID> -Force`);
				console.error(`Or run server on a different port: $env:PORT = '3001'; npm run dev`);
				process.exit(1);
			} else {
				console.error('Server error', err);
				process.exit(1);
			}
		});
	}

	startServer(PORT);
}).catch((err) => {
	console.error('Failed to load dataset, server not started:', err && err.message ? err.message : err);
	process.exit(1);
});

//---------------------------------------------
// STEP 4: EMAIL REMINDERS FOR MEDICATION + APPOINTMENTS
//---------------------------------------------

if (transporter || smsClient) {
    console.log("Email reminders activated");

    // Runs every minute
    cron.schedule("* * * * *", async () => {
        // Server already runs in IST (GMT+0530), use local time directly
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5); // HH:MM in local IST
        const today = now.toISOString().slice(0, 10); // yyyy-mm-dd (UTC date, but IST times stored as local HH:MM)

        // -----------------------------------------
        // 1. MEDICATION REMINDERS
        // -----------------------------------------
		const meds = await allAsync(
			`SELECT m.*, u.email, p.phone
			 FROM medications m
			 JOIN users u ON m.user_id = u.id
			 LEFT JOIN profiles p ON p.user_id = u.id
			 WHERE m.start_date <= ? AND (m.end_date IS NULL OR m.end_date >= ?)`,
			[today, today]
		);

        meds.forEach(med => {
            if (med.time === currentTime) {
				// Send email if configured
				if (transporter && med.email) {
					const mailOptions = {
						from: process.env.SMTP_USER,
						to: med.email,
						subject: `Medication Reminder: ${med.name}`,
						html: `
							<h2>Medication Reminder</h2>
							<p><b>Medication:</b> ${med.name}</p>
							<p><b>Dosage:</b> ${med.dosage}</p>
							<p><b>Time:</b> ${med.time}</p>
							<p><b>Notes:</b> ${med.notes || "None"}</p>
						`
					};
					transporter.sendMail(mailOptions, (err, info) => {
						const logEntry = {
							channel: 'email',
							type: 'medication',
							to: med.email,
							medId: med.id,
							time: med.time,
							timestamp: new Date().toISOString(),
							error: err ? (err && err.message ? err.message : String(err)) : null,
							info: info ? (info.response || JSON.stringify(info)) : null
						};
						if (err) console.error('Medication reminder sendMail error:', logEntry.error);
						else console.log(`Medication reminder sent to ${med.email}: ${logEntry.info}`);
						try {
							const fs = require('fs');
							fs.appendFileSync(path.join(__dirname, 'reminder_sends.log'), JSON.stringify(logEntry) + '\n');
						} catch (e) {
							console.warn('Failed to write reminder_sends.log', e && e.message ? e.message : e);
						}
					});
				}

				// SMS reminder (Twilio) for medication
				if (smsClient && med.phone) {
					const normTo = normalizeToE164(med.phone) || med.phone;
					if (!isValidE164(normTo)) {
						console.error('Skipping medication SMS; invalid E.164 number after normalization:', med.phone, '=>', normTo);
					} else {
						console.log('Attempting medication SMS send', { medId: med.id, to: normTo, from: smsFromNumber });
						smsClient.messages
							.create({
								body: `Medication Reminder: ${med.name} at ${med.time}. Dosage: ${med.dosage}.`,
								from: smsFromNumber,
								to: normTo
							})
							.then(msg => {
								console.log(`Medication SMS sent to ${normTo}: ${msg.sid}`);
							})
							.catch(err => {
								console.error('Medication SMS error:', err && err.message ? err.message : err);
								if (err && (err.code === 21211 || (err.message && err.message.toLowerCase().includes('invalid')))) {
									console.error('Twilio invalid To number error for:', normTo);
								}
							});
					}
				}
            }
        });

        // -----------------------------------------
        // 2. APPOINTMENT REMINDERS
        // -----------------------------------------
		const appts = await allAsync(
			`SELECT a.*, u.email, p.phone
			 FROM appointments a
			 JOIN users u ON a.user_id = u.id
			 LEFT JOIN profiles p ON p.user_id = u.id
			 WHERE a.date = ? AND a.time = ?`,
			[today, currentTime]
		);

        appts.forEach(appt => {
			if (transporter && appt.email) {
				const mailOptions = {
					from: process.env.SMTP_USER,
					to: appt.email,
					subject: `Appointment Reminder: ${appt.title}`,
					html: `
						<h2>Appointment Reminder</h2>
						<p><b>Title:</b> ${appt.title}</p>
						<p><b>Date:</b> ${appt.date}</p>
						<p><b>Time:</b> ${appt.time}</p>
						<p><b>Location:</b> ${appt.location}</p>
						<p><b>Notes:</b> ${appt.notes || "None"}</p>
					`
				};
				transporter.sendMail(mailOptions, (err, info) => {
					const logEntry = {
						channel: 'email',
						type: 'appointment',
						to: appt.email,
						apptId: appt.id,
						time: appt.time,
						timestamp: new Date().toISOString(),
						error: err ? (err && err.message ? err.message : String(err)) : null,
						info: info ? (info.response || JSON.stringify(info)) : null
					};
					if (err) console.error('Appointment reminder sendMail error:', logEntry.error);
					else console.log(`Appointment reminder sent to ${appt.email}: ${logEntry.info}`);
					try {
						const fs = require('fs');
						fs.appendFileSync(path.join(__dirname, 'reminder_sends.log'), JSON.stringify(logEntry) + '\n');
					} catch (e) {
						console.warn('Failed to write reminder_sends.log', e && e.message ? e.message : e);
					}
				});
			}

			// SMS reminder (Twilio) for appointment
			if (smsClient && appt.phone) {
				const normTo = normalizeToE164(appt.phone) || appt.phone;
				if (!isValidE164(normTo)) {
					console.error('Skipping appointment SMS; invalid E.164 number after normalization:', appt.phone, '=>', normTo);
				} else {
					console.log('Attempting appointment SMS send', { apptId: appt.id, to: normTo, from: smsFromNumber });
					smsClient.messages
						.create({
							body: `Appointment Reminder: ${appt.title} on ${appt.date} at ${appt.time}.`,
							from: smsFromNumber,
							to: normTo
						})
						.then(msg => {
							console.log(`Appointment SMS sent to ${normTo}: ${msg.sid}`);
						})
						.catch(err => {
							console.error('Appointment SMS error:', err && err.message ? err.message : err);
							if (err && (err.code === 21211 || (err.message && err.message.toLowerCase().includes('invalid')))) {
								console.error('Twilio invalid To number error for:', normTo);
							}
						});
				}
			}
        });

    });
} else {
    console.log("SMTP not configured — email reminders disabled.");
}




