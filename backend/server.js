require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const vendorRoutes = require('./routes/vendors');
const requestRoutes = require('./routes/requests');
// Paid features are paused for the free launch. To turn them back on, uncomment the
// two payment/package lines below and the two app.use lines further down.
// const paymentRoutes = require('./routes/payments');
// const packageRoutes = require('./routes/packages');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Paystack webhook needs the raw body for signature verification, so it's
// mounted BEFORE the json body-parser, using its own raw parser.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'wedding-in-naija-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/requests', requestRoutes);
// app.use('/api/payments', paymentRoutes);
// app.use('/api/packages', packageRoutes);
app.use('/api/admin', adminRoutes);

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Wedding in Naija API running on port ${PORT}`));
