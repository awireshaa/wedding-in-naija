-- Wedding in Naija — database schema (PostgreSQL)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users & auth ───────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  phone           TEXT,
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('couple', 'vendor', 'admin')) DEFAULT 'couple',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Vendor profiles ────────────────────────────────────────────
CREATE TABLE vendor_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name       TEXT NOT NULL,
  tagline             TEXT,
  description         TEXT,
  categories          TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {Photographer, Decor}
  tags                TEXT[] NOT NULL DEFAULT '{}',   -- e.g. {Lagos wedding photography}
  state               TEXT NOT NULL,
  city                TEXT NOT NULL,
  address             TEXT,
  whatsapp            TEXT,
  contact_verified    BOOLEAN NOT NULL DEFAULT false,
  tier                TEXT NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold')) DEFAULT 'bronze',
  rating              NUMERIC(2,1) DEFAULT 0,
  logo_url            TEXT,
  cover_url           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_state_city ON vendor_profiles (state, city);
CREATE INDEX idx_vendor_categories ON vendor_profiles USING GIN (categories);
CREATE INDEX idx_vendor_tags ON vendor_profiles USING GIN (tags);

CREATE TABLE vendor_media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  media_type  TEXT NOT NULL CHECK (media_type IN ('image', 'video')) DEFAULT 'image',
  sort_order  INT DEFAULT 0
);

-- ─── Wedding requests (posted by couples) ──────────────────────
CREATE TABLE requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  contact_name            TEXT NOT NULL,
  contact_phone           TEXT NOT NULL,
  contact_whatsapp        TEXT,
  services_needed         TEXT[] NOT NULL DEFAULT '{}',
  event_type              TEXT NOT NULL,          -- Traditional, White Wedding, Engagement...
  location_text           TEXT NOT NULL,
  state                   TEXT,
  event_date              DATE,
  date_flexible           BOOLEAN DEFAULT false,
  guest_count             INT,
  venue_text              TEXT,
  need_venue_suggestions  BOOLEAN DEFAULT false,
  total_budget            NUMERIC(12,2),
  status                  TEXT NOT NULL CHECK (status IN ('open','closed','flagged')) DEFAULT 'open',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_requests_state ON requests (state);
CREATE INDEX idx_requests_services ON requests USING GIN (services_needed);

-- ─── Wallets & payments ─────────────────────────────────────────
CREATE TABLE wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id   UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL,             -- positive = credit, negative = debit
  type        TEXT NOT NULL CHECK (type IN ('topup', 'unlock_request', 'package_purchase', 'refund')),
  reference   TEXT UNIQUE NOT NULL,               -- Paystack reference or internal ref
  status      TEXT NOT NULL CHECK (status IN ('pending','success','failed')) DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which vendor has unlocked which request's contact details
CREATE TABLE request_unlocks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  vendor_id    UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  unlocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, vendor_id)
);

-- Timed listing / lead-access packages (30/90/180/365-day style)
CREATE TABLE packages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  duration_days  INT NOT NULL,
  price          NUMERIC(12,2) NOT NULL,
  perk           TEXT   -- e.g. 'Unlimited request unlocks', 'Gold tier listing'
);

CREATE TABLE vendor_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  package_id   UUID NOT NULL REFERENCES packages(id),
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO packages (name, duration_days, price, perk) VALUES
  ('30-Day Access',  30,  15000, 'Unlimited request unlocks for 30 days'),
  ('90-Day Access',  90,  35000, 'Unlimited request unlocks + Silver tier badge'),
  ('180-Day Access', 180, 60000, 'Unlimited request unlocks + Gold tier badge'),
  ('365-Day Access', 365, 100000,'Unlimited request unlocks + Gold tier badge + featured placement');

-- ─── Admin payouts ──────────────────────────────────────────────
-- Tracks you (the site owner) moving collected wallet top-up money
-- out to your real bank account. Nothing here moves money automatically —
-- it's a ledger you update once you've done the transfer yourself in your
-- bank or Paystack dashboard.
CREATE TABLE admin_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount        NUMERIC(12,2) NOT NULL,
  bank_ref      TEXT,                 -- your own note/reference for the bank transfer
  requested_by  UUID REFERENCES users(id),
  status        TEXT NOT NULL CHECK (status IN ('pending','completed')) DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
