/**
 * my two sats — SQLite data layer
 * Lessons applied from Direct Current data-loss postmortem:
 *  - DB file is gitignored (never tracked)
 *  - Automatic backup at startup with rotation
 *  - Health validation logged on boot
 */
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', 'db');
const DB_PATH = join(DB_DIR, 'mytwosats.db');
const BACKUP_DIR = join(DB_DIR, 'backups');

let _db = null;

function backupDatabase() {
  if (!existsSync(DB_PATH)) return; // nothing to back up yet
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 13).replace(/[:T]/g, '-');
    const dest = join(BACKUP_DIR, `mytwosats-${stamp}.db`);
    copyFileSync(DB_PATH, dest);
    // retention: keep 7 days (168 hourly files max)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of readdirSync(BACKUP_DIR)) {
      const fp = join(BACKUP_DIR, f);
      if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
    }
  } catch (e) {
    console.warn('[db] backup skipped:', e.message);
  }
}

function validateHealth(db) {
  const u = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const b = db.prepare('SELECT COUNT(*) n FROM bounties').get().n;
  const p = db.prepare('SELECT COUNT(*) n FROM pledges').get().n;
  console.log(`[db] health: users=${u} bounties=${b} pledges=${p}`);
  if (b === 0 && p > 0) console.warn('[db] WARN: pledges exist but no bounties — possible data loss');
}

export function getDb() {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  backupDatabase();
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(readFileSync(join(DB_DIR, 'schema.sql'), 'utf8'));
  validateHealth(_db);
  return _db;
}

// ── Users ────────────────────────────────────────────────────────────────
export function ensureUser(pubkey, displayName = null) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE pubkey = ?').get(pubkey);
  if (existing) {
    if (displayName && !existing.display_name) {
      db.prepare('UPDATE users SET display_name = ? WHERE pubkey = ?').run(displayName, pubkey);
    }
    return db.prepare('SELECT * FROM users WHERE pubkey = ?').get(pubkey);
  }
  db.prepare('INSERT INTO users (pubkey, display_name) VALUES (?, ?)').run(pubkey, displayName);
  return db.prepare('SELECT * FROM users WHERE pubkey = ?').get(pubkey);
}

export function getUser(pubkey) {
  return getDb().prepare('SELECT * FROM users WHERE pubkey = ?').get(pubkey);
}

// Trust score computation (transparent, recomputable from source tables)
export function computeTrust(pubkey) {
  const db = getDb();
  // Pledger side
  const pl = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('paid','reneged') THEN 1 ELSE 0 END) as settled,
      SUM(CASE WHEN status='paid' THEN amount_sats ELSE 0 END) as paid_sats,
      SUM(CASE WHEN status IN ('paid','reneged') THEN amount_sats ELSE 0 END) as settled_sats
    FROM pledges WHERE pledger_pubkey = ?
  `).get(pubkey);
  const settledSats = pl.settled_sats || 0;
  const fulfillment = settledSats > 0 ? (pl.paid_sats || 0) / settledSats : null;
  let pledgerBadge = 'New';
  if ((pl.settled || 0) >= 3 && fulfillment !== null) {
    if (fulfillment >= 0.9) pledgerBadge = 'Reliable';
    else if (fulfillment >= 0.6) pledgerBadge = 'Mixed';
    else pledgerBadge = 'Flaky';
  }
  // Worker side
  const wk = db.prepare(`
    SELECT
      COUNT(*) as claimed,
      SUM(CASE WHEN status='settled' THEN 1 ELSE 0 END) as completed
    FROM bounties WHERE worker_pubkey = ?
  `).get(pubkey);
  const flags = db.prepare('SELECT COUNT(*) n FROM flags WHERE target_pubkey = ?').get(pubkey).n;
  const completion = (wk.claimed || 0) > 0 ? (wk.completed || 0) / wk.claimed : null;
  let workerBadge = 'New';
  if ((wk.claimed || 0) >= 2 && completion !== null) {
    if (completion >= 0.9 && flags === 0) workerBadge = 'Trusted';
    else if (completion >= 0.6) workerBadge = 'Mixed';
    else workerBadge = 'Unreliable';
  }
  return {
    pubkey,
    pledger: {
      fulfillment_rate: fulfillment === null ? null : Math.round(fulfillment * 100),
      settled_pledges: pl.settled || 0,
      badge: pledgerBadge,
    },
    worker: {
      completion_rate: completion === null ? null : Math.round(completion * 100),
      claims: wk.claimed || 0,
      completed: wk.completed || 0,
      flags,
      badge: workerBadge,
    },
  };
}

// ── Bounties ─────────────────────────────────────────────────────────────
export function createBounty({ title, description, category, creator_pubkey, threshold_sats, expires_at }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO bounties (id, title, description, category, creator_pubkey, threshold_sats, expires_at)
    VALUES (@id, @title, @description, @category, @creator_pubkey, @threshold_sats, @expires_at)
  `).run({ id, title, description, category: category || 'other', creator_pubkey,
    threshold_sats: threshold_sats || 0, expires_at: expires_at || null });
  return getBounty(id);
}

export function getBounty(id) {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (!b) return null;
  b.pledges = db.prepare('SELECT * FROM pledges WHERE bounty_id = ? ORDER BY created_at').all(id);
  b.pot_sats = b.pledges.filter(p => p.status !== 'reneged' && p.status !== 'expired')
    .reduce((s, p) => s + p.amount_sats, 0);
  // trust-weighted effective pot
  b.effective_pot_sats = b.pledges
    .filter(p => p.status !== 'reneged' && p.status !== 'expired')
    .reduce((s, p) => {
      const t = computeTrust(p.pledger_pubkey).pledger.fulfillment_rate;
      const w = t === null ? 1 : t / 100; // new users assumed good-faith (weight 1)
      return s + p.amount_sats * w;
    }, 0);
  b.effective_pot_sats = Math.round(b.effective_pot_sats);
  return b;
}

export function listBounties({ status } = {}) {
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM bounties WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM bounties ORDER BY created_at DESC').all();
  return rows.map(b => getBounty(b.id));
}

export function claimBounty(id, worker_pubkey) {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (!b) throw new Error('Bounty not found');
  if (b.status !== 'open') throw new Error('Bounty is not open for claiming');
  // enforce threshold
  const bb = getBounty(id);
  if (b.threshold_sats > 0 && bb.pot_sats < b.threshold_sats) {
    throw new Error('Pledge threshold not yet reached');
  }
  db.prepare("UPDATE bounties SET status='claimed', worker_pubkey=?, claimed_at=unixepoch() WHERE id=?")
    .run(worker_pubkey, id);
  return getBounty(id);
}

export function submitProof(id, { proof_image, proof_note, worker_invoice }) {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (!b) throw new Error('Bounty not found');
  if (b.status !== 'claimed') throw new Error('Bounty is not in claimed state');
  db.prepare(`UPDATE bounties SET status='proof_submitted', proof_image=?, proof_note=?, worker_invoice=?, proof_at=unixepoch() WHERE id=?`)
    .run(proof_image || null, proof_note || null, worker_invoice || null, id);
  return getBounty(id);
}

export function settleBounty(id) {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (!b) throw new Error('Bounty not found');
  // mark any still-pledged (unpaid) as reneged at settlement
  db.prepare("UPDATE pledges SET status='reneged' WHERE bounty_id=? AND status='pledged'").run(id);
  db.prepare("UPDATE bounties SET status='settled', settled_at=unixepoch() WHERE id=?").run(id);
  return getBounty(id);
}

// ── Pledges ──────────────────────────────────────────────────────────────
export function upsertPledge({ bounty_id, pledger_pubkey, amount_sats, sig_event_id, sig }) {
  const db = getDb();
  const id = uuidv4();
  const existing = db.prepare('SELECT * FROM pledges WHERE bounty_id=? AND pledger_pubkey=?')
    .get(bounty_id, pledger_pubkey);
  if (existing) {
    if (existing.status === 'paid') throw new Error('You have already paid this pledge');
    db.prepare('UPDATE pledges SET amount_sats=?, sig_event_id=?, sig=?, status=? WHERE id=?')
      .run(amount_sats, sig_event_id || null, sig || null, 'pledged', existing.id);
    return db.prepare('SELECT * FROM pledges WHERE id=?').get(existing.id);
  }
  db.prepare(`INSERT INTO pledges (id, bounty_id, pledger_pubkey, amount_sats, sig_event_id, sig)
    VALUES (@id, @bounty_id, @pledger_pubkey, @amount_sats, @sig_event_id, @sig)`)
    .run({ id, bounty_id, pledger_pubkey, amount_sats, sig_event_id: sig_event_id || null, sig: sig || null });
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(id);
}

export function payPledge(pledge_id, preimage) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
  if (!p) throw new Error('Pledge not found');
  db.prepare("UPDATE pledges SET status='paid', paid_at=unixepoch(), payment_preimage=? WHERE id=?")
    .run(preimage || null, pledge_id);
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
}

// ── Flags ────────────────────────────────────────────────────────────────
export function addFlag({ bounty_id, flagger_pubkey, target_pubkey, reason }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`INSERT INTO flags (id, bounty_id, flagger_pubkey, target_pubkey, reason)
    VALUES (?, ?, ?, ?, ?)`).run(id, bounty_id, flagger_pubkey, target_pubkey, reason || null);
  return db.prepare('SELECT * FROM flags WHERE id=?').get(id);
}

// ── Leaderboards ─────────────────────────────────────────────────────────
export function leaderboards() {
  const db = getDb();
  const topWorkers = db.prepare(`
    SELECT worker_pubkey as pubkey, COUNT(*) as jobs
    FROM bounties WHERE status='settled' AND worker_pubkey IS NOT NULL
    GROUP BY worker_pubkey ORDER BY jobs DESC LIMIT 10
  `).all();
  const topFunders = db.prepare(`
    SELECT pledger_pubkey as pubkey, SUM(amount_sats) as sats
    FROM pledges WHERE status='paid'
    GROUP BY pledger_pubkey ORDER BY sats DESC LIMIT 10
  `).all();
  return { topWorkers, topFunders };
}
