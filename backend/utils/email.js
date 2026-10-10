const axios = require('axios');

// Sends email through Resend (resend.com) using plain HTTPS — no extra package needed.
// If RESEND_API_KEY isn't set, emails are only printed to the server log, so the
// site still works while you're setting things up.
//
// Env vars:
//   RESEND_API_KEY  — from your Resend dashboard
//   EMAIL_FROM      — e.g. "Wedding in Naija <hello@yourdomain.com>" (domain must be verified in Resend)
//   ADMIN_EMAIL     — where YOU receive new-signup / new-request alerts
//   FRONTEND_URL    — used for links inside the emails

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail({ to, subject, html }) {
  if (!to) return { skipped: true };
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email not configured — would send to ${to}] ${subject}`);
    return { simulated: true };
  }
  try {
    await axios.post(
      'https://api.resend.com/emails',
      { from: process.env.EMAIL_FROM || 'Wedding in Naija <onboarding@resend.dev>', to: [to], subject, html },
      { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 10000 }
    );
    return { sent: true };
  } catch (err) {
    // Email problems must never break signup, so log and move on.
    console.error('Email failed:', err.response?.data || err.message);
    return { failed: true };
  }
}

// ── Shared look: maroon / gold / cream, same as the site ────────
function layout(title, bodyHtml) {
  return `
  <div style="background:#fdf4ef;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#3a0f14;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #f0e6e0;">
      <div style="background:#3a0f14;color:#f0c878;padding:18px 24px;font-size:20px;font-weight:600;">Wedding in Naija</div>
      <div style="padding:24px;line-height:1.55;font-size:15px;">
        <h2 style="margin:0 0 12px;color:#4d141b;font-size:20px;">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:14px 24px;background:#fdf4ef;color:#8a6b6b;font-size:12px;">
        Big day or big idea, we've got you covered.
      </div>
    </div>
  </div>`;
}

function button(label, href) {
  return `<p style="margin:20px 0;"><a href="${escapeHtml(href)}" style="background:#d8a13c;color:#3a0f14;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">${escapeHtml(label)}</a></p>`;
}

const siteUrl = () => process.env.FRONTEND_URL || '#';

// ── Welcome email: couples ──────────────────────────────────────
function welcomeCouple(user) {
  const name = escapeHtml(user.full_name.split(' ')[0]);
  return {
    subject: 'Welcome to Wedding in Naija 🎉',
    html: layout(`Welcome, ${name}!`, `
      <p>Congratulations on planning your big day. Wedding in Naija connects you with vendors who can make it unforgettable.</p>
      <p><b>Here's the quickest way to get started:</b></p>
      <ol style="padding-left:18px;">
        <li>Post a request with what you need, your location, date and budget.</li>
        <li>Vendors in your area will see it and reach out to you directly.</li>
        <li>Compare a few vendors before you decide.</li>
      </ol>
      ${button('Post a Request', siteUrl())}
      <p><b>To help us match you faster, just reply to this email with:</b></p>
      <ul style="padding-left:18px;">
        <li>Your event type (traditional, white wedding, engagement...)</li>
        <li>Your event date, or the month you're aiming for</li>
        <li>Approximate guest count and budget range</li>
        <li>The services you need most (decor, photography, catering...)</li>
      </ul>
      <p style="background:#fdf4ef;border-radius:8px;padding:12px 14px;"><b>Stay safe:</b> check a vendor's profile and past work first, never rush into paying a large deposit, and meet or video-call before you commit. If anything feels off, use the Report button and we'll look into it.</p>
    `),
  };
}

// ── Welcome email: vendors ──────────────────────────────────────
function welcomeVendor(user) {
  const name = escapeHtml(user.full_name.split(' ')[0]);
  return {
    subject: 'Welcome to Wedding in Naija — set up your vendor profile',
    html: layout(`Welcome aboard, ${name}!`, `
      <p>You're now on Wedding in Naija, where couples and event planners come looking for vendors like you.</p>
      <p><b>To start getting enquiries:</b></p>
      <ol style="padding-left:18px;">
        <li>Complete your vendor profile: business name, services, city, and WhatsApp number.</li>
        <li>Add clear photos of your best work.</li>
        <li>Browse the request board and respond to couples looking for what you offer.</li>
      </ol>
      ${button('Complete my profile', siteUrl())}
      <p><b>To help us feature the right vendors, just reply with:</b></p>
      <ul style="padding-left:18px;">
        <li>Which services you offer and how long you've been doing it</li>
        <li>The areas or states you can serve</li>
        <li>Your typical price range</li>
        <li>Your CAC registration number or a link to your Instagram/portfolio (this helps earn a Verified badge)</li>
      </ul>
      <p style="background:#fdf4ef;border-radius:8px;padding:12px 14px;"><b>Reputation matters here:</b> couples trust vendors who reply fast, show real work, and deliver on what they promise. Vendors reported for scams are removed.</p>
    `),
  };
}

// ── Alerts to the site owner ────────────────────────────────────
function adminNewSignup(user) {
  return {
    subject: `New ${user.role} signup: ${user.full_name}`,
    html: layout('New signup', `
      <table style="font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Name</td><td>${escapeHtml(user.full_name)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Role</td><td>${escapeHtml(user.role)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Email</td><td>${escapeHtml(user.email)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Phone</td><td>${escapeHtml(user.phone || '—')}</td></tr>
      </table>`),
  };
}

function adminNewRequest(r) {
  return {
    subject: `New request posted: ${r.event_type} in ${r.location_text}`,
    html: layout('New wedding request', `
      <table style="font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">From</td><td>${escapeHtml(r.contact_name)} (${escapeHtml(r.contact_phone)})</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Event</td><td>${escapeHtml(r.event_type)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Location</td><td>${escapeHtml(r.location_text)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Services</td><td>${escapeHtml((r.services_needed || []).join(', ') || '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#8a6b6b;">Budget</td><td>${r.total_budget ? '₦' + Number(r.total_budget).toLocaleString() : '—'}</td></tr>
      </table>`),
  };
}

// Convenience wrappers — fire and forget, never throw.
function notifyNewUser(user) {
  const welcome = user.role === 'vendor' ? welcomeVendor(user) : welcomeCouple(user);
  sendEmail({ to: user.email, ...welcome });
  if (process.env.ADMIN_EMAIL) sendEmail({ to: process.env.ADMIN_EMAIL, ...adminNewSignup(user) });
}

function notifyNewRequest(request) {
  if (process.env.ADMIN_EMAIL) sendEmail({ to: process.env.ADMIN_EMAIL, ...adminNewRequest(request) });
}

module.exports = { sendEmail, notifyNewUser, notifyNewRequest, escapeHtml };
