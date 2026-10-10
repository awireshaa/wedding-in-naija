const axios = require('axios');

const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});

// amountNaira: whole naira amount (Paystack expects kobo, so we x100)
async function initializeTransaction({ email, amountNaira, reference, metadata }) {
  const { data } = await paystack.post('/transaction/initialize', {
    email,
    amount: Math.round(amountNaira * 100),
    reference,
    metadata,
    callback_url: `${process.env.FRONTEND_URL}/payment-complete`,
  });
  return data.data; // { authorization_url, access_code, reference }
}

async function verifyTransaction(reference) {
  const { data } = await paystack.get(`/transaction/verify/${reference}`);
  return data.data; // { status: 'success' | 'failed', amount, ... }
}

module.exports = { initializeTransaction, verifyTransaction };
