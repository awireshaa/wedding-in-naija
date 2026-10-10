const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All routes below require an admin-role account.
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/overview — top-line numbers for the dashboard homepage
router.get('/overview', async (req, res, next) => {
  try {
    const [users, vendors, requests, walletTotal, pendingPayouts] = await Promise.all([
      pool.query(`SELECT role, COUNT(*) FROM users GROUP BY role`),
      pool.query(`SELECT COUNT(*) FROM vendor_profiles`),
      pool.query(`SELECT status, COUNT(*) FROM requests GROUP BY status`),
      pool.query(`SELECT COALESCE(SUM(balance),0) AS total FROM wallets`),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM admin_payouts WHERE status = 'pending'`),
    ]);
    res.json({
      usersByRole: users.rows,
      vendorCount: Number(vendors.rows[0].count),
      requestsByStatus: requests.rows,
      totalWalletBalance: Number(walletTotal.rows[0].total),
      pendingPayoutTotal: Number(pendingPayouts.rows[0].total),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users?role=&page=1 — every signup, newest first
router.get('/users', async (req, res, next) => {
  const { role, page = 1 } = req.query;
  const limit = 50;
  const offset = (Math.max(1, Number(page)) - 1) * limit;
  try {
    const values = [];
    let where = '';
    if (role) { values.push(role); where = `WHERE role = $1`; }
    values.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, email, phone, full_name, role, created_at FROM users
       ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json({ users: rows, page: Number(page) });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/transactions?page=1 — every wallet top-up / spend, newest first
router.get('/transactions', async (req, res, next) => {
  const { page = 1 } = req.query;
  const limit = 50;
  const offset = (Math.max(1, Number(page)) - 1) * limit;
  try {
    const { rows } = await pool.query(
      `SELECT t.*, u.email, u.full_name FROM wallet_transactions t
       JOIN wallets w ON w.id = t.wallet_id
       JOIN users u ON u.id = w.user_id
       ORDER BY t.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ transactions: rows, page: Number(page) });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/flagged-requests — requests reported by vendors
router.get('/flagged-requests', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM requests WHERE status = 'flagged' ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/payouts — payout ledger (money you've moved to your bank)
router.get('/payouts', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM admin_payouts ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/payouts  { amount, bank_ref }
// Records that you're moving collected top-up money to your real bank account.
// This does NOT move money itself — you do the actual transfer in your bank
// or Paystack settlement dashboard; this just keeps a ledger of it.
router.post('/payouts', async (req, res, next) => {
  const { amount, bank_ref } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO admin_payouts (amount, bank_ref, requested_by, status)
       VALUES ($1,$2,$3,'pending') RETURNING *`,
      [amount, bank_ref || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/payouts/:id/complete — mark a payout as done once the transfer clears
router.put('/payouts/:id/complete', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE admin_payouts SET status = 'completed' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Payout not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/vendors/:id/verify — mark a vendor's contact as verified
router.put('/vendors/:id/verify', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE vendor_profiles SET contact_verified = true WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vendor not found.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/vendors/:id — remove a vendor listing (e.g. fraud, complaint)
router.delete('/vendors/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM vendor_profiles WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
