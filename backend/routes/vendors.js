const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const TIER_ORDER = `CASE tier WHEN 'gold' THEN 1 WHEN 'silver' THEN 2 ELSE 3 END`;

// GET /api/vendors?name=&service=&state=&city=&page=1
router.get('/', async (req, res, next) => {
  const { name, service, state, city, page = 1 } = req.query;
  const limit = 20;
  const offset = (Math.max(1, Number(page)) - 1) * limit;

  const clauses = [];
  const values = [];

  if (name) {
    values.push(`%${name}%`);
    clauses.push(`business_name ILIKE $${values.length}`);
  }
  if (service) {
    values.push(service);
    clauses.push(`$${values.length} = ANY(categories)`);
  }
  if (state) {
    values.push(state);
    clauses.push(`state ILIKE $${values.length}`);
  }
  if (city) {
    values.push(`%${city}%`);
    clauses.push(`city ILIKE $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(limit, offset);

  try {
    const { rows } = await pool.query(
      `SELECT id, business_name, tagline, categories, tags, state, city, address,
              contact_verified, tier, rating, logo_url
       FROM vendor_profiles
       ${where}
       ORDER BY ${TIER_ORDER}, rating DESC, created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json({ vendors: rows, page: Number(page) });
  } catch (err) {
    next(err);
  }
});

// GET /api/vendors/locations/list — every state + city combo that has active vendors,
// for a browsable "Locations" page like the reference site's.
// NOTE: must be declared before GET /:id, or Express matches "locations" as an id.
router.get('/locations/list', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT state, city, COUNT(*) AS vendor_count
       FROM vendor_profiles GROUP BY state, city ORDER BY state, city`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/vendors/me/dashboard — the logged-in vendor's own profile + subscription status
// NOTE: must also come before GET /:id for the same reason.
router.get('/me/dashboard', requireAuth, requireRole('vendor'), async (req, res, next) => {
  try {
    const profile = await pool.query('SELECT * FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
    if (!profile.rows.length) return res.json({ profile: null });

    const vendorId = profile.rows[0].id;
    const sub = await pool.query(
      `SELECT s.*, p.name, p.perk FROM vendor_subscriptions s
       JOIN packages p ON p.id = s.package_id
       WHERE s.vendor_id = $1 AND s.active = true AND s.ends_at > now()
       ORDER BY s.ends_at DESC LIMIT 1`,
      [vendorId]
    );
    const unlockedCount = await pool.query(
      'SELECT COUNT(*) FROM request_unlocks WHERE vendor_id = $1',
      [vendorId]
    );

    res.json({
      profile: profile.rows[0],
      activePackage: sub.rows[0] || null,
      requestsUnlocked: Number(unlockedCount.rows[0].count),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/vendors/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendor_profiles WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Vendor not found.' });
    const media = await pool.query(
      'SELECT url, media_type FROM vendor_media WHERE vendor_id = $1 ORDER BY sort_order',
      [req.params.id]
    );
    res.json({ ...rows[0], media: media.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/vendors  (create your vendor profile — requires a vendor account)
router.post('/', requireAuth, requireRole('vendor'), async (req, res, next) => {
  const {
    business_name, tagline, description, categories = [], tags = [],
    state, city, address, whatsapp,
  } = req.body;

  if (!business_name || !state || !city) {
    return res.status(400).json({ error: 'Business name, state, and city are required.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
    if (existing.rows.length) return res.status(409).json({ error: 'You already have a vendor profile. Edit it instead.' });

    const { rows } = await pool.query(
      `INSERT INTO vendor_profiles
        (user_id, business_name, tagline, description, categories, tags, state, city, address, whatsapp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, business_name, tagline, description, categories, tags, state, city, address, whatsapp]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /api/vendors/:id  (owner-only edit)
router.put('/:id', requireAuth, requireRole('vendor'), async (req, res, next) => {
  const owns = await pool.query('SELECT user_id FROM vendor_profiles WHERE id = $1', [req.params.id]);
  if (!owns.rows.length) return res.status(404).json({ error: 'Vendor not found.' });
  if (owns.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Not your profile.' });

  const fields = ['business_name', 'tagline', 'description', 'categories', 'tags', 'state', 'city', 'address', 'whatsapp'];
  const sets = [];
  const values = [];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) {
      values.push(req.body[f]);
      sets.push(`${f} = $${values.length}`);
    }
  });
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE vendor_profiles SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
