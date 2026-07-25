// DOM Elements
const authSection = document.getElementById('auth-section');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

// Auth Functions
function showLogin() {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    document.getElementById('forgot-password-form').classList.add('hidden');
}

function showRegister() {
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    document.getElementById('forgot-password-form').classList.add('hidden');
}

function showForgotPassword() {
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    document.getElementById('forgot-password-form').classList.remove('hidden');
    document.getElementById('reset-password-form').classList.add('hidden');
}

function showResetPasswordForm() {
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    document.getElementById('forgot-password-form').classList.add('hidden');
    document.getElementById('reset-password-form').classList.remove('hidden');
}

// Handle forgot password form submission
document.getElementById('forgot-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const email = formData.get('email');
    
    try {
        const response = await fetch('http://localhost:3000/api/auth/forgot-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });
        
        if (response.ok) {
            const resetToken = await response.json();
            // Store the reset token temporarily
            sessionStorage.setItem('resetEmail', email);
            sessionStorage.setItem('resetToken', resetToken.token);
            showResetPasswordForm();
            alert('Please enter your new password.');
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to process password reset request.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to connect to the server. Please try again later.');
    }
});

// Handle password reset form submission
document.getElementById('reset-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const email = sessionStorage.getItem('resetEmail');
    const resetToken = sessionStorage.getItem('resetToken');

    if (newPassword !== confirmPassword) {
        alert('Passwords do not match!');
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/api/auth/reset-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                token: resetToken,
                newPassword
            })
        });

        if (response.ok) {
            alert('Password has been successfully reset. Please login with your new password.');
            // Clear the session storage
            sessionStorage.removeItem('resetEmail');
            sessionStorage.removeItem('resetToken');
            showLogin();
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to reset password.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to connect to the server. Please try again later.');
    }
});

function logout() {
    authSection.classList.remove('hidden');
    dashboard.classList.add('hidden');
    localStorage.removeItem('user');
}

// API Functions
async function register(userData) {
    try {
        console.log('Register payload:', userData);
        const response = await fetch('http://localhost:3000/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData),
        });

        // If response is not OK, attempt to parse JSON error body, otherwise throw
        if (!response.ok) {
            let errText = `Registration failed (status ${response.status})`;
            try {
                const errBody = await response.json();
                if (errBody && errBody.error) errText += `: ${errBody.error}`;
            } catch (e) {
                // ignore JSON parse errors
            }
            alert(errText);
            return;
        }

        const data = await response.json();
        alert('Registration successful! Please login.');
        showLogin();
    } catch (error) {
        console.error('Registration error:', error);
        // Provide a more actionable message
        const msg = error && error.message ? error.message : String(error);
        alert(`Unable to connect to the registration service. ${msg}\nMake sure the backend is running at http://localhost:3000`);
    }
}

async function login(email, password) {
    try {
        console.log('Login payload:', { email, password: password ? '***' : '' });
        const response = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });
        
        if (response.ok) {
                const data = await response.json();
                // Backend returns { token, user } — store both cleanly
                try {
                    if (data.token) localStorage.setItem('token', data.token);
                    // store the user object itself so loadDashboardData can read user.name
                    const userObj = data.user || data;
                    localStorage.setItem('user', JSON.stringify(userObj));
                } catch (e) {
                    console.error('Failed to save login data to localStorage', e);
                }
                showDashboard();
            } else {
            // Attempt to parse error details from server
            let errMsg = 'Login failed. Please check your credentials.';
            try {
                const errBody = await response.json();
                if (errBody && (errBody.error || errBody.message)) errMsg = errBody.error || errBody.message;
            } catch (e) {
                console.warn('Failed to parse login error body', e);
            }
            console.warn('Login failed', response.status, response.statusText);
            alert(errMsg);
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login.');
    }
}

// Note: `register` is implemented above. Duplicate implementation removed to avoid
// accidental shadowing and potential syntax issues.

// Dashboard Functions
function showDashboard() {
    authSection.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadDashboardData();
}

async function loadDashboardData() {
    const stored = localStorage.getItem('user');
    let user = null;
    if (stored) {
        try {
            user = JSON.parse(stored);
        } catch (e) {
            console.error('Failed to parse stored user:', e);
        }
    }

    if (!user) {
        logout();
        return;
    }

    // user may be stored directly or wrapped; normalize
    const displayName = user.name || (user.user && user.user.name) || 'User';
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = displayName;
    await Promise.all([
        // Temporarily comment out these functions until they're implemented
        // loadMedications(),
        // loadAppointments(),
        // loadContacts()
    ]);
}

// Event Listeners
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(loginForm);
    const email = formData.get('email');
    const password = formData.get('password');
    await login(email, password);
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(registerForm);
    const userData = {
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        role: formData.get('role'),
    };
    await register(userData);
});

// Notification Functions
function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission();
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
    }
}

// Chatbot functions
function toggleChatbot() {
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
        chatContainer.classList.toggle('hidden');
    }
}

async function sendMessage() {
    const userInput = document.getElementById('user-input');
    const chatBox = document.getElementById('chat-box');
    if (!userInput || !chatBox) return;

    const message = userInput.value.trim();
    if (!message) return;

    const token = localStorage.getItem('token');
    if (!token) {
        alert('Please log in first.');
        return;
    }

    // Display user message
    const userMessageDiv = document.createElement('div');
    userMessageDiv.textContent = `You: ${message}`;
    userMessageDiv.style.marginBottom = '8px';
    userMessageDiv.style.color = '#333';
    chatBox.appendChild(userMessageDiv);

    userInput.value = '';

    try {
        const response = await fetch('http://localhost:3000/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            throw new Error(`Chatbot error: ${response.status}`);
        }

        const data = await response.json();
        const botResponseDiv = document.createElement('div');
        botResponseDiv.textContent = `Bot: ${data.reply || data.response || 'No response'}`;
        botResponseDiv.style.marginBottom = '8px';
        botResponseDiv.style.color = '#0066cc';
        chatBox.appendChild(botResponseDiv);

        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (error) {
        console.error('Chatbot error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.textContent = `Error: ${error.message}`;
        errorDiv.style.marginBottom = '8px';
        errorDiv.style.color = 'red';
        chatBox.appendChild(errorDiv);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    requestNotificationPermission();
    const user = localStorage.getItem('user');
    if (user) {
        showDashboard();
    }
    // Warn if frontend is opened via file:// which can prevent fetch from working
    if (window.location.protocol === 'file:') {
        console.warn('Frontend is being served from file:// — API requests to http://localhost:3000 may fail. Serve the frontend over HTTP (e.g. python -m http.server)');
        const authBox = document.getElementById('auth-section');
        if (authBox) {
            const warn = document.createElement('div');
            warn.style.color = 'darkred';
            warn.style.marginTop = '8px';
            warn.textContent = 'Warning: page opened via file:// — use a local HTTP server to ensure API requests work.';
            authBox.insertBefore(warn, authBox.firstChild);
        }
    }
});