require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const twilio = require('twilio');
const smsClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const smsFromNumber = process.env.TWILIO_FROM_NUMBER;

const toNumber = process.argv[2];
if (!toNumber) {
  console.error('Usage: node send_test_sms.js <TO_NUMBER_IN_E164>');
  process.exit(1);
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

const toNormalized = normalizeToE164(toNumber) || toNumber;
console.log('Using Twilio:', !!smsClient, 'From:', smsFromNumber, 'To (normalized):', toNormalized);

smsClient.messages.create({ body: 'Test message from VNS', from: smsFromNumber, to: toNormalized })
  .then(msg => console.log('SMS sent:', msg.sid))
  .catch(err => console.error('SMS error:', err && err.message ? err.message : err));
