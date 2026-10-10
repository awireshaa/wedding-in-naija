const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/packages — list timed access plans (30/90/180/365-day)
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM packages ORDER BY duration_days');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
