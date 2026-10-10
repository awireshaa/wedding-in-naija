# Wedding in Naija

A wedding vendor marketplace: couples post what they need, verified vendors
list profiles and pay to unlock contact details on matching requests.
Modeled on the marriageinnigeria.ng portal, rebuilt from scratch with your
own branding.

## What's included

- **`/backend`** — Node.js + Express API, PostgreSQL database, JWT accounts,
  Paystack payments (wallet top-up, request-unlock payments, webhook)
- **`/frontend`** — a single-file site (directory, request board, post-a-request
  form, wallet, login) styled in the maroon-and-gold palette from the
  reference site. Talks to the backend over the `/api` routes above.

## Current mode: FREE LAUNCH

Paid features are **paused** so you can launch fast and build up vendors and couples first:

- Any signed-in vendor sees a couple's contact details on the request board immediately (no wallet, no OTP).
- You only need **two** outside services to go live: a PostgreSQL database and (optionally) an email provider.
  Paystack and an SMS provider are **not needed** right now.
- The payment code is still in the project (`routes/payments.js`, `routes/packages.js`, `utils/paystack.js`,
  `utils/otp.js`, `utils/sms.js`) — it's just switched off in `server.js`.

**To switch payments back on later:** in `backend/server.js` uncomment the two `require` lines and the two
`app.use` lines for payments/packages, add your Paystack keys to `.env`, and restore the unlock wall in
`routes/requests.js` (the old version checked `request_unlocks` before returning contact details) and the
wallet/Top Up box in `frontend/index.html`. Ask Claude to do this and it will take one session.

### Automatic emails (Resend)

When anyone signs up, they get a welcome email (different for couples and vendors, with questions that help you
qualify them) and **you** get an alert. You also get an alert for every new request posted.

1. Create a free account at [resend.com](https://resend.com) and add your domain (they show the DNS records to add).
2. Put these in `backend/.env`:
   - `RESEND_API_KEY` — from the Resend dashboard
   - `EMAIL_FROM` — e.g. `Wedding in Naija <hello@yourdomain.com>` (must be on your verified domain)
   - `ADMIN_EMAIL` — your own inbox, for the alerts
3. Until `RESEND_API_KEY` is set, emails are just printed in the server log and nothing breaks.

Replies to the welcome emails go to whatever inbox your `EMAIL_FROM` address points at, so make sure that
address is one you actually read (or add a `reply_to` later).

## Publishing on GitHub and deploying from it

1. Create a free account at github.com, click **New repository**, name it `wedding-in-naija`, and keep it **Private** (your code, your business).
2. Click **uploading an existing file**, then drag in everything inside the project folder (`backend`, `frontend`, `README.md`, `.gitignore`) and click **Commit changes**.
   The `.gitignore` file is hidden on some computers, so check it uploaded; it keeps secrets and `node_modules` out of GitHub.
3. **Never upload a real `.env` file.** Only `.env.example` (which has no real keys) belongs on GitHub. Real keys go into your host's "Environment Variables" screen.
4. Connect the repo to your hosts:
   - **Backend** (Railway or Render): choose the GitHub repo and set the **Root Directory** to `backend`. Start command: `npm start`.
   - **Frontend** (Netlify or Vercel): choose the same repo and set the publish/output directory to `frontend` (no build command needed).
5. After that, every change pushed to GitHub redeploys the live site automatically.

## Getting this running for real

You'll need three things Anthropic's chat environment can't provide directly:
a place to run the backend, a PostgreSQL database, and a live Paystack
account. Recommended, cheapest path for a first launch:

1. **Database**: create a free/low-cost Postgres instance on
   [Supabase](https://supabase.com) or [Neon](https://neon.tech). Copy the
   connection string into `backend/.env` as `DATABASE_URL`.
2. **Run the schema**: `psql "$DATABASE_URL" -f backend/db/schema.sql`
   (or paste `schema.sql` into Supabase's SQL editor).
3. **Backend hosting**: deploy `/backend` to [Railway](https://railway.app)
   or [Render](https://render.com) — both have a free/cheap tier, connect to
   GitHub, and auto-deploy on push. Set the environment variables from
   `.env.example` in their dashboard.
4. **Paystack**: create an account at [paystack.com](https://paystack.com),
   grab your **test** secret/public keys first, and set
   `https://<your-backend-url>/api/payments/webhook` as the webhook URL in
   the Paystack dashboard. Switch to live keys once you're ready to accept
   real money — Paystack requires business verification (CAC document,
   bank details) for that.
5. **Frontend hosting**: `/frontend/index.html` can be deployed as-is to
   [Netlify](https://netlify.com), [Vercel](https://vercel.com), or even
   GitHub Pages. Update the `API_BASE_URL` constant near the top of the
   `<script>` tag to point at your live backend URL.
6. **Domain**: point `weddinginnaija.com` (or whatever you register) at the
   frontend host; most of the above have one-click custom domain support.

### Local development

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, Paystack test keys
npm install
npm run migrate           # creates all tables
npm run dev                # starts the API on http://localhost:4000
```

Then open `frontend/index.html` directly in a browser, or serve it with
any static file server — it calls the API at `http://localhost:4000/api`
by default (edit `API_BASE_URL` in the script tag to change this).

## How the money side works (matches what you saw on the reference site)

- **Vendors top up a wallet** via Paystack (`POST /api/payments/topup`).
- **Unlocking a request's contact info** costs a fixed amount per request,
  deducted from the wallet (`POST /api/payments/unlock-request`).
- **Timed packages** (30/90/180/365-day) are seeded in the `packages` table —
  wire these to a "subscribe" endpoint the same way as top-up when you're
  ready to sell them (the schema and pricing rows are already there).
- Listings are **Bronze / Silver / Gold** tier, stored on `vendor_profiles.tier`.

## What still needs a human decision before this is "live"

- Business registration (CAC) — Paystack requires this to release live
  payouts to your bank account.
- Content moderation policy for requests (the reference site has a
  "Report this Request" flow — worth copying).
- Terms of Service / Privacy Policy pages (required by Paystack and by
  Nigerian data-protection rules, NDPR).
- A phone/OTP verification provider (Termii or Africa's Talking are the
  common Nigerian choices) if you want the OTP-gated payments the
  reference site uses.

## Making yourself an admin

Sign up on the site normally first (any role), then run this against your database
to turn that account into an admin — you'll need this to use `admin.html`, the
private dashboard for the site owner (users, transactions, payouts, flagged requests):

```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```

`admin.html` isn't linked from the public site — go to it directly
(e.g. `yourdomain.com/admin.html`) and log in with that account.
