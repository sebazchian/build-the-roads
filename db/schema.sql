-- my two sats — SQLite schema
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
  threshold_sats INTEGER NOT NULL DEFAULT 0, -- DEPRECATED: kept for backward compat, always 0
  expires_at    INTEGER,                     -- optional unix ts; pledges expire if unclaimed
  community_id TEXT NOT NULL DEFAULT 'default',
  status        TEXT NOT NULL DEFAULT 'open',-- open | claimed | proof_submitted | settled | cancelled | expired
  worker_pubkey TEXT,                        -- set when claimed
  worker_invoice TEXT,                       -- BOLT11 the worker provides at proof time (optional shared invoice)
  proof_image   TEXT,                        -- relative path to uploaded proof
  proof_note    TEXT,
  proof_at      INTEGER,
  claimed_at    INTEGER,
  settled_at    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (creator_pubkey) REFERENCES users(pubkey)
);
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_community ON bounties(community_id, status);
CREATE INDEX IF NOT EXISTS idx_bounties_created ON bounties(created_at);

-- Pledges: a commitment of sats toward a bounty. Provable via signed Nostr event.
CREATE TABLE IF NOT EXISTS pledges (
  id            TEXT PRIMARY KEY,            -- uuid
  bounty_id     TEXT NOT NULL,
  pledger_pubkey TEXT NOT NULL,
  amount_sats   INTEGER NOT NULL,
  -- proof of intent: signed nostr event (NIP-07 signEvent output)
  sig_event_id  TEXT,                        -- signed event id
  sig           TEXT,                        -- schnorr signature
  sig_event_json TEXT,                       -- full JSON event for server-side verifyEvent
  sig_verified  INTEGER NOT NULL DEFAULT 0,  -- 1 = server verified event id+sig
  status        TEXT NOT NULL DEFAULT 'pledged', -- pledged | paid | reneged | refunded | expired
  paid_at       INTEGER,
  payment_preimage TEXT,                     -- WebLN sendPayment proof
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (bounty_id) REFERENCES bounties(id),
  FOREIGN KEY (pledger_pubkey) REFERENCES users(pubkey),
  UNIQUE (bounty_id, pledger_pubkey)         -- one pledge per person per bounty (can be updated)
);
CREATE INDEX IF NOT EXISTS idx_pledges_bounty ON pledges(bounty_id);
CREATE INDEX IF NOT EXISTS idx_pledges_pledger ON pledges(pledger_pubkey);

-- Communities: self-service community creation.
CREATE TABLE IF NOT EXISTS communities (
  id            TEXT PRIMARY KEY,            -- URL-safe slug (bitcoin-ekasi, mytown)
  name          TEXT NOT NULL,               -- human-readable name
  description   TEXT,
  region        TEXT,                        -- optional geographic hint
  admin_pubkey  TEXT NOT NULL,               -- creator / first admin
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_communities_id ON communities(id);

-- Seed default community so bounties table FK stays happy
INSERT OR IGNORE INTO communities (id, name, description, admin_pubkey)
  VALUES ('default', 'Sandbox', 'Default community for testing', '0000000000000000000000000000000000000000000000000000000000000000');

-- Flags: pledgers flagging bad/fake work, or community flagging a bad pledger.
CREATE TABLE IF NOT EXISTS flags (
  id            TEXT PRIMARY KEY,
  bounty_id     TEXT NOT NULL,
  flagger_pubkey TEXT NOT NULL,
  target_pubkey TEXT NOT NULL,               -- who is being flagged
  reason        TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (bounty_id) REFERENCES bounties(id)
);
CREATE INDEX IF NOT EXISTS idx_flags_target ON flags(target_pubkey);
