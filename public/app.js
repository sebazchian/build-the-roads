import { getPubkey, getDisplayName, signAction, makeInvoice, payInvoice, inFedi } from './fedi.js';

const $ = (id) => document.getElementById(id);
const app = (() => {
  const el = document.getElementById('app');
  return {
    clear: () => { el.innerHTML = ''; return el; },
    append: (n) => { el.appendChild(n); return el; },
    set: (html) => { el.innerHTML = html; return el; },
    el: () => el,
  };
})();

let ME = null, MENAME = null, ME_TRUST = null;
let COMMUNITY = null;

/* ── Community ──────────────────────────────────────────────────────── */
let ALL_COMMUNITIES = [];

function resolveCommunity() {
  const url = new URLSearchParams(location.search).get('community');
  const ls = localStorage.getItem('m2s_community');
  COMMUNITY = url || ls || null;
}
function saveCommunity(id) {
  COMMUNITY = id;
  localStorage.setItem('m2s_community', id);
}
function communityLabel(id) {
  if (!id) return 'No community';
  const p = ALL_COMMUNITIES.find(c => c.id === id);
  return p ? p.name : id.charAt(0).toUpperCase() + id.slice(1);
}
function communityParam() {
  return '?community=' + encodeURIComponent(COMMUNITY || 'default');
}
async function loadCommunities() {
  try {
    ALL_COMMUNITIES = (await api('/communities')).communities || [];
  } catch { ALL_COMMUNITIES = []; }
}

/* ── URL routing ── */
function setURLCommunity(id) {
  const url = new URL(location.href);
  url.searchParams.set('community', id);
  history.replaceState(null, '', url.toString());
}

/* ── API ────────────────────────────────────────────────────────────── */
const api = async (path, opts = {}) => {
  const q = path.includes('?') ? '&' : '?';
  const r = await fetch('/api' + path + q + 'community=' + encodeURIComponent(COMMUNITY || 'default'), {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
};

/* ── Utils ──────────────────────────────────────────────────────────── */
const fmtSats = (n) => n ? n.toLocaleString() + ' sats' : '0 sats';
const fmtNum = (n) => n ? n.toLocaleString() : '0';
const short = (pk) => pk ? pk.slice(0, 5) + '…' + pk.slice(-4) : '—';
const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const $m = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; if (html != null) e.innerHTML = html; return e; };
const $t = (txt) => document.createTextNode(txt);

function toast(msg, err=false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function trustClass(badge) {
  if (badge==='Reliable'||badge==='Trusted') return 'good';
  if (badge==='Mixed') return 'warn';
  if (badge==='Flaky'||badge==='Unreliable') return 'bad';
  return '';
}
function trustLabel(t) {
  if (t.fulfillment_rate !== null) return `${t.fulfillment_rate}% · ${t.badge}`;
  return t.badge || '';
}

/* ── SVG logo ── */
function svgLogo(cls='') {
  return `<svg class="${cls}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="46" fill="#FF8D1A"/>
    <path d="M52 28c-2.2 0-4.3.5-6.2 1.5l1 3.3c1.5-.7 3.2-1.1 5-1.1 5.6 0 10.2 4.3 10.2 9.6 0 3.6-2.2 6.7-5.4 8.3l1.2 4c4.4-2.3 7.4-6.9 7.4-12.2 0-7.6-6.4-13.8-14.2-13.8zm-4 6.8l-6.8 24.8 3.2.9 4.6-16.8 2.8.8-4.6 16.8 3.2.9 6.8-24.8-9.2-2.6zM38 40l-2 7.2c-1-.5-2-.8-3.2-.8-4.2 0-7.6 3.2-7.6 7 0 3.4 2.8 6.2 6.4 6.8l-.7 2.5c-5.2-1-9-5.4-9-10.6 0-6 5.2-10.9 11.6-10.9 1.5 0 2.9.3 4.2.8H38z" fill="#fff"/>
  </svg>`;
}

/* ── Category data ── */
const CATS = {
  cleanup: { label:'Cleanup', icon:'🧹', cls:'cleanup' },
  painting:{ label:'Painting', icon:'🎨', cls:'painting' },
  repair:  { label:'Repair', icon:'🔧', cls:'repair' },
  other:   { label:'Other', icon:'📝', cls:'other' }
};
const STATUS_WORDS = {
  open:'Open', claimed:'Claimed', proof_submitted:'Waiting on payments',
  settled:'Done & paid', cancelled:'Cancelled', expired:'Expired'
};

/* ================================================================
   Router
   ================================================================ */
function route() {
  // if no community set, force picker
  if (!COMMUNITY) { renderCommunityPicker(); return; }
  const h = location.hash.slice(1) || '/';
  if (h === '/') return renderHome('open');
  if (h === '/open') return renderHome('open');
  if (h === '/all') return renderHome(null);
  if (h === '/new') return renderNew();
  if (h === '/leaderboard') return renderLeaderboard();
  const m = h.match(/^\/b\/([0-9a-f-]{36})$/);
  if (m) return renderDetail(m[1]);
  renderHome('open');
}
window.addEventListener('hashchange', route);

/* ================================================================
   Views
   ================================================================ */
function renderHeader() {
  const header = document.querySelector('header .inner');
  header.innerHTML = '';
  const left = $m('a', 'logo');
  left.href = '#/'; left.onclick = (e) => { if (e.button===0) { location.hash='/'; return false; }};
  left.innerHTML = svgLogo() + '<div class=text><div class=big>my two sats</div><small>community bounty board</small></div>';
  header.appendChild(left);

  const right = $m('div','');
  if (inFedi()) {
    right.innerHTML = `
      <div class="me">
        <div class="name">${esc(MENAME || short(ME))}</div>
        <div class="id">${short(ME)}</div>
      </div>`;
  } else {
    // community badge header
    const badge = $m('div','community-badge'); badge.textContent = communityLabel(COMMUNITY);
    const change = $m('a',''); change.href='#'; change.textContent='change'; change.style='font-size:11px;margin-left:8px;color:var(--ink-ghost)';
    change.onclick = (e) => { e.preventDefault(); localStorage.removeItem('m2s_community'); COMMUNITY=null; const u=new URL(location.href); u.searchParams.delete('community'); history.replaceState(null,'',u.toString()); route(); };
    badge.appendChild(change);
    right.appendChild(badge);
  }
  header.appendChild(right);
}

function buildTabs(active) {
  const tabs = $m('div','tabs');
  const mk = (label, href, isActive) => {
    const a = $m('a','tab' + (isActive ? ' active' : ''));
    a.href = '#' + href; a.textContent = label;
    return a;
  };
  tabs.appendChild(mk('Open', '/open', active==='open'));
  tabs.appendChild(mk('All', '/all', active==='all'));
  tabs.appendChild(mk('🏆', '/leaderboard', active==='leaderboard'));
  return tabs;
}

function backLink(href, label) {
  return `<a class="ghost" style="display:inline-flex;gap:5px;align-items:center;margin-bottom:10px" href="#${href}">${label}</a>`;
}

function emptyState(lines) {
  const d = $m('div','empty');
  d.innerHTML = lines.map(l => `<div${l.bold ? ' style="font-weight:700;color:var(--ink)"' : ''}>${l.txt}</div>`).join('');
  return d;
}

/* ---- Home ---- */
async function renderHome(filterStatus) {
  app.clear();
  renderHeader();

  const intro = $m('div','intro');
  intro.innerHTML = `
    <h1>Your neighbour needs something done. You need a few sats.</h1>
    <p>This is where both of those things meet.</p>`;
  app.append(intro);

  app.append(buildTabs(filterStatus || 'open'));

  const loading = $m('div','empty'); loading.textContent = 'Loading…';
  app.append(loading);

  try {
    const { bounties } = await api('/bounties' + (filterStatus ? `?status=${filterStatus}` : ''));
    loading.remove();

    if (!bounties.length) {
      app.append(emptyState([
        { txt: 'Nothing here yet.', bold: true },
        { txt: 'Post the first request in your community.' }
      ]));
    } else {
      bounties.forEach(b => app.append(makeCard(b)));
    }
  } catch (e) {
    loading.remove();
    toast(e.message, true);
  }

  const fab = $m('button','fab'); fab.textContent = '+ Post a need';
  fab.onclick = () => { location.hash = '/new'; };
  app.append(fab);
}

function makeCard(b) {
  const el = $m('a','card click');
  el.href = `#/b/${b.id}`;
  el.dataset.id = b.id;
  const c = CATS[b.category] || CATS.other;
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;
  const hasEff = b.effective_pot_sats !== b.pot_sats;

  const statusWord = STATUS_WORDS[b.status] || b.status;
  const statusCls  = `status ${b.status}`;

  el.innerHTML = `
    <div class="row" style="margin-bottom:4px">
      <span class="cat ${c.cls}">${c.icon} ${c.label}</span>
      <span class="${statusCls}">${statusWord}</span>
    </div>
    <div class="bounty-title">${esc(b.title)}</div>
    <div class="desc">${esc(b.description)}</div>
    <div class="row" style="align-items:flex-end;margin-top:8px">
      <div class="pot">
        <span class="n">${fmtNum(b.pot_sats)}</span> <span class="u">sats pledged</span>
        ${hasEff ? `<br><span class="eff">~${fmtNum(b.effective_pot_sats)} trusted pot</span>` : ''}
      </div>
      ${b.pledges.length ? `<span class="subtext">${b.pledges.length} pledge${b.pledges.length!==1?'s':''}</span>` : ''}
    </div>
    ${b.threshold_sats>0 ? `<div class="bar"><span style="width:${pct}%"></span></div>
      <div class="subtext" style="margin-top:2px">${pct}% of ${fmtSats(b.threshold_sats)} needed</div>` : ''}`;
  return el;
}

/* ---- New ---- */
function renderNew() {
  app.clear(); renderHeader();
  const w = app.el();
  w.appendChild($m('div','',backLink('/open', '← Open needs')));

  const h = $m('h1',''); h.style='margin-top:10px'; h.textContent = 'What needs doing?';
  w.appendChild(h);
  const sub = $m('p','desc'); sub.textContent = "Describe the job like you're telling a friend.";
  w.appendChild(sub);

  const card = $m('div','card'); card.style='margin-top:14px';
  card.innerHTML = `
    <label>What is it?</label>
    <input id="f-title" placeholder="e.g. Clean up the lot behind the rec centre" maxlength="200" autocomplete="off" />
    <label>Tell the story</label>
    <textarea id="f-desc" placeholder="What's the situation? What does 'done' look like?"></textarea>
    <label>Category</label>
    <select id="f-cat">
      <option value="cleanup">🧹 Cleanup</option>
      <option value="painting">🎨 Painting</option>
      <option value="repair">🔧 Repair</option>
      <option value="other">📝 Something else</option>
    </select>
    <label>Minimum pot to get started (sats, optional)</label>
    <input id="f-thresh" type="number" inputmode="numeric" placeholder="0 = anyone can claim right away" />
    <button id="f-submit" style="margin-top:16px">Post it</button>`;
  w.appendChild(card);

  $('f-submit').onclick = async () => {
    const btn = $('f-submit'); btn.disabled = true;
    try {
      const body = {
        title: $('f-title').value.trim(), description: $('f-desc').value.trim(),
        category: $('f-cat').value, threshold_sats: parseInt($('f-thresh').value) || 0,
        creator_pubkey: ME, display_name: MENAME, community_id: COMMUNITY,
      };
      if (!body.title || !body.description) throw new Error('Need a title and a story.');
      const { bounty } = await api('/bounties', { method: 'POST', body });
      toast('Posted. Now watch the sats roll in.');
      location.hash = '/b/' + bounty.id;
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

/* ---- Detail ---- */
async function renderDetail(id) {
  app.clear(); renderHeader();
  const w = app.el();

  let b;
  try {
    ({ bounty: b } = await api('/bounties/' + id));
  } catch {
    w.innerHTML = backLink('/open', '← All needs') + '<div class="empty">That bounty doesn’t seem to exist in this community.</div>';
    return;
  }

  const myPledge = b.pledges.find(p => p.pledger_pubkey === ME);
  const isWorker = b.worker_pubkey === ME;
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;
  const c = CATS[b.category] || CATS.other;

  w.appendChild($m('div','',backLink('/open', '← All needs')));
  w.innerHTML += `<div style="margin-top:14px"><span class="cat ${c.cls}">${c.icon} ${c.label}</span></div>`;
  w.innerHTML += `<h1 style="margin-top:8px">${esc(b.title)}</h1>`;

  const descCard = $m('div','card');
  descCard.innerHTML = `<div class="desc" style="color:var(--ink);font-size:15px;margin:0">${esc(b.description)}</div>`;
  w.appendChild(descCard);

  const potCard = $m('div','card');
  let potHtml = `<div class="row"><div><div class="n">${fmtNum(b.pot_sats)}</div><div class="u">sats pledged</div></div><span class="status ${b.status}">${STATUS_WORDS[b.status]}</span></div>`;
  if (b.effective_pot_sats !== b.pot_sats) potHtml += `<div class="eff" style="margin-top:4px">~${fmtNum(b.effective_pot_sats)} after trust weighting</div>`;
  if (b.threshold_sats > 0) potHtml += `<div class="bar"><span style="width:${pct}%"></span></div><div class="subtext">${pct}% of ${fmtSats(b.threshold_sats)} needed</div>`;

  if (b.pledges.length) {
    potHtml += `<div class="pledge-list">`;
    for (const p of b.pledges) {
      const paid = p.status === 'paid';
      potHtml += `<div class="pledge-row"><span><span class="${paid?'paid':''}">${paid?'Paid':'Pledged'}</span> <span class="pk">${short(p.pledger_pubkey)}</span></span><span>${fmtSats(p.amount_sats)}</span></div>`;
    }
    potHtml += `</div>`;
  } else {
    potHtml += `<div style="margin-top:8px" class="subtext">No pledges yet. You could be the first.</div>`;
  }
  potCard.innerHTML = potHtml;
  w.appendChild(potCard);

  // Actions
  if (b.status === 'open') {
    const pledgeCard = $m('div','card'); pledgeCard.style='border-color:rgba(255,141,26,.25)';
    pledgeCard.innerHTML = `
      <label>Pledge sats</label>
      <input id="p-amt" type="number" inputmode="numeric" placeholder="e.g. 5000" ${myPledge ? `value="${myPledge.amount_sats}"` : ''} />
      <button id="b-pledge" style="margin-top:10px">${myPledge ? 'Update my pledge' : 'Pledge'}</button>`;
    w.appendChild(pledgeCard);

    if (!isWorker && !myPledge) {
      const cla = $m('button','ghost');
      cla.id = 'b-claim';
      cla.textContent = b.pot_sats >= b.threshold_sats ? "🙋 I'll do this" : `Need ${fmtSats(Math.max(0, b.threshold_sats - b.pot_sats))} more to claim`;
      w.appendChild(cla);
    }
  } else if (b.status === 'claimed') {
    if (isWorker) {
      const pCard = $m('div','card');
      pCard.innerHTML = `
        <div style="font-weight:700;margin-bottom:10px">You claimed this on ${new Date(b.claimed_at*1000).toLocaleDateString()}. Show them what you did.</div>
        <label>Photo of the finished work</label>
        <input id="p-img" type="file" accept="image/*" />
        <label>A quick note (optional)</label>
        <textarea id="p-note" placeholder="What did you do?"></textarea>
        <label>Your Lightning invoice</label>
        <input id="p-inv" placeholder="lnbc1p... (your wallet will make this)" />
        <button id="b-proof" style="margin-top:10px">I'm done — submit proof</button>`;
      w.appendChild(pCard);
    } else {
      w.appendChild($m('div','card', `<div style="font-size:14px;color:var(--ink-faint)">${short(b.worker_pubkey)} is on it. Waiting for proof.</div>`));
    }
  } else if (b.status === 'proof_submitted') {
    if (b.proof_image || b.proof_note) {
      const prCard = $m('div','card');
      let prHtml = `<div style="font-weight:700;font-size:16px;margin-bottom:8px">Proof of work</div>`;
      if (b.proof_note) prHtml += `<div class="desc" style="margin:0 0 10px">${esc(b.proof_note)}</div>`;
      if (b.proof_image) prHtml += `<img src="${b.proof_image}" style="width:100%;border-radius:12px;display:block;" alt="proof" />`;
      prCard.innerHTML = prHtml;
      w.appendChild(prCard);
    }
    if (myPledge && myPledge.status === 'pledged') {
      const payCard = $m('div','card');
      payCard.innerHTML = `
        <div style="font-weight:700;color:var(--moss);margin-bottom:8px">Ready to pay?</div>
        <div style="font-size:14px;color:var(--ink-faint);margin-bottom:12px">You pledged ${fmtSats(myPledge.amount_sats)}. The work is done — honour it and your trust score grows.</div>
        <div class="split"><button id="b-pay">Pay ${fmtSats(myPledge.amount_sats)}</button><button class="ghost" id="b-flag">Flag as bad</button></div>`;
      w.appendChild(payCard);
    } else if (myPledge && myPledge.status === 'paid') {
      w.appendChild($m('div','card', `<div style="font-size:14px;color:var(--ink-faint)">Paid. Your word is your bond.</div>`));
    }
    if (b.creator_pubkey === ME) {
      const settleBtn = $m('button','ghost');
      settleBtn.id='b-settle';
      settleBtn.style='margin-top:8px';
      settleBtn.textContent='Close bounty (mark unpaid pledges as reneged)';
      w.appendChild(settleBtn);
    }
  }

  // Wire
  wire('b-pledge', async () => {
    const amt = parseInt($('p-amt').value);
    if (!amt || amt<1) return toast('Enter a real amount',true);
    const sig = await signAction(`I pledge ${amt} sats to: ${b.title}`, [['t','m2s-pledge'],['e',b.id]]);
    await api(`/bounties/${id}/pledge`, { method:'POST', body:{
      pledger_pubkey:ME, display_name:MENAME, amount_sats:amt,
      community_id: COMMUNITY, ...sig } });
    toast('Pledged. Thank you for backing your neighbour.'); renderDetail(id);
  });

  wire('b-claim', async () => {
    const sig = await signAction(`I claim the task: ${b.title}`, [['t','m2s-claim'],['e',b.id]]);
    await api(`/bounties/${id}/claim`, { method:'POST', body:{
      worker_pubkey:ME, display_name:MENAME, community_id: COMMUNITY, ...sig } });
    toast('Claimed. Go make it happen.'); renderDetail(id);
  });

  wire('b-proof', async () => {
    const file = $('p-img').files[0];
    let image_base64 = null;
    if (file) { image_base64 = await fileToB64(file); }
    await api(`/bounties/${id}/proof`, { method:'POST', body:{
      image_base64, proof_note:$('p-note').value.trim(), worker_invoice:$('p-inv').value.trim(),
      community_id: COMMUNITY }});
    toast('Proof submitted. Pledgers, your turn.'); renderDetail(id);
  });

  wire('b-pay', async () => {
    try {
      if (!b.worker_invoice) return toast("Worker hasn't shared an invoice yet. Check back.", true);
      const preimage = await payInvoice(b.worker_invoice);
      await api(`/pledges/${myPledge.id}/pay`, { method:'POST', body:{preimage} });
      toast('Paid. Building trust.'); renderDetail(id);
    } catch(e){ toast(e.message,true); }
  });

  wire('b-flag', async () => {
    await api(`/bounties/${id}/flag`, { method:'POST', body:{flagger_pubkey:ME, target_pubkey:b.worker_pubkey, reason:'bad work'} });
    toast('Flagged. Community keeps score.'); renderDetail(id);
  });

  wire('b-settle', async () => {
    await api(`/bounties/${id}/settle`, { method:'POST', body:{community_id: COMMUNITY} });
    toast('Settled.'); renderDetail(id);
  });
}

function wire(id, fn) {
  const el = $(id); if (!el) return;
  el.onclick = async () => { el.disabled = true; try{ await fn(); } catch(e){ toast(e.message,true); } if ($(id)) el.disabled=false; };
}
function fileToB64(file) { return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }

/* ---- Leaderboard ---- */
async function renderLeaderboard() {
  app.clear(); renderHeader();
  const w = app.el();
  w.appendChild($m('div','',backLink('/open', '← Open needs')));
  w.innerHTML += `<h1 style="margin-top:14px">Community heroes</h1><p class="desc">The people who show up — and the people who pay up.</p>`;

  try {
    const lb = await api('/leaderboards');
    const card = $m('div','card');
    let html = `<div style="font-weight:700;font-size:16px;margin-bottom:10px">💪 Hardest workers</div>`;
    if (!lb.topWorkers.length) html += `<div class="subtext" style="padding:10px 0">No completed jobs yet. Could be you.</div>`;
    else html += lb.topWorkers.map((w,i) => `<div class="lb-row"><span><b>#${i+1}</b> <span class="pk">${short(w.pubkey)}</span></span><span style="font-weight:700;color:var(--moss)">${w.jobs} done</span></div>`).join('');
    html += `<div style="border-top:1px solid var(--border);margin:16px 0 10px"></div>`;
    html += `<div style="font-weight:700;font-size:16px;margin-bottom:10px">🤝 Most generous funders</div>`;
    if (!lb.topFunders.length) html += `<div class="subtext" style="padding:10px 0">No payments yet. Be the first.</div>`;
    else html += lb.topFunders.map((f,i) => `<div class="lb-row"><span><b>#${i+1}</b> <span class="pk">${short(f.pubkey)}</span></span><span style="font-weight:700;color:var(--accent)">${fmtSats(f.sats)}</span></div>`).join('');
    card.innerHTML = html;
    w.appendChild(card);
  } catch (e) { toast(e.message,true); }
}

/* ---- Community picker ---- */
async function renderCommunityPicker() {
  app.clear();
  await loadCommunities();
  const w = app.el();
  const card = $m('div','card');
  card.innerHTML = `
    <h1 style="margin-bottom:8px">Pick your community</h1>
    <p class="desc" style="margin-bottom:20px">Each community has its own bounties and leaderboard.</p>`;

  if (ALL_COMMUNITIES.length) {
    ALL_COMMUNITIES.forEach(c => {
      const b = $m('a','card click');
      b.href = '#';
      b.innerHTML = `<div style="font-weight:700">${esc(c.name)}</div><div class="subtext">${c.region || c.id}</div>`;
      b.onclick = (e) => { e.preventDefault(); saveCommunity(c.id); setURLCommunity(c.id); route(); };
      card.appendChild(b);
    });
  } else {
    card.innerHTML += `<div class="subtext" style="margin:10px 0">No communities yet. Start one.</div>`;
  }

  // Create form
  const create = $m('div','card'); create.style='margin-top:16px';
  create.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px">Start a new community</div>
    <label>URL-friendly ID (e.g. bitcoin-ekasi)</label>
    <input id="c-id" placeholder="mytown" maxlength="40" />
    <label>Community name</label>
    <input id="c-name" placeholder="Mytown Bitcoin Crew" maxlength="60" />
    <label>Description (optional)</label>
    <input id="c-desc" placeholder="What makes this community unique?" maxlength="200" />
    <button id="c-submit" style="margin-top:12px">Create community</button>`;
  card.appendChild(create);
  w.appendChild(card);

  $('c-submit').onclick = async () => {
    const btn = $('c-submit'); btn.disabled = true;
    try {
      const body = {
        id: $('c-id').value.trim().toLowerCase(),
        name: $('c-name').value.trim(),
        description: $('c-desc').value.trim() || null,
        admin_pubkey: ME,
        admin_display_name: MENAME,
      };
      if (!body.id || !body.name) throw new Error('Need an ID and a name.');
      const { community } = await api('/communities', { method: 'POST', body });
      saveCommunity(community.id);
      setURLCommunity(community.id);
      toast(`Community "${community.name}" created.`);
      route();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
}

/* ================================================================
   Boot
   ================================================================ */
(async function boot() {
  resolveCommunity();
  await loadCommunities();

  // If no community param and no localStorage, show picker
  const hadExplicit = new URLSearchParams(location.search).has('community') || localStorage.getItem('m2s_community');
  if (!hadExplicit || !COMMUNITY) { renderCommunityPicker(); return; }

  try {
    ME = await getPubkey();
    MENAME = await getDisplayName();
    const { trust } = await api('/users/' + ME);
    ME_TRUST = trust;
  } catch {
    // guest / dev mode
  }
  if (!inFedi()) {
    const ban = $m('div','dev-banner');
    ban.textContent = 'Dev mode — open in the Fedi app for real Lightning and Nostr identity.';
    app.el().parentNode.insertBefore(ban, app.el());
  }
  route();
})();
