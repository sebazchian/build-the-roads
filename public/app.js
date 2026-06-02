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

const $ = (id) => document.getElementById(id);
const fmtSats = (n) => n ? n.toLocaleString() + ' sats' : '0 sats';
const fmtNum = (n) => n ? n.toLocaleString() : '0';
const short = (pk) => pk ? pk.slice(0, 6) + '…' + pk.slice(-4) : '—';
const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function trustClass(badge) {
  if (badge === 'Reliable' || badge === 'Trusted') return 'good';
  if (badge === 'Mixed') return 'warn';
  if (badge === 'Flaky' || badge === 'Unreliable') return 'bad';
  return 'new';
}
function trustLabel(t) {
  if (t.fulfillment_rate !== null) return `${t.fulfillment_rate}% — ${t.badge}`;
  return t.badge || 'New';
}

const CATS = {
  cleanup: { label: 'Cleanup', icon: '🧹', cls: 'cleanup' },
  painting: { label: 'Painting', icon: '🎨', cls: 'painting' },
  repair: { label: 'Repair', icon: '🔧', cls: 'repair' },
  other: { label: 'Other', icon: '📝', cls: 'other' }
};
const STATUS_WORDS = { open: 'Open', claimed: 'Claimed', proof_submitted: 'Waiting on payments', settled: 'Done & paid', cancelled: 'Cancelled', expired: 'Expired' };

// ── Router ──
function route() {
  const h = location.hash.slice(1) || '/';
  if (h === '/') return renderHome(null);
  if (h === '/open') return renderHome('open');
  if (h === '/all') return renderHome(null);
  if (h === '/new') return renderNew();
  if (h === '/leaderboard') return renderLeaderboard();
  const m = h.match(/^\/b\/([0-9a-f-]{36})$/);
  if (m) return renderDetail(m[1]);
  renderHome('open');
}
window.addEventListener('hashchange', route);

// ── Home ──
async function renderHome(filterStatus) {
  app.innerHTML = '';
  const intro = document.createElement('div');
  intro.className = 'intro';
  intro.innerHTML = `<h1>my two sats</h1><p>Your neighbour needs something done. You need a few sats. This is the place where both of those things meet.</p>`;
  app.appendChild(intro);

  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const st = filterStatus || 'all';
  tabs.innerHTML = `
    <div class="tab ${st==='open'?'active':''}" onclick="location.hash='/open'">Open</div>
    <div class="tab ${st==='all'?'active':''}" onclick="location.hash='/all'">Everything</div>
    <div class="tab" onclick="location.hash='/leaderboard'">🏆</div>`;
  app.appendChild(tabs);

  const loading = document.createElement('div');
  loading.className = 'empty'; loading.textContent = 'Loading…';
  app.appendChild(loading);

  try {
    const { bounties } = await api('/bounties' + (filterStatus ? `?status=${filterStatus}` : ''));
    loading.remove();

    if (!bounties.length) {
      app.innerHTML += `<div class="empty"><strong>Nothing here yet.</strong>That's actually kind of beautiful — be the first person to post a need in your community. Someone will show up.</div>`;
    } else {
      bounties.forEach(b => app.appendChild(makeCard(b)));
    }
  } catch (e) {
    loading.remove();
    toast(e.message, true);
  }

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.textContent = '+ Post a need';
  fab.onclick = () => location.hash = '/new';
  app.appendChild(fab);
}

function makeCard(b) {
  const el = document.createElement('div'); el.className = 'card tap'; el.tabIndex = 0;
  const c = CATS[b.category] || CATS.other;
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;
  const hasEff = b.effective_pot_sats !== b.pot_sats;

  el.innerHTML = `
    <div class="row" style="margin-bottom:4px">
      <span class="cat ${c.cls}">${c.icon} ${c.label}</span>
      <span class="status ${b.status}">${STATUS_WORDS[b.status] || b.status}</span>
    </div>
    <div class="bounty-title">${esc(b.title)}</div>
    <div class="desc">${esc(b.description)}</div>
    <div class="row" style="align-items:flex-end">
      <div class="pot">
        <span class="amount">${fmtNum(b.pot_sats)}</span> sats pledged
        ${hasEff ? `<br><span class="eff">~${fmtNum(b.effective_pot_sats)} trusted</span>` : ''}
      </div>
      ${b.pledges.length ? `<span style="font-size:12px;color:var(--ink-faint)">${b.pledges.length} pledger${b.pledges.length!==1?'s':''}</span>` : ''}
    </div>
    ${b.threshold_sats>0 ? `<div class="bar"><span style="width:${pct}%"></span></div>
      <div style="font-size:12px;color:var(--ink-faint)">${pct}% of ${fmtSats(b.threshold_sats)} needed</div>` : ''}`;
  el.onclick = () => { location.hash = `/b/${b.id}`; };
  return el;
}

// ── New ──
function renderNew() {
  app.innerHTML = '';
  app.innerHTML += `<span class="back" onclick="history.back()">← Back</span>`;
  app.innerHTML += `<h1 style="margin-top:14px">What needs doing?</h1><p class="desc" style="margin-top:4px">Describe the job like you're telling a friend. A photo later helps a lot.</p>`;

  const form = document.createElement('div'); form.className = 'card'; form.style = 'margin-top:14px';
  form.innerHTML = `
    <label>What is it?</label>
    <input id="f-title" placeholder="e.g. Clean up the lot behind the rec centre" maxlength="200" autocomplete="off"/>
    <label>Tell the story</label>
    <textarea id="f-desc" placeholder="What's the situation? What does 'done' look like? Include a deadline if there is one."></textarea>
    <label>Category</label>
    <select id="f-cat">
      <option value="cleanup">🧹 Cleanup</option>
      <option value="painting">🎨 Painting</option>
      <option value="repair">🔧 Repair</option>
      <option value="other">📋 Something else</option>
    </select>
    <label>Minimum pot to get started (sats, optional)</label>
    <input id="f-thresh" type="number" inputmode="numeric" placeholder="0 = anyone can claim it right away"/>
    <div style="height:6px"></div>
    <button id="f-submit" style="margin-top:10px">Post it</button>`;
  app.appendChild(form);

  $('f-submit').onclick = async () => {
    const btn = $('f-submit'); btn.disabled = true;
    try {
      const body = {
        title: $('f-title').value.trim(), description: $('f-desc').value.trim(),
        category: $('f-cat').value, threshold_sats: parseInt($('f-thresh').value) || 0,
        creator_pubkey: ME, display_name: MENAME,
      };
      if (!body.title || !body.description) throw new Error('Need a title and a story.');
      const { bounty } = await api('/bounties', { method: 'POST', body });
      toast('Posted! Now watch the sats roll in.');
      location.hash = '/b/' + bounty.id;
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

// ── Detail ──
async function renderDetail(id) {
  app.innerHTML = '';
  app.innerHTML += `<div class="empty">Loading…</div>`;
  let b;
  try {
    ({ bounty: b } = await api('/bounties/' + id));
  } catch (e) {
    app.innerHTML = `<span class="back" onclick="location.hash='/'">← Home</span><div class="empty">That bounty doesn't seem to exist anymore.</div>`;
    return;
  }

  const myPledge = b.pledges.find(p => p.pledger_pubkey === ME);
  const isWorker = b.worker_pubkey === ME;
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;
  const c = CATS[b.category] || CATS.other;

  let html = `<span class="back" onclick="location.hash='/'">← All needs</span>`;
  html += `<div style="margin-top:14px"><span class="cat ${c.cls}">${c.icon} ${c.label}</span></div>`;
  html += `<h1 style="margin-top:8px;font-size:26px">${esc(b.title)}</h1>`;
  html += `<div class="card" style="margin-top:12px"><div class="desc" style="margin:0;color:var(--ink);font-size:15px">${esc(b.description)}</div></div>`;

  // Pot & pledges
  html += `<div class="card">`;
  html += `<div class="row"><div class="pot"><span class="amount">${fmtNum(b.pot_sats)}</span> sats pledged</div><span class="status ${b.status}">${STATUS_WORDS[b.status] || b.status}</span></div>`;
  if (b.effective_pot_sats !== b.pot_sats) html += `<div class="eff" style="margin-top:4px">~${fmtNum(b.effective_pot_sats)} after trust weighting</div>`;
  if (b.threshold_sats > 0) html += `<div class="bar" style="margin-top:10px"><span style="width:${pct}%"></span></div><div style="font-size:12px;color:var(--ink-faint)">${pct}% of ${fmtSats(b.threshold_sats)} needed</div>`;

  if (b.pledges.length) {
    html += `<div class="pledge-list">`;
    for (const p of b.pledges) {
      const paid = p.status === 'paid';
      html += `<div class="pledge-row"><span><span class="${paid?'paid':''}">${paid?'Paid':'Pledged'}</span> <span class="id">${short(p.pledger_pubkey)}</span></span><span>${fmtSats(p.amount_sats)}</span></div>`;
    }
    html += `</div>`;
  } else {
    html += `<div style="margin-top:10px;font-size:13px;color:var(--ink-faint)">No pledges yet. You could be the first.</div>`;
  }
  html += `</div>`;

  // Actions, state-dependent
  if (b.status === 'open') {
    html += `<div class="card" style="border-color:rgba(184,104,46,.2)">`;
    html += `<label>Pledge sats</label>`;
    html += `<input id="p-amt" type="number" inputmode="numeric" placeholder="e.g. 5000" ${myPledge ? `value="${myPledge.amount_sats}"` : ''}/>`;
    html += `<button id="b-pledge" style="margin-top:10px">${myPledge ? 'Update my pledge' : 'Pledge'}</button>`;
    html += `</div>`;
    if (!isWorker && !myPledge) {
      html += `<button class="ghost" id="b-claim">
        ${b.pot_sats >= b.threshold_sats ? "🙋 I'll do this" : `Need ${fmtSats(Math.max(0, b.threshold_sats - b.pot_sats))} more to claim`}
      </button>`;
    }
  } else if (b.status === 'claimed') {
    if (isWorker) {
      html += `<div class="card" style="border-color:rgba(74,124,89,.25)">`;
      html += `<div class="banner ok">You claimed this on ${new Date(b.claimed_at*1000).toLocaleDateString()}. Show them what you did.</div>`;
      html += `<label>Photo of the finished work</label>`;
      html += `<input id="p-img" type="file" accept="image/*"/>`;
      html += `<label>A quick note (optional)</label>`;
      html += `<textarea id="p-note" placeholder="What did you do? Any details worth sharing?"></textarea>`;
      html += `<label>Your Lightning invoice</label>`;
      html += `<input id="p-inv" placeholder="lnbc1p... (your wallet will make this for you)"/>`;
      html += `<button id="b-proof" style="margin-top:10px">I'm done — submit proof</button>`;
      html += `</div>`;
    } else {
      html += `<div class="banner">${short(b.worker_pubkey)} is on it. Waiting for their proof of work.</div>`;
    }
  } else if (b.status === 'proof_submitted') {
    if (b.proof_image || b.proof_note) {
      html += `<div class="card">`;
      html += `<div style="font-weight:700;font-family:Georgia,serif;font-size:16px;margin-bottom:8px">Proof of work</div>`;
      if (b.proof_note) html += `<div class="desc" style="margin:0 0 10px">${esc(b.proof_note)}</div>`;
      if (b.proof_image) html += `<img src="${b.proof_image}" style="width:100%;border-radius:10px;display:block;border:1px solid rgba(158,148,138,.15)" alt="proof"/>`;
      html += `</div>`;
    }
    if (myPledge && myPledge.status === 'pledged') {
      html += `<div class="card" style="background:var(--moss-bg);border-color:rgba(74,124,89,.15)">`;
      html += `<div style="font-weight:700;color:var(--moss);margin-bottom:8px">Ready to pay?</div>`;
      html += `<div style="font-size:14px;color:var(--ink-light);margin-bottom:12px">You pledged ${fmtSats(myPledge.amount_sats)}. The work is done — honour it and your trust score grows.</div>`;
      html += `<div class="split"><button id="b-pay">✅ Pay ${fmtSats(myPledge.amount_sats)}</button><button class="ghost" id="b-flag">🚩 Flag as bad</button></div>`;
      html += `</div>`;
    } else if (myPledge && myPledge.status === 'paid') {
      html += `<div class="banner ok">You already paid your pledge. You're building this place.</div>`;
    }
    if (b.creator_pubkey === ME) {
      html += `<button class="ghost" id="b-settle" style="margin-top:4px">Close this bounty (mark unpaid pledges as reneged)</button>`;
    }
  } else {
    html += `<div class="banner">This one is ${STATUS_WORDS[b.status] || b.status}.</div>`;
  }

  app.innerHTML = html;

  // Wire handlers
  click('b-pledge', async () => {
    const amt = parseInt($('p-amt').value);
    if (!amt || amt < 1) return toast('Enter a real amount', true);
    const sig = await signAction(`I pledge ${amt} sats to: ${b.title}`, [['t','m2s-pledge'],['e',b.id]]);
    await api(`/bounties/${id}/pledge`, { method:'POST', body:{pledger_pubkey:ME, display_name:MENAME, amount_sats:amt, ...sig}});
    toast('Pledged. Thank you for backing your neighbour.'); renderDetail(id);
  });
  click('b-claim', async () => {
    const sig = await signAction(`I claim the task: ${b.title}`, [['t','m2s-claim'],['e',b.id]]);
    await api(`/bounties/${id}/claim`, { method:'POST', body:{worker_pubkey:ME, display_name:MENAME, ...sig}});
    toast("Claimed. Go make it happen. 💪"); renderDetail(id);
  });
  click('b-proof', async () => {
    const file = $('p-img').files[0];
    let image_base64 = null, mime = null;
    if (file) { image_base64 = await fileToB64(file); mime = file.type; }
    await api(`/bounties/${id}/proof`, { method:'POST', body:{image_base64, mime, proof_note:$('p-note').value.trim(), worker_invoice:$('p-inv').value.trim()}});
    toast("Proof submitted. Pledgers, it's your turn ⚡"); renderDetail(id);
  });
  click('b-pay', async () => {
    try {
      if (!b.worker_invoice) return toast("The worker hasn't shared an invoice yet. Check back.", true);
      const preimage = await payInvoice(b.worker_invoice);
      await api(`/pledges/${myPledge.id}/pay`, { method:'POST', body:{preimage}});
      toast('Paid. Your word is your bond.'); renderDetail(id);
    } catch (e) { toast(e.message, true); }
  });
  click('b-flag', async () => {
    await api(`/bounties/${id}/flag`, { method:'POST', body:{flagger_pubkey:ME, target_pubkey:b.worker_pubkey, reason:'bad work'}});
    toast('Flagged. Community keeps score.'); renderDetail(id);
  });
  click('b-settle', async () => {
    await api(`/bounties/${id}/settle`, { method:'POST', body:{}});
    toast('Settled. Anyone who skipped out got noted.'); renderDetail(id);
  });
}

function click(id, fn) {
  const el = $(id); if (!el) return;
  el.onclick = async () => {
    el.disabled = true;
    try { await fn(); }
    catch (e) { toast(e.message, true); }
    if ($(id)) el.disabled = false;
  };
}

function fileToB64(file) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});
}

// ── Leaderboard ──
async function renderLeaderboard() {
  app.innerHTML = '';
  app.innerHTML += `<span class="back" onclick="location.hash='/'">← Home</span>`;
  app.innerHTML += `<h1 style="margin-top:14px">Community heroes</h1><p class="desc" style="margin-top:4px">The people who show up — and the people who pay up.</p>`;
  try {
    const lb = await api('/leaderboards');
    const card = document.createElement('div'); card.className = 'card';
    let html = `<div style="font-family:Georgia,serif;font-weight:700;font-size:17px;margin-bottom:10px">💪 Hardest workers</div>`;
    if (!lb.topWorkers.length) html += `<div style="font-size:14px;color:var(--ink-faint);padding:12px 0">Nobody's finished a job yet. Could be you.</div>`;
    else html += lb.topWorkers.map((w,i) => `<div class="lb-row"><span><b>#${i+1}</b> <span class="id">${short(w.pubkey)}</span></span><span style="font-weight:700;color:var(--moss)">${w.jobs} done</span></div>`).join('');
    html += `<div style="border-top:1px solid rgba(158,148,138,.12);margin:16px 0 10px"></div>`;
    html += `<div style="font-family:Georgia,serif;font-weight:700;font-size:17px;margin-bottom:10px">🤝 Most generous funders</div>`;
    if (!lb.topFunders.length) html += `<div style="font-size:14px;color:var(--ink-faint);padding:12px 0">No payments recorded yet. You could start the trend.</div>`;
    else html += lb.topFunders.map((f,i) => `<div class="lb-row"><span><b>#${i+1}</b> <span class="id">${short(f.pubkey)}</span></span><span style="font-weight:700;color:var(--clay)">${fmtSats(f.sats)}</span></div>`).join('');
    card.innerHTML = html;
    app.appendChild(card);
  } catch (e) { toast(e.message, true); }
}

// ── Boot ──
(async function init() {
  try {
    ME = await getPubkey();
    MENAME = await getDisplayName();
    const { trust } = await api('/users/' + ME);
    const tc = trustClass(trust.pledger.badge);
    meEl.innerHTML = `<div style="font-weight:700;font-size:13px">${MENAME || short(ME)}</div><div class="my-id">${short(ME)}</div><div class="trust ${tc}" style="margin-top:2px">${trustLabel(trust.pledger)}</div>`;
  } catch {
    meEl.innerHTML = `<div style="font-size:13px;color:var(--ink-faint)">guest</div>`;
  }
  if (!inFedi()) {
    const w = document.querySelector('.wrap');
    const ban = document.createElement('div');
    ban.className = 'dev-banner';
    ban.innerHTML = '🧪 This is dev mode — open in the Fedi app for real Lightning payments and Nostr identity.';
    w.prepend(ban);
  }
  route();
})();
