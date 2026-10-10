const express = require('express');
const pool = require('../db/pool');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { notifyNewRequest } = require('../utils/email');

const router = express.Router();

// POST /api/requests — a couple posts a request (login optional, but recommended)
router.post('/', optionalAuth, async (req, res, next) => {
  const {
    contact_name, contact_phone, contact_whatsapp,
    services_needed = [], event_type, location_text, state,
    event_date, date_flexible, guest_count, venue_text,
    need_venue_suggestions, total_budget,
  } = req.body;

  if (!contact_name || !contact_phone || !event_type || !location_text) {
    return res.status(400).json({ error: 'Name, phone, event type, and location are required.' });
  }

  const coupleUserId = req.user ? req.user.id : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO requests
        (couple_user_id, contact_name, contact_phone, contact_whatsapp, services_needed,
         event_type, location_text, state, event_date, date_flexible, guest_count,
         venue_text, need_venue_suggestions, total_budget)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, created_at`,
      [coupleUserId, contact_name, contact_phone, contact_whatsapp, services_needed,
        event_type, location_text, state || null, event_date || null, !!date_flexible,
        guest_count || null, venue_text || null, !!need_venue_suggestions, total_budget || null]
    );

    // Alert the site owner (does nothing if ADMIN_EMAIL isn't set; never blocks the response)
    notifyNewRequest({ contact_name, contact_phone, event_type, location_text, services_needed, total_budget });

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/requests — vendor-facing board.
// FREE MODE: any signed-in vendor sees full contact details right away.
// (The paid unlock flow is paused — see routes/payments.js and the README to turn it back on.)
router.get('/', requireAuth, requireRole('vendor'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, contact_name, contact_phone, contact_whatsapp,
              services_needed, event_type, location_text, state, event_date,
              date_flexible, guest_count, venue_text, need_venue_suggestions,
              total_budget, status, created_at
       FROM requests
       WHERE status = 'open'
       ORDER BY created_at DESC
       LIMIT 50`
    );

    res.json(rows.map((r) => ({
      ...r,
      unlocked: true,
      contact: { id: r.id, contact_name: r.contact_name, contact_phone: r.contact_phone, contact_whatsapp: r.contact_whatsapp },
    })));
  } catch (err) {
    next(err);
  }
});

// POST /api/requests/:id/report — flags a request for admin review
router.post('/:id/report', requireAuth, async (req, res, next) => {
  const { reason } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE requests SET status = 'flagged' WHERE id = $1 RETURNING id, status`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    // In production, also insert `reason` into a `request_reports` table for admin review.
    res.json({ reported: true, reason: reason || null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
