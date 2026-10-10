const crypto = require('crypto');

// In-memory store for demo purposes. In production, use Redis or a DB table
// with an expiry column so codes survive server restarts and work across
// multiple server instances.
const otpStore = new Map(); // key: `${userId}:${requestId}` -> { code, expiresAt }

function generateOtp(userId, requestId) {
  const code = crypto.randomInt(100000, 999999).toString();
  const key = `${userId}:${requestId}`;
  otpStore.set(key, { code, expiresAt: Date.now() + 5 * 60 * 1000 }); // 5 min
  return code;
}

function verifyOtp(userId, requestId, code) {
  const key = `${userId}:${requestId}`;
  const entry = otpStore.get(key);
  if (!entry) return { ok: false, reason: 'No OTP was requested for this action.' };
  if (Date.now() > entry.expiresAt) { otpStore.delete(key); return { ok: false, reason: 'This code has expired. Request a new one.' }; }
  if (entry.code !== code) return { ok: false, reason: 'Incorrect code.' };
  otpStore.delete(key);
  return { ok: true };
}

module.exports = { generateOtp, verifyOtp };
