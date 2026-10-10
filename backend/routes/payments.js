const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { initializeTransaction, verifyTransaction } = require('../utils/paystack');
const { generateOtp, verifyOtp } = require('../utils/otp');
const { sendSms } = require('../utils/sms');

const router = express.Router();

const UNLOCK_PRICE_NAIRA = 2500; // price to unlock one request's contact details

// POST /api/payments/unlock-request/send-otp  { requestId }
// Matches the reference site's flow: vendor requests a code before the
// wallet deduction for a single-request unlock is authorized.
router.post('/unlock-request/send-otp', requireAuth, requireRole('vendor'), async (req, res, next) => {
  const { requestId } = req.body;
  try {
    const vendor = await pool.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
    if (!vendor.rows.length) return res.status(400).json({ error: 'Create your vendor profile first.' });

    const user = await pool.query('SELECT phone FROM users WHERE id = $1', [req.user.id]);
    const code = generateOtp(req.user.id, requestId);
    await sendSms(user.rows[0]?.phone, `Your Wedding in Naija code is ${code}. It authorizes a one-time wallet deduction for this request only and expires in 5 minutes.`);

    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/payments/wallet — current balance
router.get('/wallet', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [req.user.id]);
    res.json({ balance: rows[0]?.balance ?? 0 });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/topup  { amountNaira }
// Starts a Paystack transaction. Frontend redirects the user to authorization_url.
router.post('/topup', requireAuth, async (req, res, next) => {
  const { amountNaira } = req.body;
  if (!amountNaira || amountNaira < 500) {
    return res.status(400).json({ error: 'Minimum top-up is ₦500.' });
  }

  const reference = `topup_${req.user.id}_${Date.now()}`;
  try {
    const wallet = await pool.query('SELECT id FROM wallets WHERE user_id = $1', [req.user.id]);
    await pool.query(
      `INSERT INTO wallet_transactions (wallet_id, amount, type, reference, status)
       VALUES ($1,$2,'topup',$3,'pending')`,
      [wallet.rows[0].id, amountNaira, reference]
    );

    const tx = await initializeTransaction({
      email: req.user.email,
      amountNaira,
      reference,
      metadata: { userId: req.user.id, purpose: 'wallet_topup' },
    });
    res.json(tx);
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/webhook — Paystack calls this when a transaction completes.
// Configure this exact URL in your Paystack dashboard.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.body) // raw Buffer, see server.js express.raw() mount
    .digest('hex');

  if (hash !== signature) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString());
  if (event.event === 'charge.success') {
    const { reference, status } = event.data;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txRes = await client.query(
        `UPDATE wallet_transactions SET status = $1 WHERE reference = $2 AND status = 'pending' RETURNING *`,
        [status === 'success' ? 'success' : 'failed', reference]
      );
      if (txRes.rows.length && status === 'success') {
        const tx = txRes.rows[0];
        await client.query('UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE id = $2', [
          tx.amount,
          tx.wallet_id,
        ]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Webhook processing error:', err);
    } finally {
      client.release();
    }
  }
  res.sendStatus(200);
});

// GET /api/payments/verify/:reference — frontend polls this after redirect back from Paystack
router.get('/verify/:reference', requireAuth, async (req, res, next) => {
  try {
    const result = await verifyTransaction(req.params.reference);
    res.json({ status: result.status });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/unlock-request  { requestId, otp }
// Verifies the OTP, then deducts UNLOCK_PRICE_NAIRA from the vendor's wallet
// and reveals contact info. This does NOT activate any timed package —
// matching the reference site's "single-request payment only" disclosure.
router.post('/unlock-request', requireAuth, requireRole('vendor'), async (req, res, next) => {
  const { requestId, otp } = req.body;

  const otpCheck = verifyOtp(req.user.id, requestId, otp);
  if (!otpCheck.ok) return res.status(400).json({ error: otpCheck.reason });

  const client = await pool.connect();
  try {
    const vendorRes = await client.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
    const vendorId = vendorRes.rows[0]?.id;
    if (!vendorId) return res.status(400).json({ error: 'Create your vendor profile first.' });

    const already = await client.query(
      'SELECT 1 FROM request_unlocks WHERE request_id = $1 AND vendor_id = $2',
      [requestId, vendorId]
    );
    if (already.rows.length) return res.status(409).json({ error: 'Already unlocked.' });

    await client.query('BEGIN');
    const wallet = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    if (Number(wallet.rows[0].balance) < UNLOCK_PRICE_NAIRA) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: `Insufficient wallet balance. Top up at least ₦${UNLOCK_PRICE_NAIRA}.` });
    }

    await client.query('UPDATE wallets SET balance = balance - $1, updated_at = now() WHERE id = $2', [
      UNLOCK_PRICE_NAIRA,
      wallet.rows[0].id,
    ]);
    await client.query(
      `INSERT INTO wallet_transactions (wallet_id, amount, type, reference, status)
       VALUES ($1,$2,'unlock_request',$3,'success')`,
      [wallet.rows[0].id, -UNLOCK_PRICE_NAIRA, `unlock_${requestId}_${Date.now()}`]
    );
    await client.query('INSERT INTO request_unlocks (request_id, vendor_id) VALUES ($1,$2)', [requestId, vendorId]);
    await client.query('COMMIT');

    const contact = await client.query(
      'SELECT contact_name, contact_phone, contact_whatsapp FROM requests WHERE id = $1',
      [requestId]
    );
    res.json({ unlocked: true, contact: contact.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/payments/buy-package  { packageId }
// Pays for a timed access package (30/90/180/365-day) out of wallet balance,
// then activates it and raises the vendor's listing tier where the package includes one.
router.post('/buy-package', requireAuth, requireRole('vendor'), async (req, res, next) => {
  const { packageId } = req.body;
  const client = await pool.connect();
  try {
    const vendor = await client.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
    const vendorId = vendor.rows[0]?.id;
    if (!vendorId) return res.status(400).json({ error: 'Create your vendor profile first.' });

    const pkg = await client.query('SELECT * FROM packages WHERE id = $1', [packageId]);
    if (!pkg.rows.length) return res.status(404).json({ error: 'Package not found.' });
    const { price, duration_days, name, perk } = pkg.rows[0];

    await client.query('BEGIN');
    const wallet = await client.query('SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    if (Number(wallet.rows[0].balance) < Number(price)) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: `Insufficient wallet balance. This package costs ₦${Number(price).toLocaleString()}.` });
    }

    await client.query('UPDATE wallets SET balance = balance - $1, updated_at = now() WHERE id = $2', [price, wallet.rows[0].id]);
    await client.query(
      `INSERT INTO wallet_transactions (wallet_id, amount, type, reference, status)
       VALUES ($1,$2,'package_purchase',$3,'success')`,
      [wallet.rows[0].id, -price, `package_${packageId}_${Date.now()}`]
    );
    await client.query(
      `INSERT INTO vendor_subscriptions (vendor_id, package_id, ends_at)
       VALUES ($1,$2, now() + ($3 || ' days')::interval)`,
      [vendorId, packageId, duration_days]
    );

    // Packages that mention a tier upgrade in their perk text raise the listing tier
    if (/gold/i.test(perk)) await client.query(`UPDATE vendor_profiles SET tier = 'gold' WHERE id = $1`, [vendorId]);
    else if (/silver/i.test(perk)) await client.query(`UPDATE vendor_profiles SET tier = 'silver' WHERE id = $1`, [vendorId]);

    await client.query('COMMIT');
    res.json({ activated: name, endsInDays: duration_days });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
