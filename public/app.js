import { getPubkey, getDisplayName, signAction, makeInvoice, payInvoice, inFedi } from './fedi.js';

const app = document.getElementById('app');
const meEl = document.getElementById('me');
let ME = null, MENAME = null;

const api = async (path, opts = {}) => {
  const r = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
};

const sats = (n) => (n || 0).toLocaleString() + ' sats';
const short = (pk) => pk ? pk.slice(0, 8) + '…' + pk.slice(-4) : '—';
const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function badge(b) { return `<span class="badge ${b}">${b}</span>`; }

const CATS = { cleanup: '🧹 Cleanup', painting: '🎨 Painting', repair: '🔧 Repair', other: '📋 Other' };

// ── Router ──
async function route() {
  const hash = location.hash.slice(1) || '/';
  if (hash === '/' ) return renderList('open');
  if (hash === '/all') return renderList(null);
  if (hash === '/new') return renderNew();
  if (hash === '/leaderboard') return renderLeaderboard();
  const m = hash.match(/^\/b\/([0-9a-f-]{36})$/);
  if (m) return renderDetail(m[1]);
  renderList('open');
}
window.addEventListener('hashchange', route);

// ── Browse ──
async function renderList(status) {
  app.innerHTML = `<div class="empty">Loading…</div>`;
  const { bounties } = await api('/bounties' + (status ? `?status=${status}` : ''));
  const tabs = `
    <div class="tabs">
      <div class="tab ${status==='open'?'active':''}" onclick="location.hash='/'">Open</div>
      <div class="tab ${status===null?'active':''}" onclick="location.hash='/all'">All</div>
      <div class="tab" onclick="location.hash='/leaderboard'">🏆 Top</div>
    </div>`;
  if (!bounties.length) {
    app.innerHTML = `<h1>Community needs</h1><div class="sub">Pledge sats. Get it done. Build the roads, together.</div>${tabs}
      <div class="empty">No bounties yet.<br/>Be the first to post one. ↓</div>`;
  } else {
    app.innerHTML = `<h1>Community needs</h1><div class="sub">Pledge sats. Get it done. Build the roads, together.</div>${tabs}
      ${bounties.map(card).join('')}`;
  }
  const fab = document.createElement('button');
  fab.className = 'fab'; fab.textContent = '+ Post a need';
  fab.onclick = () => location.hash = '/new';
  app.appendChild(fab);
}

function card(b) {
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;
  return `<div class="card tap" onclick="location.hash='/b/${b.id}'">
    <div class="row">
      <span class="cat">${CATS[b.category] || CATS.other}</span>
      <span class="status ${b.status}">${b.status.replace('_',' ')}</span>
    </div>
    <div class="bounty-title">${esc(b.title)}</div>
    <div class="desc">${esc(b.description).slice(0,120)}${b.description.length>120?'…':''}</div>
    <div class="pot"><b>${sats(b.pot_sats)}</b> pledged ${b.effective_pot_sats !== b.pot_sats ? `· <span class="eff">~${sats(b.effective_pot_sats)} trust-weighted</span>` : ''}</div>
    ${b.threshold_sats>0 ? `<div class="bar"><span style="width:${pct}%"></span></div>
      <div class="pot" style="font-size:12px">${pct}% of ${sats(b.threshold_sats)} goal</div>` : ''}
  </div>`;
}

// ── New bounty ──
function renderNew() {
  app.innerHTML = `
    <span class="back" onclick="history.back()">← Back</span>
    <h1>Post a community need</h1>
    <div class="sub">What needs doing? Neighbors will pledge sats toward it.</div>
    <div class="card">
      <label>Title</label>
      <input id="f-title" placeholder="e.g. Clean the trash by the community center" maxlength="200"/>
      <label>Details</label>
      <textarea id="f-desc" placeholder="Describe the job so a worker knows what 'done' looks like."></textarea>
      <label>Category</label>
      <select id="f-cat">
        <option value="cleanup">🧹 Cleanup</option>
        <option value="painting">🎨 Painting</option>
        <option value="repair">🔧 Repair</option>
        <option value="other">📋 Other</option>
      </select>
      <label>Goal threshold (sats, optional)</label>
      <input id="f-thresh" type="number" inputmode="numeric" placeholder="0 = claimable anytime"/>
      <div style="height:16px"></div>
      <button id="f-submit">Post need</button>
    </div>`;
  document.getElementById('f-submit').onclick = async (e) => {
    const btn = e.target; btn.disabled = true;
    try {
      const body = {
        title: val('f-title'), description: val('f-desc'),
        category: val('f-cat'), threshold_sats: parseInt(val('f-thresh')) || 0,
        creator_pubkey: ME, display_name: MENAME,
      };
      if (!body.title || !body.description) throw new Error('Title and details are required');
      const { bounty } = await api('/bounties', { method: 'POST', body });
      toast('Posted! 🎉', 'ok');
      location.hash = '/b/' + bounty.id;
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  };
}
const val = (id) => document.getElementById(id).value.trim();

// ── Detail ──
async function renderDetail(id) {
  app.innerHTML = `<div class="empty">Loading…</div>`;
  const { bounty: b } = await api('/bounties/' + id);
  const myPledge = b.pledges.find(p => p.pledger_pubkey === ME);
  const isCreator = b.creator_pubkey === ME;
  const isWorker = b.worker_pubkey === ME;
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;
  const thresholdMet = b.threshold_sats === 0 || b.pot_sats >= b.threshold_sats;

  let actions = '';
  if (b.status === 'open') {
    actions += `<div class="card">
      <label>Pledge sats toward this</label>
      <input id="p-amt" type="number" inputmode="numeric" placeholder="e.g. 5000" value="${myPledge?myPledge.amount_sats:''}"/>
      <div style="height:10px"></div>
      <button id="p-pledge">${myPledge ? 'Update my pledge' : 'Pledge'}</button>
    </div>`;
    if (!isCreator) {
      actions += `<button class="ghost" id="b-claim" ${thresholdMet?'':'disabled'}>${thresholdMet?"🙋 I'll do this":`Reach ${sats(b.threshold_sats)} to claim`}</button>`;
    }
  } else if (b.status === 'claimed' && isWorker) {
    actions += `<div class="card">
      <div class="row"><b>You claimed this.</b> ${badge('')}</div>
      <label>Proof photo</label>
      <input id="p-img" type="file" accept="image/*"/>
      <label>Note (optional)</label>
      <textarea id="p-note" placeholder="What did you do?"></textarea>
      <label>Your Lightning invoice for the pot (optional — pledgers can also pay you directly)</label>
      <input id="p-inv" placeholder="lnbc... (or leave blank)"/>
      <div style="height:12px"></div>
      <button id="b-proof">Submit proof of work</button>
    </div>`;
  } else if (b.status === 'claimed') {
    actions += `<div class="banner">⏳ Claimed by ${short(b.worker_pubkey)} — waiting on proof of work.</div>`;
  } else if (b.status === 'proof_submitted') {
    if (b.proof_image || b.proof_note) {
      actions += `<div class="card proof"><b>Proof of work</b>
        ${b.proof_note?`<div class="desc">${esc(b.proof_note)}</div>`:''}
        ${b.proof_image?`<img src="${b.proof_image}" alt="proof"/>`:''}
        ${b.worker_invoice?`<div class="pot" style="margin-top:8px;font-size:12px">Worker invoice provided</div>`:''}
      </div>`;
    }
    if (myPledge && myPledge.status === 'pledged') {
      actions += `<div class="split">
        <button id="b-pay">✅ Pay my ${sats(myPledge.amount_sats)}</button>
        <button class="ghost" id="b-flag">🚩 Flag bad work</button>
      </div>`;
    } else if (myPledge && myPledge.status === 'paid') {
      actions += `<div class="banner" style="background:#0f2a20;color:var(--green);border-color:#16513d">✅ You paid your pledge. Thank you for building the roads.</div>`;
    }
    if (isCreator) actions += `<div style="height:10px"></div><button class="ghost" id="b-settle">Close & settle this bounty</button>`;
  } else {
    actions += `<div class="banner">This bounty is ${b.status}.</div>`;
  }

  app.innerHTML = `
    <span class="back" onclick="location.hash='/'">← All needs</span>
    <div class="row" style="margin-top:12px">
      <span class="cat">${CATS[b.category]||CATS.other}</span>
      <span class="status ${b.status}">${b.status.replace('_',' ')}</span>
    </div>
    <h1 style="margin-top:6px">${esc(b.title)}</h1>
    <div class="card"><div class="desc" style="margin:0">${esc(b.description)}</div></div>
    <div class="card">
      <div class="pot"><b>${sats(b.pot_sats)}</b> pledged ${b.effective_pot_sats!==b.pot_sats?`· <span class="eff">~${sats(b.effective_pot_sats)} trust-weighted</span>`:''}</div>
      ${b.threshold_sats>0?`<div class="bar"><span style="width:${pct}%"></span></div><div class="pot" style="font-size:12px">${pct}% of ${sats(b.threshold_sats)} goal</div>`:''}
      ${b.pledges.length?`<div class="pledge-list">${b.pledges.map(pledgeRow).join('')}</div>`:'<div class="pot" style="font-size:12px;margin-top:8px">No pledges yet — be the first.</div>'}
    </div>
    ${actions}`;

  // wire actions
  wire('p-pledge', async () => {
    const amt = parseInt(val('p-amt'));
    if (!amt || amt < 1) return toast('Enter an amount', 'err');
    const sig = await signAction(`I pledge ${amt} sats to: ${b.title}`, [['t', 'm2s-pledge'], ['e', b.id]]);
    await api(`/bounties/${id}/pledge`, { method: 'POST', body: { pledger_pubkey: ME, display_name: MENAME, amount_sats: amt, ...sig } });
    toast('Pledged! 🤝', 'ok'); renderDetail(id);
  });
  wire('b-claim', async () => {
    const sig = await signAction(`I claim the task: ${b.title}`, [['t', 'm2s-claim'], ['e', b.id]]);
    await api(`/bounties/${id}/claim`, { method: 'POST', body: { worker_pubkey: ME, display_name: MENAME, ...sig } });
    toast("You claimed it. Go get it done! 💪", 'ok'); renderDetail(id);
  });
  wire('b-proof', async () => {
    const file = document.getElementById('p-img').files[0];
    let image_base64 = null, mime = null;
    if (file) { image_base64 = await fileToB64(file); mime = file.type; }
    await api(`/bounties/${id}/proof`, { method: 'POST', body: { image_base64, mime, proof_note: val('p-note'), worker_invoice: val('p-inv') } });
    toast('Proof submitted! Pledgers will pay up. 📸', 'ok'); renderDetail(id);
  });
  wire('b-pay', async () => {
    try {
      // If worker provided an invoice, pay it; else worker needs to provide one.
      if (!b.worker_invoice) return toast('Worker has not provided an invoice yet.', 'err');
      const preimage = await payInvoice(b.worker_invoice);
      await api(`/pledges/${myPledge.id}/pay`, { method: 'POST', body: { preimage } });
      toast('Paid! ⚡ Trust earned.', 'ok'); renderDetail(id);
    } catch (err) { toast(err.message, 'err'); }
  });
  wire('b-flag', async () => {
    await api(`/bounties/${id}/flag`, { method: 'POST', body: { flagger_pubkey: ME, target_pubkey: b.worker_pubkey, reason: 'bad work' } });
    toast('Flagged. Worker score affected.', 'ok'); renderDetail(id);
  });
  wire('b-settle', async () => {
    await api(`/bounties/${id}/settle`, { method: 'POST', body: {} });
    toast('Settled. Unpaid pledges counted as reneged.', 'ok'); renderDetail(id);
  });
}

function pledgeRow(p) {
  const st = p.status === 'paid' ? '✅' : p.status === 'reneged' ? '❌' : '🤝';
  return `<div class="pledge-row"><span class="pk">${st} ${short(p.pledger_pubkey)}</span><span>${sats(p.amount_sats)}</span></div>`;
}

function wire(id, fn) {
  const el = document.getElementById(id);
  if (el) el.onclick = async (e) => { e.target.disabled = true; try { await fn(); } catch (err) { toast(err.message, 'err'); } if (document.getElementById(id)) e.target.disabled = false; };
}

function fileToB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

// ── Leaderboard ──
async function renderLeaderboard() {
  app.innerHTML = `<div class="empty">Loading…</div>`;
  const lb = await api('/leaderboards');
  app.innerHTML = `
    <span class="back" onclick="location.hash='/'">← Back</span>
    <h1>🏆 Community heroes</h1>
    <div class="sub">The hardest workers and the most generous funders.</div>
    <div class="card"><b>💪 Top workers</b>
      ${lb.topWorkers.length ? lb.topWorkers.map(w=>`<div class="lb-row"><span class="pk">${short(w.pubkey)}</span><span>${w.jobs} job${w.jobs>1?'s':''}</span></div>`).join('') : '<div class="empty" style="padding:20px">No completed jobs yet.</div>'}
    </div>
    <div class="card"><b>🤝 Top funders</b>
      ${lb.topFunders.length ? lb.topFunders.map(f=>`<div class="lb-row"><span class="pk">${short(f.pubkey)}</span><span>${sats(f.sats)}</span></div>`).join('') : '<div class="empty" style="padding:20px">No payments yet.</div>'}
    </div>`;
}

// ── Boot ──
(async function init() {
  try {
    ME = await getPubkey();
    MENAME = await getDisplayName();
    const { trust } = await api('/users/' + ME);
    meEl.innerHTML = `<b>${MENAME || short(ME)}</b><br/>${badge(trust.pledger.badge)} ${trust.pledger.fulfillment_rate!==null?trust.pledger.fulfillment_rate+'%':''}`;
  } catch (e) {
    meEl.textContent = 'guest';
  }
  if (!inFedi()) {
    const w = document.querySelector('.wrap');
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.innerHTML = '🧪 Dev mode (not in Fedi). Lightning payments are simulated; identity is a local test key.';
    w.prepend(banner);
  }
  route();
})();
