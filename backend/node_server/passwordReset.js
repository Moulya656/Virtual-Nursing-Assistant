const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// This should be in your .env file
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// Create a transporter for sending emails
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
    }
});

// Store reset tokens temporarily (in production, use a database)
const resetTokens = new Map();

function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function sendResetEmail(email, token) {
    const resetLink = `http://localhost:3000/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    
    const mailOptions = {
        from: SMTP_USER,
        to: email,
        subject: 'Password Reset Request',
        html: `
            <h1>Password Reset Request</h1>
            <p>You requested to reset your password. Please click the link below to reset it:</p>
            <a href="${resetLink}">Reset Password</a>
            <p>If you didn't request this, please ignore this email.</p>
            <p>This link will expire in 1 hour.</p>
        `
    };

    return transporter.sendMail(mailOptions);
}

// Helper function to promisify db.get
function dbGet(db, sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            resolve(row);
        });
    });
}

// Helper function to promisify db.run
function dbRun(db, sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            resolve(this);
        });
    });
}

module.exports = (db) => ({
    handleForgotPassword: async (req, res) => {
        const { email } = req.body;
        
        try {
            // Check if user exists
            const user = await dbGet(
                db,
                'SELECT id, email FROM users WHERE email = ?',
                [email]
            );

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Generate and store reset token
            const token = generateResetToken();
            resetTokens.set(email, {
                token,
                timestamp: Date.now()
            });

            // Send reset email
            await sendResetEmail(email, token);

            res.json({ message: 'Reset instructions sent to email', token });
        } catch (error) {
            console.error('Password reset error:', error);
            res.status(500).json({ error: 'Failed to process password reset' });
        }
    },

    handleResetPassword: async (req, res) => {
        const { email, token, newPassword } = req.body;

        try {
            // Verify token
            const storedReset = resetTokens.get(email);
            if (!storedReset || storedReset.token !== token) {
                return res.status(400).json({ error: 'Invalid or expired reset token' });
            }

            // Check if token is expired (1 hour limit)
            if (Date.now() - storedReset.timestamp > 3600000) {
                resetTokens.delete(email);
                return res.status(400).json({ error: 'Reset token has expired' });
            }

            // Hash the new password
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update password in database
            await dbRun(
                db,
                'UPDATE users SET password = ? WHERE email = ?',
                [hashedPassword, email]
            );

            // Clear the used token
            resetTokens.delete(email);

            res.json({ message: 'Password successfully reset' });
        } catch (error) {
            console.error('Password update error:', error);
            res.status(500).json({ error: 'Failed to reset password' });
        }
    }
});