/**
 * build the roads - SQLite data layer
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

// Idempotent schema migrations for existing DBs
function runMigrations(db) {
  // v2: add verified_by / verified_at to pledges
  const pledgeCols = db.prepare("PRAGMA table_info(pledges)").all().map(c => c.name);
  if (!pledgeCols.includes('verified_by')) {
    db.exec("ALTER TABLE pledges ADD COLUMN verified_by TEXT");
    db.exec("ALTER TABLE pledges ADD COLUMN verified_at INTEGER");
    console.log('[db] migration: added verified_by/verified_at to pledges');
  }
  // v3: grace periods + invoice tracking
  if (!pledgeCols.includes('invoice_request')) {
    db.exec("ALTER TABLE pledges ADD COLUMN invoice_request TEXT");
    console.log('[db] migration: added invoice_request to pledges');
  }
  const bountyCols = db.prepare("PRAGMA table_info(bounties)").all().map(c => c.name);
  if (!bountyCols.includes('claim_deadline')) {
    db.exec("ALTER TABLE bounties ADD COLUMN claim_deadline INTEGER");
    db.exec("ALTER TABLE bounties ADD COLUMN payment_deadline INTEGER");
    console.log('[db] migration: added claim_deadline/payment_deadline to bounties');
  }
}

function validateHealth(db) {
  const u = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const b = db.prepare('SELECT COUNT(*) n FROM bounties').get().n;
  const p = db.prepare('SELECT COUNT(*) n FROM pledges').get().n;
  console.log(`[db] health: users=${u} bounties=${b} pledges=${p}`);
  if (b === 0 && p > 0) console.warn('[db] WARN: pledges exist but no bounties  -  possible data loss');
}

export function getDb() {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  backupDatabase();
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(readFileSync(join(DB_DIR, 'schema.sql'), 'utf8'));
  runMigrations(_db);
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
      SUM(CASE WHEN status='payment_claimed' THEN 1 ELSE 0 END) as pending_verification,
      SUM(CASE WHEN status='paid' THEN amount_sats ELSE 0 END) as paid_sats,
      SUM(CASE WHEN status='reneged' THEN amount_sats ELSE 0 END) as reneged_sats,
      SUM(CASE WHEN status IN ('paid','reneged') THEN amount_sats ELSE 0 END) as settled_sats
    FROM pledges WHERE pledger_pubkey = ?
  `).get(pubkey);
  const settledSats = pl.settled_sats || 0;
  // Include reneged in badge calculation  -  reneging hurts your score
  const fulfillment = settledSats > 0 ? (pl.paid_sats || 0) / settledSats : null;
  let pledgerBadge = 'New';
  if (pl.total > 0 && fulfillment !== null) {
    if (fulfillment >= 0.9) pledgerBadge = 'Reliable';
    else if (fulfillment >= 0.6) pledgerBadge = 'Mixed';
    else pledgerBadge = 'Flaky';
  }
  // Worker side
  const wk = db.prepare(`
    SELECT
      COUNT(*) as claimed,
      SUM(CASE WHEN status IN ('settled','proof_submitted') THEN 1 ELSE 0 END) as completed
    FROM bounties WHERE worker_pubkey = ?
  `).get(pubkey);
  const flags = db.prepare('SELECT COUNT(*) n FROM flags WHERE target_pubkey = ?').get(pubkey).n;
  const completion = (wk.claimed || 0) > 0 ? (wk.completed || 0) / wk.claimed : null;
  let workerBadge = 'New';
  if ((wk.claimed || 0) >= 1 && completion !== null) {
    if (completion >= 0.9 && flags === 0) workerBadge = 'Trusted';
    else if (completion >= 0.6) workerBadge = 'Mixed';
    else workerBadge = 'Unreliable';
  }
  return {
    pubkey,
    pledger: {
      fulfillment_rate: fulfillment === null ? null : Math.round(fulfillment * 100),
      settled_pledges: pl.settled || 0,
      pending_verification: pl.pending_verification || 0,
      paid_sats: pl.paid_sats || 0,
      reneged_sats: pl.reneged_sats || 0,
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

// ── Expiry automation ───────────────────────────────────────────────────
// Expires bounties whose deadlines have passed. Runs on every read; idempotent.
export function expireBounties() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // 1. Expire unclaimed bounties (original)
  const expiredOpen = db.prepare(
    "SELECT id FROM bounties WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at < ?"
  ).all(now);
  for (const row of expiredOpen) {
    db.prepare("UPDATE bounties SET status = 'expired' WHERE id = ?").run(row.id);
    db.prepare(`UPDATE pledges SET status = 'expired' WHERE bounty_id = ? AND status IN ('pledged','payment_claimed')`).run(row.id);
    console.log('[expiry] bounty', row.id, 'auto-expired (open, no claims)');
  }

  // 2. Expire claims: worker didn't submit proof by claim_deadline
  const expiredClaims = db.prepare(
    "SELECT id FROM bounties WHERE status = 'claimed' AND claim_deadline IS NOT NULL AND claim_deadline < ?"
  ).all(now);
  for (const row of expiredClaims) {
    db.prepare("UPDATE bounties SET status = 'open', worker_pubkey = NULL, claimed_at = NULL, claim_deadline = NULL WHERE id = ?").run(row.id);
    console.log('[expiry] bounty', row.id, 'claim forfeited (deadline passed)');
  }

  // 3. Auto-renege: pledgers didn't pay by payment_deadline
  const expiredPayments = db.prepare(
    "SELECT id FROM bounties WHERE status = 'proof_submitted' AND payment_deadline IS NOT NULL AND payment_deadline < ?"
  ).all(now);
  for (const row of expiredPayments) {
    db.prepare(`
      UPDATE pledges SET status = 'reneged', verified_by = 'system', verified_at = ?
      WHERE bounty_id = ? AND status = 'pledged'
    `).run(now, row.id);
    db.prepare("UPDATE bounties SET status = 'settled', settled_at = ? WHERE id = ?").run(now, row.id);
    console.log('[expiry] bounty', row.id, 'auto-settled: unpaid pledges reneged (payment deadline passed)');
  }

  return expiredOpen.length + expiredClaims.length + expiredPayments.length;
}

// ── Bounties ─────────────────────────────────────────────────────────────
export function createBounty({ title, description, category, creator_pubkey, threshold_sats, expires_at, community_id }) {
  const db = getDb();
  const id = uuidv4();
  const cid = community_id || 'default';
  db.prepare(`
    INSERT INTO bounties (id, title, description, category, creator_pubkey, threshold_sats, expires_at, community_id)
    VALUES (@id, @title, @description, @category, @creator_pubkey, @threshold_sats, @expires_at, @community_id)
  `).run({ id, title, description, category: category || 'other', creator_pubkey,
    threshold_sats: threshold_sats || 0, expires_at: expires_at || null, community_id: cid });
  return getBounty(id, cid);
}

function getBountyRaw(id, community_id, trustCache = null) {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bounties WHERE id = ? AND community_id = ?').get(id, community_id || 'default');
  if (!b) return null;
  b.pledges = db.prepare('SELECT * FROM pledges WHERE bounty_id = ? ORDER BY created_at').all(id);
  b.applications = db.prepare('SELECT * FROM applications WHERE bounty_id = ? ORDER BY created_at').all(id);
  b.pot_sats = b.pledges.filter(p => p.status !== 'reneged' && p.status !== 'expired')
    .reduce((s, p) => s + p.amount_sats, 0);
  b.effective_pot_sats = b.pledges
    .filter(p => p.status !== 'reneged' && p.status !== 'expired')
    .reduce((s, p) => {
      const tc = trustCache?.get(p.pledger_pubkey)?.pledger?.fulfillment_rate ?? null;
      const t = tc !== null ? tc : computeTrust(p.pledger_pubkey).pledger.fulfillment_rate;
      const w = t === null ? 1 : t / 100;
      return s + p.amount_sats * w;
    }, 0);
  b.effective_pot_sats = Math.round(b.effective_pot_sats);
  return b;
}

export function getBounty(id, community_id) {
  expireBounties(); // run expiry check before read
  return getBountyRaw(id, community_id);
}

// Resolve a bounty by id alone (community looked up from the row).
// Used by mutation routes so they don't depend on a community query param.
export function getBountyById(id) {
  expireBounties();
  const db = getDb();
  const row = db.prepare('SELECT community_id FROM bounties WHERE id = ?').get(id);
  if (!row) return null;
  return getBountyRaw(id, row.community_id);
}

export function listBounties({ status, community_id } = {}) {
  expireBounties(); // run expiry check before read
  const db = getDb();
  const cid = community_id || 'default';
  const sql = status
    ? 'SELECT * FROM bounties WHERE community_id = ? AND status = ? ORDER BY created_at DESC'
    : 'SELECT * FROM bounties WHERE community_id = ? ORDER BY created_at DESC';
  const rows = status
    ? db.prepare(sql).all(cid, status)
    : db.prepare(sql).all(cid);

  // Batch preload trust to avoid N+1 (each bounty × each pledge calls computeTrust)
  const pubkeys = new Set();
  for (const b of rows) {
    pubkeys.add(b.creator_pubkey);
    const pledges = db.prepare('SELECT pledger_pubkey FROM pledges WHERE bounty_id = ?').all(b.id);
    for (const p of pledges) pubkeys.add(p.pledger_pubkey);
  }
  const trustCache = new Map();
  for (const pk of pubkeys) trustCache.set(pk, computeTrust(pk));

  return rows.map(b => getBountyRaw(b.id, cid, trustCache));
}

// Look up the bounty's own community_id  -  mutations don't need it from the request.
// This prevents the mismatch where COMMUNITY in the frontend resolves as 'default'
// but the bounty was created in a named community.
function getBountyCommunity(id) {
  const db = getDb();
  const row = db.prepare('SELECT community_id FROM bounties WHERE id = ?').get(id);
  if (!row) throw new Error('Bounty not found');
  return row.community_id;
}

export function claimBounty(id, worker_pubkey, approved_by_pubkey, claimDays = 7) {
  expireBounties();
  const db = getDb();
  const cid = getBountyCommunity(id);
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (b.status !== 'open') throw new Error('Bounty is not open for claiming');
  const claimDeadline = Math.floor(Date.now() / 1000) + claimDays * 86400;
  db.prepare("UPDATE bounties SET status='claimed', worker_pubkey=?, claimed_at=unixepoch(), claim_deadline=? WHERE id=?")
    .run(worker_pubkey, claimDeadline, id);
  return getBounty(id, cid);
}

// ── Applications ────────────────────────────────────────────────────────
export function applyForBounty({ bounty_id, applicant_pubkey }) {
  expireBounties();
  const db = getDb();
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(bounty_id);
  if (!b) throw new Error('Bounty not found');
  if (b.status !== 'open') throw new Error('Bounty is not open for applications');
  const existing = db.prepare('SELECT * FROM applications WHERE bounty_id = ? AND applicant_pubkey = ?').get(bounty_id, applicant_pubkey);
  if (existing) throw new Error('You have already applied for this bounty');
  const id = uuidv4();
  db.prepare(`INSERT INTO applications (id, bounty_id, applicant_pubkey, status)
    VALUES (?, ?, ?, 'pending')`).run(id, bounty_id, applicant_pubkey);
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
}

export function listApplications(bounty_id) {
  return getDb().prepare('SELECT * FROM applications WHERE bounty_id = ? ORDER BY created_at').all(bounty_id);
}

export function getApplication(bounty_id, applicant_pubkey) {
  return getDb().prepare('SELECT * FROM applications WHERE bounty_id = ? AND applicant_pubkey = ?').get(bounty_id, applicant_pubkey);
}

export function approveApplication({ application_id, approved_by_pubkey }) {
  expireBounties();
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(application_id);
  if (!app) throw new Error('Application not found');
  const cid = getBountyCommunity(app.bounty_id);
  if (!isAdmin(cid, approved_by_pubkey)) throw new Error('Only community admins can approve applications');
  if (app.status !== 'pending') throw new Error('Application is not pending');
  db.prepare("UPDATE applications SET status = 'approved' WHERE id = ?").run(application_id);
  return getBounty(app.bounty_id, cid);
}

export function rejectApplication({ application_id, approved_by_pubkey }) {
  expireBounties();
  const db = getDb();
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(application_id);
  if (!app) throw new Error('Application not found');
  const cid = getBountyCommunity(app.bounty_id);
  if (!isAdmin(cid, approved_by_pubkey)) throw new Error('Only community admins can reject applications');
  if (app.status !== 'pending') throw new Error('Application is not pending');
  db.prepare("UPDATE applications SET status = 'rejected' WHERE id = ?").run(application_id);
  return getBounty(app.bounty_id, cid);
}

export function getWorkerApplication(bounty_id, worker_pubkey) {
  return getDb().prepare('SELECT * FROM applications WHERE bounty_id = ? AND applicant_pubkey = ?').get(bounty_id, worker_pubkey);
}

export function submitProof(id, { proof_image, proof_note, worker_invoice }, paymentDays = 7) {
  expireBounties();
  const db = getDb();
  const cid = getBountyCommunity(id);
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (b.status !== 'claimed') throw new Error('Bounty is not in claimed state');
  // Verify claim_deadline not passed
  if (b.claim_deadline && Math.floor(Date.now() / 1000) > b.claim_deadline) {
    throw new Error('Claim deadline has passed  -  this bounty is expired');
  }
  const paymentDeadline = Math.floor(Date.now() / 1000) + paymentDays * 86400;
  db.prepare(`UPDATE bounties SET status='proof_submitted', proof_image=?, proof_note=?, worker_invoice=?, proof_at=unixepoch(), payment_deadline=? WHERE id=?`)
    .run(proof_image || null, proof_note || null, worker_invoice || null, paymentDeadline, id);
  return getBounty(id, cid);
}

export function updateWorkerInvoice(id, worker_invoice) {
  expireBounties();
  const db = getDb();
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (!b) throw new Error('Bounty not found');
  if (b.status !== 'proof_submitted') throw new Error('Can only update invoice address after proof is submitted');
  db.prepare('UPDATE bounties SET worker_invoice = ? WHERE id = ?').run(worker_invoice, id);
  return getBounty(id, b.community_id);
}
// verified_by: admin Nostr pubkey (required).
export function settleBounty(id, verified_by) {
  if (!verified_by) throw new Error('verified_by (admin pubkey) is required to settle a bounty');
  expireBounties();
  const db = getDb();
  const cid = getBountyCommunity(id);
  const b = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
  if (!b) throw new Error('Bounty not found');
  if (b.status === 'settled') throw new Error('Bounty is already settled');
  if (b.status !== 'proof_submitted') throw new Error('Bounty must be in proof_submitted state to settle (current: ' + b.status + ')');
  db.prepare("UPDATE pledges SET status='reneged', verified_by=?, verified_at=unixepoch() WHERE bounty_id=? AND status IN ('pledged','payment_claimed')")
    .run(verified_by, id);
  db.prepare("UPDATE bounties SET status='settled', settled_at=unixepoch() WHERE id=?").run(id);
  return getBounty(id, cid);
}

// ── Auto-invoice + pending ──────────────────────────────────────────────
export function storePledgeInvoice(pledge_id, invoice_request) {
  const db = getDb();
  db.prepare("UPDATE pledges SET invoice_request = ? WHERE id = ?")
    .run(invoice_request, pledge_id);
  return db.prepare('SELECT * FROM pledges WHERE id = ?').get(pledge_id);
}

export function autoPayPledge(pledge_id, preimage) {
  // Called by server when WebLN auto-payment succeeds
  expireBounties();
  const db = getDb();
  const p = db.prepare('SELECT * FROM pledges WHERE id = ?').get(pledge_id);
  if (!p) throw new Error('Pledge not found');
  if (p.status === 'paid') throw new Error('Already paid');
  db.prepare("UPDATE pledges SET status = 'paid', paid_at = unixepoch(), payment_preimage = ? WHERE id = ?")
    .run(preimage || null, pledge_id);
  return db.prepare('SELECT * FROM pledges WHERE id = ?').get(pledge_id);
}

export function pendingForUser(pubkey, community_id) {
  // Returns: { toClaim[], toPay[] } for a user
  expireBounties();
  const db = getDb();
  const cid = community_id || 'default';
  // Jobs this user claimed that need proof submitted
  const toClaim = db.prepare(`
    SELECT * FROM bounties 
    WHERE worker_pubkey = ? AND status = 'claimed' AND community_id = ?
    ORDER BY claimed_at DESC
  `).all(pubkey, cid);
  // Payments this user owes (pledges on proof_submitted bounties)
  const toPay = db.prepare(`
    SELECT p.*, b.title as bounty_title, b.proof_at, b.payment_deadline, b.worker_invoice
    FROM pledges p
    JOIN bounties b ON p.bounty_id = b.id
    WHERE p.pledger_pubkey = ? AND p.status = 'pledged' AND b.status = 'proof_submitted' AND b.community_id = ?
    ORDER BY b.proof_at DESC
  `).all(pubkey, cid);
  return { toClaim, toPay };
}

// ── Pledges ──────────────────────────────────────────────────────────────
export function upsertPledge({ bounty_id, pledger_pubkey, amount_sats, sig_event_id, sig, sig_event_json, sig_verified = false }) {
  expireBounties();
  const db = getDb();
  const bounty = db.prepare('SELECT status FROM bounties WHERE id=?').get(bounty_id);
  if (!bounty) throw new Error('Bounty not found');
  if (bounty.status === 'expired') throw new Error('Bounty has expired  -  cannot pledge');
  if (bounty.status !== 'open') throw new Error('Bounty is not open for pledging');
  const id = uuidv4();
  const existing = db.prepare('SELECT * FROM pledges WHERE bounty_id=? AND pledger_pubkey=?')
    .get(bounty_id, pledger_pubkey);
  if (existing) {
    if (existing.status === 'paid') throw new Error('You have already paid this pledge');
    db.prepare('UPDATE pledges SET amount_sats=?, sig_event_id=?, sig=?, sig_event_json=?, sig_verified=?, status=? WHERE id=?')
      .run(amount_sats, sig_event_id || null, sig || null, sig_event_json || null, sig_verified ? 1 : 0, 'pledged', existing.id);
    return db.prepare('SELECT * FROM pledges WHERE id=?').get(existing.id);
  }
  db.prepare(`INSERT INTO pledges (id, bounty_id, pledger_pubkey, amount_sats, sig_event_id, sig, sig_event_json, sig_verified)
    VALUES (@id, @bounty_id, @pledger_pubkey, @amount_sats, @sig_event_id, @sig, @sig_event_json, @sig_verified)`)
    .run({ id, bounty_id, pledger_pubkey, amount_sats, sig_event_id: sig_event_id || null, sig: sig || null, sig_event_json: sig_event_json || null, sig_verified: sig_verified ? 1 : 0 });
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(id);
}

// Called when pledger self-reports payment ("I paid" button) OR pays via WebLN with preimage.
// If preimage is provided (WebLN payment), trust it and mark as 'paid' immediately.
// If no preimage, sets status to 'payment_claimed' for admin verification.
export function payPledge(pledge_id, preimage) {
  expireBounties();
  const db = getDb();
  const p = db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
  if (!p) throw new Error('Pledge not found');
  if (p.status === 'paid') throw new Error('Already marked as paid');
  if (p.status === 'payment_claimed') throw new Error('Payment already reported');
  const status = preimage ? 'paid' : 'payment_claimed';
  db.prepare("UPDATE pledges SET status=?, paid_at=unixepoch(), payment_preimage=? WHERE id=?")
    .run(status, preimage || null, pledge_id);
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
}

// Called by admin to verify a pledger actually paid.
// Sets status to 'paid' and records who verified it.
export function verifyPayment(pledge_id, verified_by_pubkey) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
  if (!p) throw new Error('Pledge not found');
  if (!['pledged', 'payment_claimed'].includes(p.status))
    throw new Error('Pledge is not in a verifiable state (status: ' + p.status + ')');
  db.prepare("UPDATE pledges SET status='paid', paid_at=COALESCE(paid_at, unixepoch()), verified_by=?, verified_at=unixepoch() WHERE id=?")
    .run(verified_by_pubkey, pledge_id);
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
}

// Called by admin to mark a pledger as reneged (didn't pay after verification window).
export function renegePledge(pledge_id, verified_by_pubkey) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
  if (!p) throw new Error('Pledge not found');
  db.prepare("UPDATE pledges SET status='reneged', verified_by=?, verified_at=unixepoch() WHERE id=?")
    .run(verified_by_pubkey, pledge_id);
  return db.prepare('SELECT * FROM pledges WHERE id=?').get(pledge_id);
}

// ── Zaps ────────────────────────────────────────────────────────────────
export function createZap({ bounty_id, sender_pubkey, recipient_pubkey, amount_sats, memo, preimage }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`INSERT INTO zaps (id, bounty_id, sender_pubkey, recipient_pubkey, amount_sats, memo, preimage)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, bounty_id, sender_pubkey, recipient_pubkey, amount_sats, memo || null, preimage || null);
  return db.prepare('SELECT * FROM zaps WHERE id = ?').get(id);
}

export function listZaps(bounty_id) {
  return getDb().prepare('SELECT * FROM zaps WHERE bounty_id = ? ORDER BY created_at DESC').all(bounty_id);
}

export function getZapTotal(bounty_id) {
  return getDb().prepare('SELECT COALESCE(SUM(amount_sats), 0) as total FROM zaps WHERE bounty_id = ?').get(bounty_id).total;
}

// ── Media ───────────────────────────────────────────────────────────────
export function createMedia({ title, artist, url, cover_url, duration, pubkey }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`INSERT INTO media (id, title, artist, url, cover_url, duration, pubkey)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, title, artist || null, url, cover_url || null, duration || null, pubkey);
  return db.prepare('SELECT * FROM media WHERE id = ?').get(id);
}

export function listMedia(pubkey) {
  const db = getDb();
  if (pubkey) {
    return db.prepare('SELECT * FROM media WHERE pubkey = ? ORDER BY created_at DESC').all(pubkey);
  }
  return db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 50').all();
}

export function deleteMedia(id, pubkey) {
  const db = getDb();
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!m) throw new Error('Media not found');
  if (m.pubkey !== pubkey) throw new Error('Not authorized');
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  return { deleted: true };
}

// ── Nostr Notes ─────────────────────────────────────────────────────────
export function createNostrNote({ pubkey, content, kind, tags, sig, event_id }) {
  const db = getDb();
  const id = uuidv4();
  db.prepare(`INSERT INTO nostr_notes (id, pubkey, content, kind, tags, sig, event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, pubkey, content, kind || 1, tags ? JSON.stringify(tags) : null, sig || null, event_id || null);
  return db.prepare('SELECT * FROM nostr_notes WHERE id = ?').get(id);
}

export function listNostrNotes(pubkey) {
  const db = getDb();
  if (pubkey) {
    return db.prepare('SELECT * FROM nostr_notes WHERE pubkey = ? ORDER BY created_at DESC').all(pubkey);
  }
  return db.prepare('SELECT * FROM nostr_notes ORDER BY created_at DESC LIMIT 50').all();
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
// ── Communities ─────────────────────────────────────────────────────────
export function createCommunity({ id, name, description, region, admin_pubkey }) {
  const db = getDb();
  const normalized = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized || normalized.length < 2) throw new Error('Community ID too short');
  const existing = db.prepare('SELECT id FROM communities WHERE id = ?').get(normalized);
  if (existing) throw new Error('Community ID already taken');
  db.prepare(`INSERT INTO communities (id, name, description, region, admin_pubkey)
    VALUES (?, ?, ?, ?, ?)`).run(normalized, name, description || null, region || null, admin_pubkey);
  // Register the creator as the first admin of the community
  db.prepare('INSERT OR IGNORE INTO community_admins (community_id, admin_pubkey) VALUES (?, ?)')
    .run(normalized, admin_pubkey);
  return db.prepare('SELECT * FROM communities WHERE id=?').get(normalized);
}

export function getCommunity(id) {
  return getDb().prepare('SELECT * FROM communities WHERE id = ?').get(id);
}

export function listCommunities() {
  return getDb().prepare('SELECT * FROM communities ORDER BY name').all();
}

// ── Community Members ───────────────────────────────────────────────
export function joinCommunity(community_id, pubkey, display_name = null) {
  const db = getDb();
  const cid = community_id || 'default';
  db.prepare(
    'INSERT OR IGNORE INTO community_members (community_id, pubkey, display_name) VALUES (?, ?, ?)'
  ).run(cid, pubkey, display_name || null);
  // Update display_name if we have one now and didn't before
  if (display_name) {
    db.prepare(
      'UPDATE community_members SET display_name = ? WHERE community_id = ? AND pubkey = ? AND display_name IS NULL'
    ).run(display_name, cid, pubkey);
  }
}

export function listMembers(community_id) {
  return getDb().prepare(
    'SELECT pubkey, display_name, joined_at FROM community_members WHERE community_id = ? ORDER BY joined_at DESC'
  ).all(community_id || 'default');
}

// ── Admins ──────────────────────────────────────────────────────────────
export function isAdmin(community_id, pubkey) {
  if (!pubkey) return false;
  return !!getDb().prepare(
    'SELECT 1 FROM community_admins WHERE community_id = ? AND admin_pubkey = ?'
  ).get(community_id || 'default', pubkey);
}

export function listAdmins(community_id) {
  return getDb().prepare(
    'SELECT admin_pubkey FROM community_admins WHERE community_id = ?'
  ).all(community_id || 'default').map(r => r.admin_pubkey);
}

export function addAdmin({ community_id, admin_pubkey, added_by_pubkey }) {
  const db = getDb();
  const cid = community_id || 'default';
  // Only existing admins can add new admins
  if (!isAdmin(cid, added_by_pubkey)) throw new Error('Only admins can add admins');
  if (!admin_pubkey || !/^[0-9a-f]{64}$/i.test(admin_pubkey)) throw new Error('Valid admin pubkey required');
  db.prepare(
    'INSERT OR IGNORE INTO community_admins (community_id, admin_pubkey) VALUES (?, ?)'
  ).run(cid, admin_pubkey);
  return db.prepare('SELECT * FROM community_admins WHERE community_id = ? AND admin_pubkey = ?').get(cid, admin_pubkey);
}

export function removeAdmin({ community_id, admin_pubkey, removed_by_pubkey }) {
  const db = getDb();
  const cid = community_id || 'default';
  if (!isAdmin(cid, removed_by_pubkey)) throw new Error('Only admins can remove admins');
  // Prevent removing the last admin
  const count = db.prepare('SELECT COUNT(*) n FROM community_admins WHERE community_id = ?').get(cid).n;
  if (count <= 1) throw new Error('Cannot remove the last admin');
  db.prepare('DELETE FROM community_admins WHERE community_id = ? AND admin_pubkey = ?').run(cid, admin_pubkey);
  return { removed: admin_pubkey };
}

// ── Leaderboards ─────────────────────────────────────────────────────────
export function leaderboards(community_id) {
  const db = getDb();
  const cid = community_id || 'default';
  // Top workers: anyone who has claimed at least 1 job
  // Completed = settled OR proof_submitted (worker did the work; payment is on pledgers)
  const topWorkers = db.prepare(`
    SELECT worker_pubkey as pubkey, COUNT(*) as jobs,
      SUM(CASE WHEN status IN ('settled','proof_submitted') THEN 1 ELSE 0 END) as completed
    FROM bounties WHERE worker_pubkey IS NOT NULL AND community_id = ?
    GROUP BY worker_pubkey ORDER BY jobs DESC LIMIT 20
  `).all(cid);
  // Most reliable pledgers: anyone with at least 1 settled pledge (paid OR reneged)
  const topReliable = db.prepare(`
    SELECT
      p.pledger_pubkey as pubkey,
      SUM(CASE WHEN p.status = 'paid' THEN p.amount_sats ELSE 0 END) as paid_sats,
      SUM(CASE WHEN p.status = 'reneged' THEN p.amount_sats ELSE 0 END) as reneged_sats,
      SUM(CASE WHEN p.status IN ('paid','reneged') THEN p.amount_sats ELSE 0 END) as settled_sats,
      COUNT(CASE WHEN p.status IN ('paid','reneged') THEN 1 END) as settled_count,
      COUNT(CASE WHEN p.status = 'pledged' THEN 1 END) as pending_count,
      ROUND(
        100.0 * SUM(CASE WHEN p.status = 'paid' THEN p.amount_sats ELSE 0 END)
        / NULLIF(SUM(CASE WHEN p.status IN ('paid','reneged') THEN p.amount_sats ELSE 0 END), 0),
        1
      ) as reliability_pct
    FROM pledges p
    JOIN bounties b ON p.bounty_id = b.id
    WHERE b.community_id = ?
    GROUP BY p.pledger_pubkey
    HAVING settled_count >= 1
    ORDER BY reliability_pct DESC, paid_sats DESC
    LIMIT 20
  `).all(cid);
  return { topWorkers, topReliable };
}
