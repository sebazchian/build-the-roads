/**
 * my two sats — server
 * Plain Node http: REST API + static frontend + proof uploads.
 * Port 3005 (does NOT collide with DC 3000/3001, StackMon 3002, SCARP 3003, NostrScope 3004, gateway 18789)
 */
import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname, normalize } from 'path';
import { randomUUID } from 'crypto';
import * as db from './lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT) || 3005;
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

async function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback
    try {
      const data = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    } catch { send(res, 404, { error: 'not found' }); }
  }
}

async function serveUpload(res, name) {
  const safe = normalize(name).replace(/^(\.\.[/\\])+/, '');
  const file = join(UPLOAD_DIR, safe);
  if (!file.startsWith(UPLOAD_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  } catch { send(res, 404, { error: 'not found' }); }
}

// minimal pubkey sanity check (64 hex chars)
const isPubkey = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // ── API ──
    if (p === '/api/health') {
      return send(res, 200, { status: 'ok', service: 'my two sats', ts: Math.floor(Date.now() / 1000) });
    }

    if (p === '/api/bounties' && req.method === 'GET') {
      const status = url.searchParams.get('status') || undefined;
      return send(res, 200, { bounties: db.listBounties({ status }) });
    }

    if (p === '/api/bounties' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.title || !b.description) return send(res, 400, { error: 'title and description required' });
      if (!isPubkey(b.creator_pubkey)) return send(res, 400, { error: 'valid creator_pubkey required' });
      db.ensureUser(b.creator_pubkey, b.display_name);
      const bounty = db.createBounty({
        title: String(b.title).slice(0, 200),
        description: String(b.description).slice(0, 2000),
        category: b.category, creator_pubkey: b.creator_pubkey,
        threshold_sats: parseInt(b.threshold_sats) || 0,
        expires_at: b.expires_at ? parseInt(b.expires_at) : null,
      });
      return send(res, 201, { bounty });
    }

    const bountyMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})$/);
    if (bountyMatch && req.method === 'GET') {
      const b = db.getBounty(bountyMatch[1]);
      return b ? send(res, 200, { bounty: b }) : send(res, 404, { error: 'not found' });
    }

    // pledge
    const pledgeMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/pledge$/);
    if (pledgeMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.pledger_pubkey)) return send(res, 400, { error: 'valid pledger_pubkey required' });
      const amt = parseInt(body.amount_sats);
      if (!amt || amt < 1) return send(res, 400, { error: 'amount_sats must be >= 1' });
      db.ensureUser(body.pledger_pubkey, body.display_name);
      const pledge = db.upsertPledge({
        bounty_id: pledgeMatch[1], pledger_pubkey: body.pledger_pubkey,
        amount_sats: amt, sig_event_id: body.sig_event_id, sig: body.sig,
      });
      return send(res, 201, { pledge, bounty: db.getBounty(pledgeMatch[1]) });
    }

    // claim
    const claimMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/claim$/);
    if (claimMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.worker_pubkey)) return send(res, 400, { error: 'valid worker_pubkey required' });
      db.ensureUser(body.worker_pubkey, body.display_name);
      const bounty = db.claimBounty(claimMatch[1], body.worker_pubkey);
      return send(res, 200, { bounty });
    }

    // proof (JSON: { image_base64, mime, proof_note, worker_invoice })
    const proofMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/proof$/);
    if (proofMatch && req.method === 'POST') {
      const body = await readJson(req);
      let imagePath = null;
      if (body.image_base64) {
        await mkdir(UPLOAD_DIR, { recursive: true });
        const ext = (body.mime && body.mime.includes('png')) ? '.png' : '.jpg';
        const fname = `proof-${proofMatch[1]}-${randomUUID().slice(0, 8)}${ext}`;
        const data = Buffer.from(body.image_base64.replace(/^data:[^,]+,/, ''), 'base64');
        if (data.length > 8 * 1024 * 1024) return send(res, 400, { error: 'image too large (max 8MB)' });
        await writeFile(join(UPLOAD_DIR, fname), data);
        imagePath = `/uploads/${fname}`;
      }
      const bounty = db.submitProof(proofMatch[1], {
        proof_image: imagePath, proof_note: body.proof_note, worker_invoice: body.worker_invoice,
      });
      return send(res, 200, { bounty });
    }

    // pay a pledge (record WebLN preimage)
    const payMatch = p.match(/^\/api\/pledges\/([0-9a-f-]{36})\/pay$/);
    if (payMatch && req.method === 'POST') {
      const body = await readJson(req);
      const pledge = db.payPledge(payMatch[1], body.preimage);
      return send(res, 200, { pledge });
    }

    // settle
    const settleMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/settle$/);
    if (settleMatch && req.method === 'POST') {
      const bounty = db.settleBounty(settleMatch[1]);
      return send(res, 200, { bounty });
    }

    // flag
    const flagMatch = p.match(/^\/api\/bounties\/([0-9a-f-]{36})\/flag$/);
    if (flagMatch && req.method === 'POST') {
      const body = await readJson(req);
      if (!isPubkey(body.flagger_pubkey) || !isPubkey(body.target_pubkey))
        return send(res, 400, { error: 'valid pubkeys required' });
      const flag = db.addFlag({ bounty_id: flagMatch[1], ...body });
      return send(res, 201, { flag });
    }

    // user trust profile
    const userMatch = p.match(/^\/api\/users\/([0-9a-f]{64})$/);
    if (userMatch && req.method === 'GET') {
      db.ensureUser(userMatch[1]);
      return send(res, 200, { trust: db.computeTrust(userMatch[1]), user: db.getUser(userMatch[1]) });
    }

    if (p === '/api/leaderboards' && req.method === 'GET') {
      return send(res, 200, db.leaderboards());
    }

    // ── uploads & static ──
    if (p.startsWith('/uploads/')) return serveUpload(res, p.slice('/uploads/'.length));
    if (!p.startsWith('/api/')) return serveStatic(res, p);

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[server]', req.method, p, '→', err.message);
    return send(res, 400, { error: err.message });
  }
});

db.getDb(); // init + health on boot
server.listen(PORT, '0.0.0.0', () => {
  console.log(`💸 my two sats running on http://0.0.0.0:${PORT}`);
});
