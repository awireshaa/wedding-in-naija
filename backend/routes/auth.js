const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { notifyNewUser } = require('../utils/email');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
}

// POST /api/auth/register  { email, password, full_name, phone, role }
router.post('/register', async (req, res, next) => {
  const { email, password, full_name, phone, role } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const client = await pool.connect();
  try {
    const exists = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'An account with this email already exists.' });

    if (phone) {
      const phoneExists = await client.query('SELECT id FROM users WHERE phone = $1', [phone]);
      if (phoneExists.rows.length) return res.status(409).json({ error: 'An account with this phone number already exists. Try logging in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userRole = role === 'vendor' ? 'vendor' : 'couple';

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (email, phone, password_hash, full_name, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, role, created_at`,
      [email.toLowerCase(), phone || null, passwordHash, full_name, userRole]
    );
    const user = rows[0];
    await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [user.id]);
    await client.query('COMMIT');

    // Welcome email to the new user + signup alert to you (runs in the background,
    // and a failed email never blocks the signup)
    notifyNewUser({ ...user, phone: phone || null });

    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });

    const valid = await bcrypt.compare(password || '', user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect email or password.' });

    delete user.password_hash;
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, full_name, phone, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
