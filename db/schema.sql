-- Bounty — SQLite schema
-- Identity is the user's Nostr pubkey (hex). No passwords.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Users: keyed by Nostr pubkey. Created on first interaction.
CREATE TABLE IF NOT EXISTS users (
  pubkey        TEXT PRIMARY KEY,            -- hex Nostr pubkey
  display_name  TEXT,                        -- from window.fedi / nostr profile, optional
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  -- denormalized trust metrics (recomputed on settlement events)
  pledges_made_count       INTEGER NOT NULL DEFAULT 0,
  pledges_fulfilled_count  INTEGER NOT NULL DEFAULT 0,
  sats_pledged_total       INTEGER NOT NULL DEFAULT 0,
  sats_paid_total          INTEGER NOT NULL DEFAULT 0,
  claims_made_count        INTEGER NOT NULL DEFAULT 0,
  claims_completed_count   INTEGER NOT NULL DEFAULT 0,
  flags_received           INTEGER NOT NULL DEFAULT 0
);

-- Bounties: a community task someone wants done.
CREATE TABLE IF NOT EXISTS bounties (
  id            TEXT PRIMARY KEY,            -- uuid
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  category      TEXT,                        -- cleanup | painting | repair | other
  creator_pubkey TEXT NOT NULL,
  threshold_sats INTEGER NOT NULL DEFAULT 0, -- DEPRECATED
  expires_at    INTEGER,                     -- unix ts; auto-expires bounty if unclaimed
  community_id  TEXT NOT NULL DEFAULT 'default',
  status        TEXT NOT NULL DEFAULT 'open',-- open | claimed | proof_submitted | settled | cancelled | expired
  worker_pubkey TEXT,                        -- set when claimed
  worker_invoice TEXT,                       -- Worker's LN address (user@domain)
  proof_image   TEXT,
  proof_note    TEXT,
  proof_at      INTEGER,
  claimed_at    INTEGER,
  settled_at    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  -- v3 migration: claim_deadline (work due), payment_deadline (sats due)
  claim_deadline INTEGER,
  payment_deadline INTEGER,
  FOREIGN KEY (creator_pubkey) REFERENCES users(pubkey)
);
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_community ON bounties(community_id, status);
CREATE INDEX IF NOT EXISTS idx_bounties_created ON bounties(created_at);

-- Pledges: a commitment of sats toward a bounty.
CREATE TABLE IF NOT EXISTS pledges (
  id            TEXT PRIMARY KEY,
  bounty_id     TEXT NOT NULL,
  pledger_pubkey TEXT NOT NULL,
  amount_sats   INTEGER NOT NULL,
  sig_event_id  TEXT,
  sig           TEXT,
  sig_event_json TEXT,
  sig_verified  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pledged', -- pledged | payment_claimed | paid | reneged | refunded | expired
  paid_at       INTEGER,
  payment_preimage TEXT,
  verified_by   TEXT,
  verified_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  -- v3 migration: auto-generated BOLT11 invoice for this pledger
  invoice_request TEXT,
  FOREIGN KEY (bounty_id) REFERENCES bounties(id),
  FOREIGN KEY (pledger_pubkey) REFERENCES users(pubkey),
  UNIQUE (bounty_id, pledger_pubkey)
);
CREATE INDEX IF NOT EXISTS idx_pledges_bounty ON pledges(bounty_id);
CREATE INDEX IF NOT EXISTS idx_pledges_pledger ON pledges(pledger_pubkey);

-- Communities: self-service community creation.
CREATE TABLE IF NOT EXISTS communities (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  region        TEXT,
  admin_pubkey  TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_communities_id ON communities(id);

INSERT OR IGNORE INTO communities (id, name, description, admin_pubkey)
  VALUES ('default', 'Sandbox', 'Default community for testing', '0000000000000000000000000000000000000000000000000000000000000000');

-- Admins: multiple per community (creator is first admin)
-- Members: every pubkey that has interacted with a community (auto-registered)
CREATE TABLE IF NOT EXISTS community_members (
  community_id  TEXT NOT NULL,
  pubkey        TEXT NOT NULL,
  display_name  TEXT,
  joined_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (community_id, pubkey),
  FOREIGN KEY (community_id) REFERENCES communities(id)
);
CREATE INDEX IF NOT EXISTS idx_community_members_community ON community_members(community_id);

CREATE TABLE IF NOT EXISTS community_admins (
  community_id  TEXT NOT NULL,
  admin_pubkey  TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (community_id, admin_pubkey),
  FOREIGN KEY (community_id) REFERENCES communities(id)
);
CREATE INDEX IF NOT EXISTS idx_community_admins_community ON community_admins(community_id);

INSERT OR IGNORE INTO community_admins (community_id, admin_pubkey)
SELECT id, admin_pubkey FROM communities WHERE admin_pubkey != '0000000000000000000000000000000000000000000000000000000000000000';

-- Applications: workers apply, admins approve before work begins
CREATE TABLE IF NOT EXISTS applications (
  id             TEXT PRIMARY KEY,
  bounty_id      TEXT NOT NULL,
  applicant_pubkey TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (bounty_id) REFERENCES bounties(id),
  UNIQUE (bounty_id, applicant_pubkey)
);
CREATE INDEX IF NOT EXISTS idx_applications_bounty ON applications(bounty_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- Zaps: Lightning tips sent to bounty creators/workers
CREATE TABLE IF NOT EXISTS zaps (
  id            TEXT PRIMARY KEY,
  bounty_id     TEXT NOT NULL,
  sender_pubkey TEXT NOT NULL,
  recipient_pubkey TEXT NOT NULL,
  amount_sats   INTEGER NOT NULL,
  memo          TEXT,
  preimage      TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (bounty_id) REFERENCES bounties(id)
);
CREATE INDEX IF NOT EXISTS idx_zaps_bounty ON zaps(bounty_id);
CREATE INDEX IF NOT EXISTS idx_zaps_recipient ON zaps(recipient_pubkey);

-- Media: shared music/podcast tracks (NIP-71 style badges)
CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  artist        TEXT,
  url           TEXT NOT NULL,
  cover_url     TEXT,
  duration      INTEGER,
  pubkey        TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_media_pubkey ON media(pubkey);

-- Nostr notes: cross-posted notes from the app
CREATE TABLE IF NOT EXISTS nostr_notes (
  id            TEXT PRIMARY KEY,
  pubkey        TEXT NOT NULL,
  content       TEXT NOT NULL,
  kind          INTEGER NOT NULL DEFAULT 1,
  tags          TEXT,
  sig           TEXT,
  event_id      TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_nostr_notes_pubkey ON nostr_notes(pubkey);
CREATE INDEX IF NOT EXISTS idx_nostr_notes_event ON nostr_notes(event_id);
CREATE TABLE IF NOT EXISTS flags (
  id            TEXT PRIMARY KEY,
  bounty_id     TEXT NOT NULL,
  flagger_pubkey TEXT NOT NULL,
  target_pubkey TEXT NOT NULL,
  reason        TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (bounty_id) REFERENCES bounties(id)
);
CREATE INDEX IF NOT EXISTS idx_flags_target ON flags(target_pubkey);
