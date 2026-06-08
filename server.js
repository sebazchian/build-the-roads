/**
 * build the roads - server
 * Plain Node http: REST API + static frontend + proof uploads.
 * Port 3005 (does NOT collide with DC 3000/3001, StackMon 3002, SCARP 3003, NostrScope 3004, gateway 18789)
 */
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname, normalize } from 'path';
import { randomUUID } from 'crypto';
import * as db from './lib/db.js';
import { verifyNostrEvent } from './lib/nostr-verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT) || 3005;
const isProd = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = join(__dirname, 'public');
const UPLOAD_DIR = join(__dirname, 'uploads');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function send(res, code, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

async function serveStatic(res, urlPath, req) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  const isApiLike = urlPath.startsWith('/api/');
  const accept = req.headers.accept || '';

  let data;
  try { data = await readFile(file); } catch {
    if (isApiLike) return send(res, 404, { error: 'not found' });
    if (!accept.includes('text/html')) return send(res, 404, { error: 'not found' });
    try { data = await readFile(join(PUBLIC_DIR, 'index.html')); }
    catch { return send(res, 404, { error: 'not found' }); }
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}

async function serveUpload(res, name) {
  const safe = normalize(name).replace(/^(\.\.[/\\])+/, '');
  const file = join(UPLOAD_DIR, safe);
  if (!file.startsWith(UPLOAD_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const meta = await import('fs/promises').then(m => m.stat(file));
    if (meta.size > 10 * 1024 * 1024) return send(res, 413, { error: 'upload too large' });
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  } catch { send(res, 404, { error: 'not found' }); }
}

const isPubkey = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);

function isPng(buffer) {
  return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
}
function isJpeg(buffer) {
  return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
}
function isImage(buffer) {
  return isPng(buffer) || isJpeg(buffer);
}

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const server = createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // community id: from query params (GET) or body (mutations)
  const getCid = () => url.searchParams.get('community') || 'default';

  try {
    // ── API ──
    if (p === '/api/health') {
      return send(res, 200, { status: 'ok', service: 'build the roads', ts: Math.floor(Date.now() / 1000) });
    }

    if (p === '/api/bounties' && req.method === 'GET') {
      const status = url.searchParams.get('status') || undefined;
      const cid = getCid();
      return send(res, 200, { bounties: db.listBounties({ status, community_id: cid }) });
    }

    if (p === '/api/bounties' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.title || !b.description) return send(res, 400, { error: 'title and description required' });
      if (!isPubkey(b.creator_pubkey)) return send(res, 400, { error: 'valid creator_pubkey required' });
      const cid = b.community_id || 'default';
      // Only admins can create bounties (except default community for dev)
      if (cid !== 'default' && !db.isAdmin(cid, b.creator_pubkey)) {
        return send(res, 403, { error: 'Only community admins can post jobs' });
      }
      db.ensureUser(b.creator_pubkey, b.display_name);
      const bounty = db.createBounty({
        title: String(b.title).slice(0, 200),
        description: String(b.description).slice(0, 2000),
        category: b.category, creator_pubkey: b.creator_pubkey,
        expires_at: b.expires_at ? parseInt(b.expires_at) : null,
        community_id: cid,
      });
      return send(res, 201, { bounty });
    }

    const bountyMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})$/);
    if (bountyMatch && req.method === 'GET') {
      const cid = getCid();
      const b = db.getBounty(bountyMatch[1], cid);
      return b ? send(res, 200, { bounty: b }) : send(res, 404, { error: 'not found' });
    }

    // pledge  -  enforce Nostr sig (prod: hard reject; dev: warn+accept)
    const pledgeMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/pledge$/);
    if (pledgeMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.pledger_pubkey)) return send(res, 400, { error: 'valid pledger_pubkey required' });
      const amt = parseInt(body.amount_sats);
      if (!amt || amt < 1) return send(res, 400, { error: 'amount_sats must be >= 1' });
      let sigVerified = false;
      if (!body.sig_event || typeof body.sig_event !== 'object') {
        if (isProd) return send(res, 403, { error: 'Nostr signature required  -  open this in the Fedi app.' });
        console.warn('[server] DEV: pledge without Nostr signature from', body.pledger_pubkey.slice(0, 12));
      } else {
        const v = verifyNostrEvent(body.sig_event, body.pledger_pubkey);
        if (!v.ok) {
          if (isProd) return send(res, 403, { error: `Nostr signature verification failed: ${v.error}` });
          console.warn('[server] DEV: invalid Nostr sig from', body.pledger_pubkey.slice(0, 12), v.error);
        } else {
          sigVerified = true;
        }
      }
      db.ensureUser(body.pledger_pubkey, body.display_name);
      const pledge = db.upsertPledge({
        bounty_id: pledgeMatch[1], pledger_pubkey: body.pledger_pubkey,
        amount_sats: amt,
        sig_event_id: body.sig_event?.id || null,
        sig: body.sig_event?.sig || null,
        sig_event_json: body.sig_event ? JSON.stringify(body.sig_event) : null,
        sig_verified: sigVerified,
      });
      const cid = body.community_id || getCid();
      return send(res, 201, { pledge, bounty: db.getBounty(pledgeMatch[1], cid) });
    }

    // apply  -  worker applies for a bounty (requires Nostr sig)
    const applyMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/apply$/);
    if (applyMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.applicant_pubkey)) return send(res, 400, { error: 'valid applicant_pubkey required' });
      db.ensureUser(body.applicant_pubkey, body.display_name);
      try {
        const application = db.applyForBounty({ bounty_id: applyMatch[1], applicant_pubkey: body.applicant_pubkey });
        return send(res, 201, { application });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }

    // list applications for a bounty
    const applicationsMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/applications$/);
    if (applicationsMatch && req.method === 'GET') {
      const pk = url.searchParams.get('admin_pubkey');
      const bounty = db.getBountyById(applicationsMatch[1]);
      if (!bounty) return send(res, 404, { error: 'not found' });
      // Only admins or the applicant can view applications
      if (!db.isAdmin(bounty.community_id, pk)) return send(res, 403, { error: 'admin required to view applications' });
      return send(res, 200, { applications: db.listApplications(applicationsMatch[1]) });
    }

    // approve application  -  admin only
    const approveMatch = p.match(/^\/api\/applications\/([0-9a-f-]{36})\/approve$/);
    if (approveMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.admin_pubkey)) return send(res, 400, { error: 'admin_pubkey required' });
      try {
        const bounty = db.approveApplication({ application_id: approveMatch[1], approved_by_pubkey: body.admin_pubkey });
        return send(res, 200, { bounty });
      } catch (e) {
        return send(res, 403, { error: e.message });
      }
    }

    // reject application  -  admin only
    const rejectMatch = p.match(/^\/api\/applications\/([0-9a-f-]{36})\/reject$/);
    if (rejectMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.admin_pubkey)) return send(res, 400, { error: 'admin_pubkey required' });
      try {
        const bounty = db.rejectApplication({ application_id: rejectMatch[1], approved_by_pubkey: body.admin_pubkey });
        return send(res, 200, { bounty });
      } catch (e) {
        return send(res, 403, { error: e.message });
      }
    }

    // claim  -  now requires an approved application
    const claimMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/claim$/);
    if (claimMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.worker_pubkey)) return send(res, 400, { error: 'valid worker_pubkey required' });
      const b = db.getBountyById(claimMatch[1]);
      if (!b) return send(res, 404, { error: 'not found' });
      // Check for approved application
      const app = db.getApplication(claimMatch[1], body.worker_pubkey);
      if (!app || app.status !== 'approved') {
        return send(res, 403, { error: 'You must apply and be approved by an admin before claiming this bounty' });
      }
      let sigVerified = false;
      if (!body.sig_event || typeof body.sig_event !== 'object') {
        if (isProd) return send(res, 403, { error: 'Nostr signature required  -  open this in the Fedi app.' });
        console.warn('[server] DEV: claim without Nostr signature from', body.worker_pubkey.slice(0, 12));
      } else {
        const v = verifyNostrEvent(body.sig_event, body.worker_pubkey);
        if (!v.ok) {
          if (isProd) return send(res, 403, { error: `Nostr signature verification failed: ${v.error}` });
          console.warn('[server] DEV: invalid Nostr sig from', body.worker_pubkey.slice(0, 12), v.error);
        } else {
          sigVerified = true;
        }
      }
      db.ensureUser(body.worker_pubkey, body.display_name);
      const bounty = db.claimBounty(claimMatch[1], body.worker_pubkey, body.admin_pubkey || null);
      return send(res, 200, { bounty });
    }

    // proof  -  with image magic-number validation
    const proofMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/proof$/);
    if (proofMatch && req.method === 'POST') {
      const body = await readJson(req);
      let imagePath = null;
      if (body.image_base64) {
        await mkdir(UPLOAD_DIR, { recursive: true });
        const b64 = body.image_base64.replace(/^data:[^,]+,/, '');
        const data = Buffer.from(b64, 'base64');
        if (data.length > 8 * 1024 * 1024) return send(res, 400, { error: 'image too large (max 8MB)' });
        if (!isImage(data)) return send(res, 400, { error: 'upload must be a PNG or JPEG image' });
        const ext = isPng(data) ? '.png' : '.jpg';
        const fname = `proof-${proofMatch[1]}-${randomUUID().slice(0, 8)}${ext}`;
        await writeFile(join(UPLOAD_DIR, fname), data);
        imagePath = `/uploads/${fname}`;
      }
      const bounty = db.submitProof(proofMatch[1], {
        proof_image: imagePath, proof_note: body.proof_note, worker_invoice: body.worker_invoice,
      });
      // Auto-pay: if preimage provided (from WebLN sendPayment), mark all this user's pledges as paid
      if (body.preimage && isPubkey(body.worker_pubkey)) {
        const b = db.getBounty(proofMatch[1], bounty.community_id);
        for (const pl of b.pledges) {
          if (pl.pledger_pubkey === body.worker_pubkey && pl.status === 'pledged') {
            db.autoPayPledge(pl.id, body.preimage);
          }
        }
      }
      return send(res, 200, { bounty: db.getBounty(proofMatch[1], bounty.community_id) });
    }

    // Generate BOLT11 invoice for each pledge on a proof_submitted bounty
    // Called by frontend when worker submits proof (server resolves LNURL)
    const invoiceMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/invoices$/);
    if (invoiceMatch && req.method === 'POST') {
      const { resolveInvoiceFromAddress } = await import('./lib/lnurl.js');
      const id = invoiceMatch[1];
      const cid = getCid();
      console.log(`[invoices] generating for bounty=${id}, community=${cid}`);
      const b = db.getBounty(id, cid);
      if (!b) {
        console.error(`[invoices] bounty not found: ${id}`);
        return send(res, 404, { error: 'Bounty not found' });
      }
      console.log(`[invoices] bounty status=${b.status}, worker_invoice=${b.worker_invoice ? 'yes' : 'no'}, pledges=${b.pledges?.length || 0}`);
      if (b.status !== 'proof_submitted') {
        return send(res, 400, { error: 'Bounty is not awaiting payment (status: ' + b.status + ')' });
      }
      if (!b.worker_invoice) {
        return send(res, 400, { error: 'Worker has no Lightning address' });
      }
      const pledgesToInvoice = b.pledges.filter(p => p.status === 'pledged');
      console.log(`[invoices] pledges to invoice: ${pledgesToInvoice.length}`);
      const results = [];
      for (const pl of pledgesToInvoice) {
        try {
          console.log(`[invoices] resolving ${pl.amount_sats} sats for pledge ${pl.id}`);
          const { pr } = await resolveInvoiceFromAddress(b.worker_invoice, pl.amount_sats, 'build the roads: ' + b.title);
          db.storePledgeInvoice(pl.id, pr);
          results.push({ pledge_id: pl.id, invoice: pr });
          console.log(`[invoices] generated invoice for pledge ${pl.id}`);
        } catch (e) {
          console.error(`[invoices] failed for pledge ${pl.id}:`, e.message);
          results.push({ pledge_id: pl.id, error: e.message });
        }
      }
      return send(res, 200, { invoices: results, bounty: db.getBounty(id, cid) });
    }

    // Auto-pay: pledger pays via pre-generated invoice, server records it (or preimage from WebLN)
    const autoPayMatch = p.match(/^\/api\/pledges\/([0-9a-f-]{36})\/autopay$/);
    if (autoPayMatch && req.method === 'POST') {
      const body = await readJson(req);
      const pledge = db.autoPayPledge(autoPayMatch[1], body.preimage || 'auto');
      return send(res, 200, { pledge });
    }

    const payMatch = p.match(/^\/api\/pledges\/([0-9a-f-]{36})\/pay$/);
    if (payMatch && req.method === 'POST') {
      const body = await readJson(req);
      // Self-reported payment: marks as 'payment_claimed', not yet verified
      const pledge = db.payPledge(payMatch[1], body.preimage);
      return send(res, 200, { pledge });
    }

    // Admin: verify a pledger actually paid
    const verifyPayMatch = p.match(/^\/api\/pledges\/([0-9a-f-]{36})\/verify$/);
    if (verifyPayMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.verified_by))
        return send(res, 400, { error: 'verified_by (admin pubkey) required' });
      const pledge = db.verifyPayment(verifyPayMatch[1], body.verified_by);
      return send(res, 200, { pledge });
    }

    // Admin: mark a pledger as reneged
    const renegeMatch = p.match(/^\/api\/pledges\/([0-9a-f-]{36})\/renege$/);
    if (renegeMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.verified_by))
        return send(res, 400, { error: 'verified_by (admin pubkey) required' });
      const pledge = db.renegePledge(renegeMatch[1], body.verified_by);
      return send(res, 200, { pledge });
    }

    // Worker can add/update their Lightning address after proof submission (retroactive fix)
    const workerInvMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/worker-invoice$/);
    if (workerInvMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!body.worker_invoice) return send(res, 400, { error: 'worker_invoice required' });
      const id = workerInvMatch[1];
      const b = db.getBounty(id, getCid());
      if (!b) return send(res, 404, { error: 'not found' });
      db.updateWorkerInvoice(id, body.worker_invoice);
      return send(res, 200, { bounty: db.getBounty(id, b.community_id) });
    }

    const settleMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/settle$/);
    if (settleMatch && req.method === 'POST') {
      const body = await readJson(req);
      // verified_by is required: only admin can settle after verifying payments
      if (!isPubkey(body.verified_by))
        return send(res, 400, { error: 'verified_by (admin pubkey) required to settle' });
      const bounty = db.settleBounty(settleMatch[1], body.verified_by);
      return send(res, 200, { bounty });
    }

    const flagMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/flag$/);
    if (flagMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.flagger_pubkey) || !isPubkey(body.target_pubkey))
        return send(res, 400, { error: 'valid pubkeys required' });
      const flag = db.addFlag({ bounty_id: flagMatch[1], ...body });
      return send(res, 201, { flag });
    }

    const userMatch = p.match(/^\/api\/users\/([0-9a-f]{64})$/);
    if (userMatch && req.method === 'GET') {
      db.ensureUser(userMatch[1]);
      return send(res, 200, { trust: db.computeTrust(userMatch[1]), user: db.getUser(userMatch[1]) });
    }

    if (p === '/api/leaderboards' && req.method === 'GET') {
      const cid = getCid();
      return send(res, 200, db.leaderboards(cid));
    }

    if (p === '/api/communities' && req.method === 'GET') {
      return send(res, 200, { communities: db.listCommunities() });
    }

    if (p === '/api/communities' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body.id || !body.name || !isPubkey(body.admin_pubkey)) {
        return send(res, 400, { error: 'id, name, and admin_pubkey required' });
      }
      db.ensureUser(body.admin_pubkey, body.admin_display_name);
      const community = db.createCommunity({
        id: body.id, name: body.name, description: body.description,
        region: body.region, admin_pubkey: body.admin_pubkey
      });
      return send(res, 201, { community });
    }

    // ── Admin management ──────────────────────────────────────────────────
    const adminsMatch = p.match(/^\/api\/communities\/([a-z0-9-]+)\/admins$/);
    if (adminsMatch && req.method === 'GET') {
      return send(res, 200, { admins: db.listAdmins(adminsMatch[1]) });
    }
    if (adminsMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.admin_pubkey) || !isPubkey(body.added_by_pubkey))
        return send(res, 400, { error: 'admin_pubkey and added_by_pubkey required' });
      try {
        const result = db.addAdmin({ community_id: adminsMatch[1], admin_pubkey: body.admin_pubkey, added_by_pubkey: body.added_by_pubkey });
        return send(res, 201, { admin: result });
      } catch (e) {
        return send(res, 403, { error: e.message });
      }
    }
    const adminDeleteMatch = p.match(/^\/api\/communities\/([a-z0-9-]+)\/admins\/([0-9a-f]{64})$/);
    if (adminDeleteMatch && req.method === 'DELETE') {
      const body = await readJson(req);
      try {
        const result = db.removeAdmin({ community_id: adminDeleteMatch[1], admin_pubkey: adminDeleteMatch[2], removed_by_pubkey: body.removed_by_pubkey });
        return send(res, 200, result);
      } catch (e) {
        return send(res, 403, { error: e.message });
      }
    }
    const isAdminMatch = p.match(/^\/api\/communities\/([a-z0-9-]+)\/is-admin$/);
    if (isAdminMatch && req.method === 'GET') {
      const pk = url.searchParams.get('pubkey');
      if (!isPubkey(pk)) return send(res, 400, { error: 'pubkey required' });
      return send(res, 200, { is_admin: db.isAdmin(isAdminMatch[1], pk) });
    }

    if (p === '/api/communities/my' && req.method === 'GET') {
      const pk = url.searchParams.get('pubkey');
      if (!isPubkey(pk)) return send(res, 400, { error: 'pubkey required' });
      const owned = db.listCommunities().filter(c => c.admin_pubkey === pk);
      return send(res, 200, { communities: owned });
    }

    if (p === '/api/pending' && req.method === 'GET') {
      const pk = url.searchParams.get('pubkey');
      const cid = getCid();
      if (!isPubkey(pk)) return send(res, 400, { error: 'pubkey required' });
      const pending = db.pendingForUser(pk, cid);
      return send(res, 200, pending);
    }

    // ── Zaps ──────────────────────────────────────────────────────────────
    if (p === '/api/zaps' && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.sender_pubkey) || !isPubkey(body.recipient_pubkey)) {
        return send(res, 400, { error: 'valid sender and recipient pubkeys required' });
      }
      const amt = parseInt(body.amount_sats);
      if (!amt || amt < 1) return send(res, 400, { error: 'amount_sats must be >= 1' });
      db.ensureUser(body.sender_pubkey, body.display_name);
      const zap = db.createZap({
        bounty_id: body.bounty_id,
        sender_pubkey: body.sender_pubkey,
        recipient_pubkey: body.recipient_pubkey,
        amount_sats: amt,
        memo: body.memo,
        preimage: body.preimage,
      });
      return send(res, 201, { zap });
    }

    if (p === '/api/zaps' && req.method === 'GET') {
      const bountyId = url.searchParams.get('bounty_id');
      if (!bountyId) return send(res, 400, { error: 'bounty_id required' });
      const zaps = db.listZaps(bountyId);
      const total = db.getZapTotal(bountyId);
      return send(res, 200, { zaps, total });
    }

    // ── Media ─────────────────────────────────────────────────────────────
    if (p === '/api/media' && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.pubkey)) return send(res, 400, { error: 'valid pubkey required' });
      if (!body.title || !body.url) return send(res, 400, { error: 'title and url required' });
      db.ensureUser(body.pubkey, body.display_name);
      const media = db.createMedia({
        title: body.title,
        artist: body.artist,
        url: body.url,
        cover_url: body.cover_url,
        duration: body.duration,
        pubkey: body.pubkey,
      });
      return send(res, 201, { media });
    }

    if (p === '/api/media' && req.method === 'GET') {
      const pubkey = url.searchParams.get('pubkey');
      const media = db.listMedia(pubkey);
      return send(res, 200, { media });
    }

    const mediaDeleteMatch = p.match(/^\/api\/media\/([0-9a-f-]{36})$/);
    if (mediaDeleteMatch && req.method === 'DELETE') {
      const body = await readJson(req);
      if (!isPubkey(body.pubkey)) return send(res, 400, { error: 'valid pubkey required' });
      const result = db.deleteMedia(mediaDeleteMatch[1], body.pubkey);
      return send(res, 200, result);
    }

    // ── Nostr Notes ────────────────────────────────────────────────────────
    if (p === '/api/nostr' && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.pubkey)) return send(res, 400, { error: 'valid pubkey required' });
      if (!body.content) return send(res, 400, { error: 'content required' });
      db.ensureUser(body.pubkey, body.display_name);
      const note = db.createNostrNote({
        pubkey: body.pubkey,
        content: String(body.content).slice(0, 1000),
        kind: body.kind || 1,
        tags: body.tags,
        sig: body.sig,
        event_id: body.event_id,
      });
      return send(res, 201, { note });
    }

    if (p === '/api/nostr' && req.method === 'GET') {
      const pubkey = url.searchParams.get('pubkey');
      const notes = db.listNostrNotes(pubkey);
      return send(res, 200, { notes });
    }

    // ── uploads & static ──
    if (p.startsWith('/uploads/')) return serveUpload(res, p.slice('/uploads/'.length));
    if (!p.startsWith('/api/')) return serveStatic(res, p, req);

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[server]', req.method, p, '→', err.message);
    return send(res, 400, { error: err.message });
  }
});

db.getDb(); // init + health on boot
server.listen(PORT, '0.0.0.0', () => {
  console.log(`💸 build the roads running on http://0.0.0.0:${PORT}`);
});
