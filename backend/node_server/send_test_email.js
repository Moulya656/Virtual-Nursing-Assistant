require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const nodemailer = require('nodemailer');

(async () => {
  try {
    const smtpService = process.env.SMTP_SERVICE || 'gmail';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    console.log('Using SMTP_SERVICE:', smtpService);
    console.log('SMTP_USER:', user ? user : '(not set)');
    if (!user || !pass) {
      console.error('SMTP_USER or SMTP_PASS missing in .env');
      process.exit(1);
    }

    const transporter = nodemailer.createTransport({
      service: smtpService,
      auth: { user, pass },
    });

    // Verify connection configuration
    transporter.verify((err, success) => {
      if (err) console.error('Transporter verify error:', err);
      else console.log('Transporter verified ok');
    });

    const mailOptions = {
      from: user,
      to: 'mlk656kukkila@gmail.com',
      subject: 'Test reminder (VNS) — please ignore',
      text: 'This is a test message from your VNS server to verify SMTP sending.'
    };

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error('SendMail error:', err);
        process.exit(1);
      }
      console.log('SendMail success:', info && info.response ? info.response : info);
      process.exit(0);
    });
  } catch (e) {
    console.error('Exception while sending test email:', e);
    process.exit(1);
  }
})();
