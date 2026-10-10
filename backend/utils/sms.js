const axios = require('axios');

// Wire this to a real Nigerian SMS provider once you have an account.
// Termii (termii.com) and Africa's Talking are the two most common choices
// for Nigerian phone numbers. Both have a simple REST "send message" call —
// drop your API key into .env as SMS_API_KEY and uncomment the real call below.
async function sendSms(phone, message) {
  if (!process.env.SMS_API_KEY) {
    console.log(`[SMS not configured — would send to ${phone}]: ${message}`);
    return { simulated: true };
  }

  // Example for Termii:
  // return axios.post('https://api.ng.termii.com/api/sms/send', {
  //   api_key: process.env.SMS_API_KEY,
  //   to: phone,
  //   from: 'WeddingNaija',
  //   sms: message,
  //   type: 'plain',
  //   channel: 'generic',
  // });
}

module.exports = { sendSms };
