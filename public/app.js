/* build the roads */
import { getPubkey, getDisplayName, signAction, makeInvoice, payInvoice, getLightningAddress, getLnurl, resolveInvoiceFromAddress, inFedi, hasWebLN, hasNostr, generateDevKey, copyToClipboard, postNote, LS_KEY } from './fedi.js';

/* ── State ── */
let ME=null, MENAME=null, COMMUNITY=null, ALL_COMMUNITIES=[], IS_ADMIN=false;
let ACTION_COUNT=0; // cached pending items for header/tab styling

/* ── DOM builders ── */
const $ = id => document.getElementById(id);
const el = tag => document.createElement(tag);

function h(tag, cls, ...kids) {
  const e = el(tag);
  if (cls) e.className = cls;
  kids.forEach(k => {
    if (k == null) return;
    if (typeof k === 'string') e.appendChild(document.createTextNode(k));
    else if (k instanceof Node) e.appendChild(k);
    else if (typeof k === 'object' && k.style) Object.assign(e.style, k.style);
  });
  return e;
}

const DIV = (cls, ...ch) => h('div', cls, ...ch);
const BTN = (cls, txt, on) => { const b = h('button', cls, txt); if (on) b.onclick = on; return b; };

/* ── Zap Component ─────────────────────────────────────────────────────── */
async function resolveLightningAddress(pubkey) {
  // 1. Check DB for stored address
  const { user } = await api('/users/' + pubkey);
  if (user?.lightning_address) return user.lightning_address;
  if (user?.lnurl) return user.lnurl;

  // 2. If it's ME, try to get from active wallet and save it
  if (pubkey === ME) {
    try {
      const addr = await getLightningAddress();
      if (addr) {
        await api('/users/' + pubkey + '/lightning-address', { method: 'POST', body: { lightning_address: addr } });
        return addr;
      }
    } catch (e) { /* wallet not available */ }
  }

  return null;
}

function zapButton(bounty, recipientPubkey, recipientType = 'creator') {
  const btn = BTN('btn btn-ghost btn-sm', '⚡ Zap', async () => {
    if (!ME) { toast('Sign in to zap', true); return; }
    if (!hasWebLN()) { toast('WebLN wallet required', true); return; }

    const amount = prompt('Amount in sats:', '1000');
    if (!amount) return;
    const amt = parseInt(amount);
    if (!amt || amt < 1) { toast('Invalid amount', true); return; }

    btn.disabled = true;
    btn.textContent = '⚡ Looking up address...';

    try {
      const lnaddr = await resolveLightningAddress(recipientPubkey);
      if (!lnaddr) {
        if (recipientPubkey === ME) {
          toast('Set your Lightning address in your Fedi profile first.', true);
        } else {
          toast('This user has not set a Lightning address yet.', true);
        }
        btn.disabled = false;
        btn.textContent = '⚡ Zap';
        return;
      }

      btn.textContent = '⚡ Sending...';

      const memo = `Zap for "${bounty.title}" on build the roads`;
      const preimage = await sendZap(lnaddr, amt, memo);

      await api('/zaps', {
        method: 'POST',
        body: {
          bounty_id: bounty.id,
          sender_pubkey: ME,
          recipient_pubkey: recipientPubkey,
          amount_sats: amt,
          memo,
          preimage,
          display_name: MENAME,
        }
      });

      toast(`⚡ Zap sent! ${amt} sats`);
      btn.textContent = '⚡ Zapped';
      setTimeout(() => { btn.disabled = false; btn.textContent = '⚡ Zap'; }, 3000);
    } catch (e) {
      toast(e.message || 'Zap failed', true);
      btn.disabled = false;
      btn.textContent = '⚡ Zap';
    }
  });
  return btn;
}

/* ── Helpers ── */
const esc = s => String(s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const short = pk => pk ? pk.slice(0, 5) + '...' + pk.slice(-4) : ' - ';
const fmt = n => (n || 0).toLocaleString();
const fmtS = n => fmt(n) + ' sats';
const fmtDate = ts => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const style = (e, kv) => { Object.entries(kv).forEach(([k, v]) => e.style[k] = v); return e; };

function toast(msg, err) {
  const t = h('div', 'toast' + (err ? ' err' : ''), msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ── Logo image (uses favicon.png) ── */
function makeBrandOrb() {
  const img = document.createElement('img');
  img.src = 'favicon.png?v=1';
  img.alt = 'build the roads';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'cover';
  img.style.borderRadius = '50%';
  return img;
}

/* ── Category config ── */
const CATEGORIES = [
  { id: 'cleanup',   label: '🧹 Cleanup',      cls: 'tag-cleanup' },
  { id: 'chores',    label: '🧺 Chores',       cls: 'tag-chores' },
  { id: 'painting',  label: '🎨 Painting',     cls: 'tag-paint' },
  { id: 'repair',    label: '🔧 Repair',       cls: 'tag-repair' },
  { id: 'build',     label: '🏗️ Build',        cls: 'tag-build' },
  { id: 'signage',   label: '🪧 Signage',      cls: 'tag-signage' },
  { id: 'plumbing',  label: '🚰 Plumbing',     cls: 'tag-plumbing' },
  { id: 'transport', label: '🚚 Transport',    cls: 'tag-transport' },
  { id: 'garden',    label: '🌱 Garden',       cls: 'tag-garden' },
  { id: 'security',  label: '🔒 Security',     cls: 'tag-security' },
  { id: 'teaching',  label: '📚 Teaching',     cls: 'tag-teaching' },
  { id: 'event',     label: '🎪 Event',        cls: 'tag-event' },
  { id: 'other',     label: '📝 Other',        cls: 'tag-other' },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

const api = async (path, opts = {}) => {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch('/api' + path + sep + 'community=' + encodeURIComponent(COMMUNITY || 'default'), {
    headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
};

async function refreshActionCount() {
  if (!ME) { ACTION_COUNT = 0; return; }
  try {
    const { toClaim, toPay, toReview } = await api('/pending?pubkey=' + encodeURIComponent(ME));
    ACTION_COUNT = (toClaim?.length || 0) + (toPay?.length || 0) + (toReview?.length || 0);
  } catch (e) { ACTION_COUNT = 0; }
}

/* ── Community ── */
function resolveCommunity() {
  COMMUNITY = new URLSearchParams(location.search).get('community')
           || localStorage.getItem('m2s_community')
           || null;
}
function setCommunity(id) {
  if (COMMUNITY && !id) localStorage.setItem('m2s_prev_community', COMMUNITY);
  COMMUNITY = id;
  if (id) localStorage.setItem('m2s_community', id);
  else localStorage.removeItem('m2s_community');
  const u = new URL(location.href);
  if (id) u.searchParams.set('community', id); else u.searchParams.delete('community');
  history.replaceState(null, '', u.toString());
}
async function loadCommunities() {
  try { ALL_COMMUNITIES = (await api('/communities')).communities || []; }
  catch { ALL_COMMUNITIES = []; }
}
function cName(id) {
  const c = ALL_COMMUNITIES.find(x => x.id === id);
  return c ? c.name : (id ? id.charAt(0).toUpperCase() + id.slice(1) : ' - ');
}

/* ── Router ── */
function go(path) { history.pushState(null, '', path); route(); }
window.addEventListener('popstate', () => route());

async function route() {
  const app = $('app');
  app.innerHTML = '';
  const h = location.pathname || '/';
  resolveCommunity();
  if (h === '/philosophy') { renderPhilosophy(); return; }
  if (!COMMUNITY) { renderPicker(); return; }
  if (!ME) { renderSignIn(); return; }
  // Resolve admin status for this community/user
  IS_ADMIN = await api(`/communities/${COMMUNITY}/is-admin?pubkey=${ME}`).then(r => r.is_admin).catch(() => false);
  await refreshActionCount(); // wait for count so header highlights correctly
  if (h === '/' || h === '/open') renderHome('open');
  else if (h === '/all') renderHome(null);
  else if (h === '/new') renderNew();
  else if (h === '/leaderboard') renderLeaderboard();
  else if (h === '/manage') renderManagePage();
  else if (h === '/how') renderHow();
  else if (h === '/philosophy') renderPhilosophy();
  else if (h === '/pending') renderPending();
  else if (h.startsWith('/b/')) renderDetail(h.slice(3));
  else renderHome('open');
}

/* ── Header ── */
function renderHeader() {
  const hd = $('header-inner');
  hd.innerHTML = '';

  const orb = h('span', 'orb');
  orb.appendChild(makeBrandOrb());
  const brand = h('a', 'brand', orb, DIV('word', h('div', 'name', 'build the roads'), h('div', 'tag', 'community bounty board')));
  brand.href = '/';
  brand.onclick = e => { if (e.button === 0) { go('/'); return false; }};
  hd.appendChild(brand);

  const right = DIV('header-right');

  // Subtle note for non-Fedi users without WebLN/Nostr extensions
  if (!inFedi() && !window.webln && !window.nostr) {
    const note = h('span', '');
    note.style.fontSize = '10px';
    note.style.color = 'var(--ink-dim)';
    note.style.opacity = '0.55';
    note.style.marginRight = '8px';
    note.textContent = 'best in Fedi app';
    right.appendChild(note);
  }

  const actions = DIV('header-actions');
  if (COMMUNITY) {
    const badge = DIV('badge', cName(COMMUNITY));
    const change = BTN('badge-change', 'change', () => { setCommunity(null); route(); });
    badge.appendChild(change);
    actions.appendChild(badge);
  }
  if (ME) {
    const pendingBtn = BTN('btn btn-ghost btn-sm' + (ACTION_COUNT > 0 ? ' action-alert' : ''), 'To-do', () => go('/pending'));
    actions.appendChild(pendingBtn);
    if (IS_ADMIN) {
      const manageBtn = BTN('btn btn-ghost btn-sm', 'Manage', () => go('/manage'));
      actions.appendChild(manageBtn);
    }
  }
  right.appendChild(actions);

  const meta = DIV('header-meta');
  if (ME) {
    meta.appendChild(h('div', 'up', esc(MENAME || short(ME))));
    meta.appendChild(h('div', 'down', short(ME)));
  }
  right.appendChild(meta);

  hd.appendChild(right);
}

/* ── Shared components ── */
function makeTabs(active) {
  const wrap = DIV('pill-tabs');
  const mk = (label, href, on) => {
    const isPending = label === 'To-do';
    const extraCls = (isPending && ACTION_COUNT > 0 && !on) ? ' action-alert' : '';
    const b = BTN((on ? 'on' : '') + extraCls, label, () => go(href));
    return b;
  };
  wrap.appendChild(mk('Open', '/open', active === 'open'));
  wrap.appendChild(mk('All', '/all', active === 'all'));
  wrap.appendChild(mk('To-do', '/pending', active === 'pending'));
  wrap.appendChild(mk('🏆', '/leaderboard', active === 'leaderboard'));
  wrap.appendChild(mk('How?', '/how', active === 'how'));
  wrap.appendChild(mk('Why?', '/philosophy', active === 'philosophy'));
  return wrap;
}

function backLink(href, text) {
  return BTN('btn btn-ghost btn-sm', '← ' + text, () => go(href));
}

function emptyState(title, body, art) {
  const e = DIV('empty');
  e.appendChild(DIV('empty-art', art || '🛠️'));
  e.appendChild(h('b', '', title));
  e.appendChild(body);
  return e;
}

function trustBadge(t) {
  if (!t) return null;
  const badge = t.pledger?.badge || t.worker?.badge || 'New';
  const cls = 'trust trust-' + badge.toLowerCase();
  const rate = t.pledger?.fulfillment_rate;
  const text = rate != null ? `${badge} · ${rate}% pays` : badge;
  return h('span', cls, text);
}

async function loadTrust(pubkey) {
  try { const { trust } = await api('/users/' + pubkey); return trust; }
  catch { return null; }
}


function hint(text) {
  return h('div', 'hint', h('b', '', 'How it works: '), text);
}

function howItWorks() {
  return DIV('card help',
    h('div', 'help-title', '🤝 How it works'),
    h('div', 'help-step', h('span', 'num', '1'), h('div', '', h('b', '', 'Someone posts a need.'), ' Paint the hall. Fix the gate. Clean the lot.')),
    h('div', 'help-step', h('span', 'num', '2'), h('div', '', h('b', '', 'Neighbors chip in sats.'), ' Pledge a small amount. If the work gets done, you pay.')),
    h('div', 'help-step', h('span', 'num', '3'), h('div', '', h('b', '', 'A worker claims it.'), ' They do the job and send proof.')),
    h('div', 'help-step', h('span', 'num', '4'), h('div', '', h('b', '', 'Pledgers pay up.'), ' Everyone who promised sends sats to the worker.')),
    h('div', 'help-foot', 'No upfront escrow. You hold your own money until the work is done. If someone does not pay, the community remembers.')
  );
}


/* ================================================================
   HOME
   ================================================================ */
async function renderHome(filter) {
  const wrap = $('app');
  renderHeader();

  const stack = DIV('stack');
  stack.appendChild(makeTabs(filter === 'open' ? 'open' : 'all'));
  wrap.appendChild(stack);

  // Auto-register as community member on visit (silent, best-effort)
  if (ME && COMMUNITY) {
    api('/communities/' + COMMUNITY + '/join', { method: 'POST', body: { pubkey: ME, display_name: MENAME } }).catch(() => {});
  }

  
  let list;
  try {
    const qs = filter ? `?status=${filter}` : '';
    const { bounties } = await api('/bounties' + qs);
    list = DIV('stack');
    if (!bounties.length) {
      if (filter === 'open') {
        list.appendChild(emptyState('All quiet.', 'Nothing open right now. Check All for finished jobs, or post the first need.', '🌤'));
      } else {
        list.appendChild(emptyState('All quiet.', 'Post the first need and get it done.', '🛠️'));
      }
    } else {
      bounties.forEach(b => list.appendChild(bountyCard(b)));
    }
  } catch (e) {
    list = DIV('stack'); list.appendChild(emptyState('Could not load.', e.message));
  }
  wrap.appendChild(list);

  if (IS_ADMIN) {
    const fab = BTN('fab', '+ Post a need', () => go('/new'));
    wrap.appendChild(fab);
  }
  
}

function bountyCard(b) {
  const cat = CAT_MAP[b.category] || CAT_MAP.other;
  const now = Math.floor(Date.now() / 1000);

  const card = DIV('card card-interactive');
  card.onclick = () => go('/b/' + b.id);

  card.appendChild(DIV('b-row',
    h('span', 'tag ' + cat.cls, esc(cat.label)),
    h('span', 'tag-status tag-' + b.status, esc({ open: 'Open', claimed: 'Claimed', proof_submitted: 'Proof sent', settled: 'Done', cancelled: 'Cancelled', expired: 'Expired' }[b.status] || b.status))
  ));
  card.appendChild(h('div', 'b-title', esc(b.title)));
  card.appendChild(h('div', 'b-desc', esc(b.description)));

  const nums = DIV('b-row',
    DIV('l', h('span', 'b-nums', h('span', 'big', fmt(b.pot_sats)), ' sats pledged')),
    h('span', 'b-nums', b.pledges.length + ' pledge' + (b.pledges.length !== 1 ? 's' : ''))
  );
  card.appendChild(nums);

  if (b.expires_at) {
    const daysLeft = Math.ceil((b.expires_at - now) / 86400);
    const expiryText = b.expires_at < now ? 'Expired ' + Math.abs(daysLeft) + 'd ago' : daysLeft <= 0 ? 'Due today' : daysLeft + 'd left';
    card.appendChild(h('div', 'hint', expiryText));
  }

  return card;
}

/* ================================================================
   NEW BOUNTY
   ================================================================ */
function renderNew() {
  const w = $('app');
  renderHeader();

  const stack = DIV('stack');
  stack.appendChild(makeTabs(null));
  stack.appendChild(DIV('', h('h1', 't1', 'What needs doing?'), h('p', 'body', 'Tell the street what needs doing.')));
  w.appendChild(stack);

  w.appendChild(howItWorks());

  if (!IS_ADMIN) {
    const gate = DIV('card');
    gate.appendChild(h('div', 'overline', 'Admins only'));
    gate.appendChild(h('div', 'hint', 'Only admins can post jobs.'));
    gate.appendChild(DIV('gap-2', backLink('/', 'Back to jobs')));
    w.appendChild(gate);
    return;
  }

  const card = DIV('card');

  const fTitle = h('input', ''); fTitle.placeholder = 'e.g. Clean up the lot behind the rec centre'; fTitle.maxLength = 200;
  card.appendChild(h('label', 'field-label', 'What is it?')); card.appendChild(fTitle);

  const fDesc = h('textarea', ''); fDesc.placeholder = "What's the situation? What does 'done' look like?";
  card.appendChild(h('label', 'field-label', 'Tell the story')); card.appendChild(fDesc);

  const fCat = h('select', '');
  CATEGORIES.forEach(c => {
    const o = el('option'); o.value = c.id; o.textContent = c.label; fCat.appendChild(o);
  });
  card.appendChild(h('label', 'field-label', 'Category')); card.appendChild(fCat);

  const fExpiry = h('select', '');
  const EXPIRY_PRESETS = [
    { d: 1, label: '1 day' },
    { d: 3, label: '3 days' },
    { d: 7, label: '1 week' },
    { d: 14, label: '2 weeks' },
    { d: 30, label: '30 days' },
  ];
  EXPIRY_PRESETS.forEach(c => { const o = el('option'); o.value = c.d; o.textContent = c.label; fExpiry.appendChild(o); });
  fExpiry.value = '7';
  card.appendChild(h('label', 'field-label', 'How long is it open?')); card.appendChild(fExpiry);

  const submit = BTN('btn', 'Post it', async () => {
    submit.disabled = true;
    try {
      const body = {
        title: fTitle.value.trim(), description: fDesc.value.trim(),
        category: fCat.value,
        creator_pubkey: ME, display_name: MENAME, community_id: COMMUNITY,
        expires_at: Math.floor(Date.now() / 1000) + parseInt(fExpiry.value || 7) * 86400,
      };
      if (!body.title || !body.description) throw new Error('Need a title and story.');
      const { bounty } = await api('/bounties', { method: 'POST', body });
      toast('Posted.');
      // Notify community via Nostr
      await postNote(`New job posted in ${COMMUNITY}: "${body.title}" — build the roads`, [['r', `/b/${bounty.id}`]]);
      go('/b/' + bounty.id);
    } catch (e) { toast(e.message, true); submit.disabled = false; }
  });
  card.appendChild(DIV('gap-2', submit));
  w.appendChild(card);
}

/* ================================================================
   DETAIL
   ================================================================ */
async function renderDetail(id) {
  try {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(makeTabs(null));
  w.appendChild(lead);

  let b;
  try { ({ bounty: b } = await api('/bounties/' + id)); }
  catch { w.appendChild(emptyState('Not found', "That bounty doesn't exist in this community.")); return; }

  // Defensive: ensure arrays exist
  b.pledges = b.pledges || [];
  b.flags = b.flags || [];

  const myPledge = (b.pledges || []).find(p => p.pledger_pubkey === ME);
  const isWorker = b.worker_pubkey === ME;

  const cat = CAT_MAP[b.category] || CAT_MAP.other;

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  // Worker trust + flags (shown on all bounties where worker exists)
  if (b.worker_pubkey) {
    const isFlagged = (b.flags || []).length > 0;
    const flagCount = isFlagged ? b.flags.length : 0;
    const workerCard = DIV('card');
    const wTrust = await loadTrust(b.worker_pubkey);
    workerCard.appendChild(DIV('b-row',
      h('span', '', 'Worker: ' + short(b.worker_pubkey)),
      trustBadge(wTrust)
    ));
    if (flagCount > 0) {
      workerCard.appendChild(h('div', 'hint', '\u26A0\uFE0F ' + flagCount + ' flag' + (flagCount !== 1 ? 's' : '') + ' from pledgers'));
    }
    bodyStack.appendChild(workerCard);
  }

  // Zap button for completed jobs — goes to the worker, not creator
  if (b.status === 'settled' && b.worker_pubkey) {
    const zapCard = DIV('card card-action');
    zapCard.appendChild(h('div', 'overline', '⚡ Tip the worker'));
    zapCard.appendChild(hint('This job is done. Send a thank-you zap to the worker directly.'));
    zapCard.appendChild(zapButton(b, b.worker_pubkey, 'worker'));
    bodyStack.appendChild(zapCard);
  }

  // title block
  const titleBlock = DIV('stack-sm padded');
  titleBlock.appendChild(h('span', 'tag ' + cat.cls, esc(cat.label)));
  titleBlock.appendChild(h('h1', 't2', esc(b.title)));
  titleBlock.appendChild(h('div', 'hint', `Posted by ${esc(short(b.creator_pubkey))}${b.expires_at ? ' \u00b7 open till ' + fmtDate(b.expires_at) : ''}`));
  if (IS_ADMIN) {
    titleBlock.appendChild(h('span', 'trust trust-reliable', '\u2605 You are an admin'));
  }
  
  // Zap button for creator (only on finished jobs)
  if (ME && b.creator_pubkey !== ME && b.status === 'settled') {
    titleBlock.appendChild(zapButton(b, b.creator_pubkey, 'creator'));
  }
  
  bodyStack.appendChild(titleBlock);

  // description
  bodyStack.appendChild(DIV('card', h('div', '', esc(b.description))));

  // ADMIN: Applications management
  if (b.status === 'open' && IS_ADMIN) {
    const apps = b.applications || [];
    const pending = apps.filter(a => a.status === 'pending');
    const appsCard = DIV('card');
    appsCard.appendChild(h('div', 'overline', '\ud83d\udcdd Applications'));
    if (!pending.length) {
      appsCard.appendChild(h('div', 'hint', 'No pending applications yet.'));
    } else {
      pending.forEach(a => {
        const row = DIV('pl-row');
        row.appendChild(DIV('pl-who', h('span', 'pl-addr', short(a.applicant_pubkey)), a.display_name ? h('span', 'hint', esc(a.display_name)) : null));
        const btns = DIV('gap-1-row');
        const approveBtn = BTN('btn btn-sm', 'Approve', async () => {
          approveBtn.disabled = true; approveBtn.textContent = 'Approving...';
          try {
            await api(`/applications/${a.id}/approve`, { method: 'POST', body: { admin_pubkey: ME } });
            toast('Approved.'); renderDetail(id);
          } catch (e) { toast(e.message, true); approveBtn.disabled = false; approveBtn.textContent = 'Approve'; }
        });
        const rejectBtn = BTN('btn btn-ghost btn-sm', 'Reject', async () => {
          rejectBtn.disabled = true; rejectBtn.textContent = 'Rejecting...';
          try {
            await api(`/applications/${a.id}/reject`, { method: 'POST', body: { admin_pubkey: ME } });
            toast('Rejected.'); renderDetail(id);
          } catch (e) { toast(e.message, true); rejectBtn.disabled = false; rejectBtn.textContent = 'Reject'; }
        });
        btns.appendChild(approveBtn);
        btns.appendChild(rejectBtn);
        row.appendChild(btns);
        appsCard.appendChild(row);
      });
    }
    bodyStack.appendChild(appsCard);
  }

  // PLEDGE CARD - moved above "I'll do this"
  if (b.status === 'open') {
    const pledgeCard = DIV('card');
    pledgeCard.appendChild(h('div', 'overline', 'Your pledge'));
    pledgeCard.appendChild(hint('Promise now, pay only when the work is done. Your sats never leave your wallet until then.'));
    const pAmt = h('input', ''); pAmt.type = 'number'; pAmt.placeholder = 'e.g. 5000'; if (myPledge) pAmt.value = myPledge.amount_sats; pAmt.style.marginBottom = '12px';
    pledgeCard.appendChild(pAmt);

    const pBtn = BTN('btn', myPledge ? 'Update pledge' : 'Pledge', async () => {
      const amt = parseInt(pAmt.value); if (!amt || amt < 1) return toast('Enter an amount', true);
      if (pBtn._submitting) return;
      pBtn._submitting = true;
      pBtn.disabled = true;
      pBtn.textContent = myPledge ? 'Updating...' : 'Pledging...';
      try {
        const sig = await signAction('Pledge', { kind: 'm2s-pledge', bounty: b.id });
        await api(`/bounties/${id}/pledge`, { method: 'POST', body: { pledger_pubkey: ME, display_name: MENAME, amount_sats: amt, community_id: COMMUNITY, ...sig } });
        toast('Pledged.');
        await postNote(`Pledged to "${b.title}"`, [['r', `/b/${id}`]]);
        renderDetail(id);
      } catch (e) {
        toast(e.message, true);
        pBtn.disabled = false;
        pBtn.textContent = myPledge ? 'Update pledge' : 'Pledge';
        pBtn._submitting = false;
      }
    });
    pledgeCard.appendChild(DIV('', pBtn));
    bodyStack.appendChild(pledgeCard);
  }

  // APPLY CARD (replaces "I'll do this")
  if (b.status === 'open' && !isWorker) {
    const myApp = b.applications?.find(a => a.applicant_pubkey === ME);
    if (myApp) {
      if (myApp.status === 'pending') {
        bodyStack.appendChild(DIV('card', h('span', 'hint', '📤 Application pending. Waiting for admin approval.')));
      } else if (myApp.status === 'rejected') {
        bodyStack.appendChild(DIV('card warn', h('span', 'hint', '❌ Your application was rejected.')));
      }
      // if approved, show "Claim" button below
    }
    if (!myApp || myApp.status === 'rejected') {
      const applyCard = DIV('card card-action');
      applyCard.appendChild(h('div', 'overline', '🙋 Apply to work'));
      applyCard.appendChild(hint('Apply to do this job. An admin must approve you before you can start.'));
      const applyBtn = BTN('btn btn-lg', 'Apply', async () => {
        if (applyBtn._submitting) return;
        applyBtn._submitting = true; applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';
        try {
          await api(`/bounties/${id}/apply`, { method: 'POST', body: { applicant_pubkey: ME, display_name: MENAME } });
          toast('Applied. Waiting for admin approval.');
          await postNote(`Applied to: "${b.title}" on build the roads`, [['r', `/b/${id}`]]);
          renderDetail(id);
        } catch (e) { toast(e.message, true); applyBtn.disabled = false; applyBtn.textContent = 'Apply'; applyBtn._submitting = false; }
      });
      applyCard.appendChild(applyBtn);
      bodyStack.appendChild(applyCard);
    }
    // If approved, show claim button
    if (myApp?.status === 'approved') {
      const claimCard = DIV('card card-action');
      claimCard.appendChild(h('div', 'overline', '✅ Approved! Start working'));
      const claimBtn = BTN('btn btn-lg', "I'll do this", async () => {
        if (claimBtn._submitting) return;
        claimBtn._submitting = true; claimBtn.disabled = true; claimBtn.textContent = 'Claiming...';
        try {
          const sig = await signAction('Claim', { kind: 'm2s-claim', bounty: b.id });
          await api(`/bounties/${id}/claim`, { method: 'POST', body: { worker_pubkey: ME, display_name: MENAME, community_id: COMMUNITY, ...sig } });
          toast('Claimed! Time to do the work.');
          await postNote(`Claimed: "${b.title}" on build the roads`, [['r', `/b/${id}`]]);
          renderDetail(id);
        } catch (e) { toast(e.message, true); claimBtn.disabled = false; claimBtn.textContent = "I'll do this"; claimBtn._submitting = false; }
      });
      claimCard.appendChild(claimBtn);
      bodyStack.appendChild(claimCard);
    }
  }

  // pot card - shows pledges and status
  const pot = DIV('card');
  pot.appendChild(DIV('b-row',
    h('span', 'b-nums', h('span', 'big', fmt(b.pot_sats)), ' sats'),
    h('span', 'tag-status tag-' + b.status, esc({ open: 'Open', claimed: 'Claimed', proof_submitted: 'Proof sent', settled: 'Done' }[b.status] || b.status))
  ));
  if (b.effective_pot_sats !== b.pot_sats)
    pot.appendChild(h('div', 'b-nums', '~' + fmt(b.effective_pot_sats) + ' trusted pot'));
  if ((b.pledges || []).length) {
    const pl = DIV('pl-list');
    (b.pledges || []).forEach(p => {
      // Contextual badge: reflects THIS pledge's status, not just historical trust
      const contextualBadge = () => {
        if (p.status === 'paid') return h('span', 'trust trust-reliable', 'paid');
        if (p.status === 'reneged') return h('span', 'trust trust-unreliable', 'reneged');
        if (p.status === 'payment_claimed') return h('span', 'trust trust-mixed', 'pending');
        // pledged but not yet paid - show "owes" on active bounties
        if (p.status === 'pledged' && (b.status === 'proof_submitted' || b.status === 'settled')) {
          return h('span', 'trust trust-new', 'owes');
        }
        return null; // open bounty: no payment expected yet
      };
      const statusLabel = p.status === 'paid' ? h('span', 'pl-paid', 'paid') :
                         p.status === 'reneged' ? h('span', 'pl-reneged', 'reneged') :
                         p.status === 'payment_claimed' ? h('span', 'pl-pending', 'pending') :
                         null;
      const badge = contextualBadge();
      const row = DIV('pl-row',
        DIV('pl-who',
          statusLabel,
          h('span', 'pl-addr', short(p.pledger_pubkey)),
          badge
        ),
        h('span', 'pl-amt', fmtS(p.amount_sats))
      );
      pl.appendChild(row);
    });
    pot.appendChild(pl);
    // Also load historical trust score as tooltip-style info (optional enrichment)
    setTimeout(() => {
      (b.pledges || []).forEach(async p => {
        const t = await loadTrust(p.pledger_pubkey);
        if (!t) return;
        // Could add hover tooltip or secondary info here if desired
      });
    }, 0);
  }
  bodyStack.appendChild(pot);

  // Worker warning
  if (b.status === 'open' && !isWorker) {
    bodyStack.appendChild(DIV('card warn',
      h('b', '', 'Workers:'),
      ' This app cannot force pledgers to pay. We can only track who keeps their word. Check the trust scores below before claiming a job.'
    ));
  }

  // Expired notice
  if (b.status === 'expired') {
    bodyStack.appendChild(DIV('card',
      h('div', 'overline', 'Expired'),
      h('div', 'b-desc', 'This bounty expired before anyone claimed it. The pledges have been cancelled.')
    ));
  }

  // Actions: claimed (worker proof)
  if (b.status === 'claimed' && isWorker) {
    const pf = DIV('card');
    pf.appendChild(h('div', 'overline', 'Submit proof'));
    if (b.claim_deadline) {
      const daysLeft = Math.ceil((b.claim_deadline - Math.floor(Date.now()/1000)) / 86400);
      const warn = daysLeft <= 0 ? '\u26A0\uFE0F Due today!' : daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left to submit';
      pf.appendChild(h('div', 'hint', warn));
    }
    pf.appendChild(hint('Photo or note showing the work is done. The app will generate payment invoices for all pledgers from your wallet.'));
    const pImg = h('input', ''); pImg.type = 'file'; pImg.accept = 'image/*'; pImg.style.marginBottom = '12px'; pf.appendChild(pImg);
    pf.appendChild(h('label', 'field-label', 'What did you do?'));
    const pNote = h('textarea', ''); pNote.placeholder = 'Describe the work - what you did, how it looks now.'; pf.appendChild(pNote);

    // Lightning address / LNURL: auto-fetch from Fedi/Alby wallet, allow manual override
    pf.appendChild(h('label', 'field-label', 'Your Lightning address or LNURL for payments'));
    const lnHint = h('div', 'hint', 'Fetching from your wallet...');
    pf.appendChild(lnHint);
    const pInv = h('input', ''); pInv.placeholder = 'you@wallet.com or LNURL1...'; pf.appendChild(pInv);

    getLightningAddress().then(addr => {
      if (addr) {
        pInv.value = addr;
        lnHint.textContent = 'Auto-filled from your wallet.';
      } else {
        lnHint.textContent = 'Enter your Lightning address (user@domain) or LNURL. Pledgers will pay you here automatically.';
      }
    }).catch(() => {
      lnHint.textContent = 'Enter your Lightning address (user@domain) or LNURL. Pledgers will pay you here automatically.';
    });

    const submitPfBtn = BTN('btn', 'Submit proof', async () => {
      if (submitPfBtn._submitting) return;
      const workerInvoice = pInv.value.trim();
      if (!workerInvoice) {
        toast('Your Lightning address is required so pledgers can pay you automatically.', true);
        return;
      }
      submitPfBtn._submitting = true;
      submitPfBtn.disabled = true;
      submitPfBtn.textContent = 'Submitting...';
      try {
        let b64 = null; if (pImg.files[0]) b64 = await readFile(pImg.files[0]);
        await api(`/bounties/${id}/proof`, { method: 'POST', body: { image_base64: b64, proof_note: pNote.value.trim(), worker_invoice: workerInvoice } });
        await postNote(`Proof submitted for "${b.title}"`, [['r', `/b/${id}`]]);
        // Auto-generate BOLT11 invoices for all pledgers from worker's address
        try {
          const { invoices } = await api(`/bounties/${id}/invoices`, { method: 'POST' });
          const ok = invoices.filter(inv => inv.invoice).length;
          const errors = invoices.filter(inv => inv.error);
          if (errors.length > 0) {
            console.error('[invoice] generation errors:', errors);
            toast(`Proof sent. ${ok} invoices generated. ${errors.length} failed - check console.`);
          } else {
            toast(`Proof sent. ${ok} invoices generated for pledgers.`);
          }
        } catch (invErr) {
          console.error('[invoice] generation failed:', invErr);
          toast('Proof sent, but invoice generation failed: ' + invErr.message, true);
        }
        renderDetail(id);
      } catch (e) {
        toast(e.message, true);
        submitPfBtn.disabled = false;
        submitPfBtn.textContent = 'Submit proof';
        submitPfBtn._submitting = false;
      }
    });
    pf.appendChild(DIV('gap-2', submitPfBtn));
    bodyStack.appendChild(pf);
  }

  // Actions: proof submitted
  // Retroactive: if proof_submitted but no worker_invoice, show form to add it
  if (b.status === 'proof_submitted' && !b.worker_invoice) {
    const fixPay = DIV('card');
    fixPay.appendChild(h('div', 'overline', 'Add your payment address'));
    fixPay.appendChild(h('div', 'hint', 'Pledgers need a Lightning address or LNURL to pay you automatically.'));
    const fixInv = h('input', ''); fixInv.placeholder = 'you@wallet.com or LNURL1...'; fixPay.appendChild(fixInv);

    // Auto-fetch from wallet
    getLightningAddress().then(addr => {
      if (addr) { fixInv.value = addr; }
    }).catch(() => {});

    const fixBtn = BTN('btn', 'Save address', async () => {
      if (!fixInv.value.trim()) { toast('Enter a Lightning address or LNURL', true); return; }
      try {
        await api(`/bounties/${id}/worker-invoice`, { method: 'POST', body: { worker_invoice: fixInv.value.trim() } });
        toast('Address saved. Pledgers can now pay you.'); renderDetail(id);
      } catch (e) { toast(e.message, true); }
    });
    fixPay.appendChild(fixBtn);
    bodyStack.appendChild(fixPay);
  }

  if (b.status === 'proof_submitted') {
    if (b.proof_image || b.proof_note) {
      const pr = DIV('card');
      pr.appendChild(h('div', 'overline', 'Proof of work'));
      if (b.proof_note) pr.appendChild(h('div', '', esc(b.proof_note)));
      if (b.proof_image) { const img = h('img', ''); img.src = b.proof_image; style(img, { borderRadius: '8px', width: '100%', marginTop: '12px' }); pr.appendChild(img); }
      bodyStack.appendChild(pr);
    }
    if (myPledge && myPledge.status === 'pledged') {
      const pay = DIV('card');
      pay.appendChild(h('div', 'overline', 'Your turn to pay'));

      // Deadline notice
      if (b.payment_deadline) {
        const daysLeft = Math.ceil((b.payment_deadline - Math.floor(Date.now()/1000)) / 86400);
        const deadlineText = daysLeft <= 0 ? 'Due today' : daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left to pay';
        pay.appendChild(h('div', 'hint', deadlineText));
      }

      pay.appendChild(h('div', 'b-desc', 'You pledged ' + fmtS(myPledge.amount_sats) + '. The work is done. Time to pay what you promised.'));

      if (b.worker_invoice) {
        const hasPreGenInvoice = myPledge.invoice_request;
        const invBox = DIV('invoice-box' + (hasPreGenInvoice ? ' invoice-box-ready' : ''));
        if (hasPreGenInvoice) {
          invBox.appendChild(h('div', 'hint', 'Use your Lightning wallet to pay this invoice:'));
          invBox.appendChild(h('div', 'invoice-text', esc(myPledge.invoice_request)));
        } else {
          invBox.appendChild(h('div', 'hint', 'Use your Lightning wallet to pay the worker:'));
          invBox.appendChild(h('div', 'invoice-text', esc(b.worker_invoice)));
        }
        const copyRow = DIV('gap-1-row');
        copyRow.appendChild(BTN('btn btn-ghost btn-sm', '\u{1F4CB} Copy ' + (hasPreGenInvoice ? 'invoice' : 'address'), () => { copyToClipboard(hasPreGenInvoice ? myPledge.invoice_request : b.worker_invoice); toast('Copied'); }));
        if (hasWebLN()) {
          copyRow.appendChild(BTN('btn btn-sm', '\u26A1 Pay now', async () => {
            try {
              let invoiceToPay;
              if (hasPreGenInvoice) {
                invoiceToPay = myPledge.invoice_request;
              } else {
                const result = await resolveInvoiceFromAddress(b.worker_invoice, myPledge.amount_sats, 'build the roads: ' + b.title);
                invoiceToPay = result.invoice;
              }
              const preimage = await payInvoice(invoiceToPay);
              await api(`/pledges/${myPledge.id}/pay`, { method: 'POST', body: { preimage } });
              toast('Payment recorded. Preimage stored for verification.');
              await postNote(`Paid for "${b.title}"`, [['r', `/b/${id}`]]);
              renderDetail(id);
            } catch (e) { toast(e.message === 'NO_WEBLN' ? 'Wallet not connected' : e.message, true); }
          }));
        }
        invBox.appendChild(copyRow);
        pay.appendChild(invBox);
      } else {
        pay.appendChild(h('div', 'hint', 'The worker has not provided a payment address yet.'));
      }

      const payActions = DIV('stack-xs');
      payActions.style.marginTop = '12px';
      payActions.appendChild(BTN('btn btn-ghost', 'Flag as bad work', async () => {
        await api(`/bounties/${id}/flag`, { method: 'POST', body: { flagger_pubkey: ME, target_pubkey: b.worker_pubkey, reason: 'bad work' } });
        toast('Flagged.'); renderDetail(id);
      }));
      pay.appendChild(payActions);
      bodyStack.appendChild(pay);
    }
  }
  } catch (e) {
    console.error('renderDetail error:', e);
    const w = $('app');
    w.innerHTML = '';
    renderHeader();
    w.appendChild(emptyState('Something went wrong', e.message || 'Please try refreshing the page.'));
  }
}

function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

/* ================================================================
   HOW IT WORKS (expanded)
   ================================================================ */
function renderHow() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(makeTabs('how'));
  lead.appendChild(h('h1', 't1', 'How it works'));
  lead.appendChild(h('p', 'body', 'Build the roads is a community bounty board. No middleman. No upfront escrow. Just neighbors helping neighbors.'));
  w.appendChild(lead);

  const body = DIV('stack');

  // Core flow
  body.appendChild(howItWorks());

  // For admins
  const adminCard = DIV('card help');
  adminCard.appendChild(h('div', 'help-title', '🛡️ For admins'));
  adminCard.appendChild(h('div', 'help-step', h('span', 'num', '1'), h('div', '', h('b', '', 'Create a community.'), ' Set the name and region. You become the first admin automatically.')));
  adminCard.appendChild(h('div', 'help-step', h('span', 'num', '2'), h('div', '', h('b', '', 'Post jobs.'), ' Only admins can create bounties. Describe the need, set a category, and publish.')));
  adminCard.appendChild(h('div', 'help-step', h('span', 'num', '3'), h('div', '', h('b', '', 'Approve workers.'), ' When someone applies to a job, you review and approve them before they start working.')));
  adminCard.appendChild(h('div', 'help-step', h('span', 'num', '4'), h('div', '', h('b', '', 'Add more admins.'), ' Go to Manage → tap "Make admin" on any community member. No typing pubkeys required.')));
  body.appendChild(adminCard);

  // For workers
  const workerCard = DIV('card help');
  workerCard.appendChild(h('div', 'help-title', '🛠️ For workers'));
  workerCard.appendChild(h('div', 'help-step', h('span', 'num', '1'), h('div', '', h('b', '', 'Browse open jobs.'), ' Find something you can do in your community.')));
  workerCard.appendChild(h('div', 'help-step', h('span', 'num', '2'), h('div', '', h('b', '', 'Apply first.'), ' Click "Apply" and wait for an admin to approve you.')));
  workerCard.appendChild(h('div', 'help-step', h('span', 'num', '3'), h('div', '', h('b', '', 'Do the work.'), ' Once approved, claim the job, complete it, and submit proof (photo or video).')));
  workerCard.appendChild(h('div', 'help-step', h('span', 'num', '4'), h('div', '', h('b', '', 'Get paid.'), ' Everyone who pledged pays you directly via Lightning.')));
  body.appendChild(workerCard);

  // For pledgers
  const pledgerCard = DIV('card help');
  pledgerCard.appendChild(h('div', 'help-title', '🤝 For pledgers'));
  pledgerCard.appendChild(h('div', 'help-step', h('span', 'num', '1'), h('div', '', h('b', '', 'Find a need.'), ' See a job you want to support? Pledge some sats.')));
  pledgerCard.appendChild(h('div', 'help-step', h('span', 'num', '2'), h('div', '', h('b', '', 'Hold your money.'), ' Your sats stay in your wallet. No escrow, no custody.')));
  pledgerCard.appendChild(h('div', 'help-step', h('span', 'num', '3'), h('div', '', h('b', '', "Pay when it's done."), ' After the worker submits proof, send the sats you promised. If you do not pay, the community remembers.')));
  body.appendChild(pledgerCard);

  w.appendChild(body);
}

/* ================================================================
   PHILOSOPHY
   ================================================================ */
function renderPhilosophy() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(makeTabs('philosophy'));
  const titleRow = DIV('');
  titleRow.style.display = 'flex';
  titleRow.style.alignItems = 'center';
  titleRow.style.gap = '16px';
  titleRow.style.marginTop = '12px';
  titleRow.style.marginBottom = '16px';
  const logoImg = h('img', '');
  logoImg.src = 'favicon.png?v=1';
  logoImg.alt = 'build the roads';
  logoImg.style.width = '64px';
  logoImg.style.height = '64px';
  logoImg.style.borderRadius = '50%';
  logoImg.style.objectFit = 'cover';
  titleRow.appendChild(h('h1', 't1', 'Why this works'));
  titleRow.appendChild(logoImg);
  lead.appendChild(titleRow);
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'The old problem'),
    h('div', 'b-desc', '"Who will build the roads?" The question assumes only a government can coordinate public goods. But the real question is: who decides what gets built?'),
    h('div', 'b-desc', 'In every community, the same thing happens. A gate is rusted. Some sign fell down. While everyone agrees it should be fixed, nobody fixes it.'),
    h('div', 'b-desc', h('b', '', '"Everybody\'s job is nobody\'s job."'))
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'The new answer'),
    h('div', 'b-desc', 'It becomes somebody\'s job when enough people are willing to pay for it.'),
    h('div', 'b-desc', 'Not through taxes or some committee. Through direct, voluntary pledges. Neighbors say, "I\'ll pay 5,000 sats if someone paints that hall." When enough people say the same thing, a worker sees the pot, does the work, and collects.'),
    h('div', 'b-desc', 'No manager or budget meeting needed. No waiting for permission. Just people who need things, people who can do things, and sats that move when work is proven.')
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'Why Bitcoin?'),
    h('div', 'b-desc', 'Sats are small enough that anyone can pledge. A few hundred sats is a meaningful signal. A few thousand is a real commitment. Lightning makes it instant and cheap.'),
    h('div', 'b-desc', 'More importantly: Bitcoin does not care who you are. No bank account needed. No ID. No credit check. If you have a phone and a Lightning wallet, you can pledge, work, and earn.'),
    h('div', 'b-desc', 'This is financial inclusion in action. It\'s not a charity but a market.')
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'Earned trust, not force'),
    h('div', 'b-desc', 'We do not hold your money. You pledge with your word, backed by your reputation through prior actions. If you do not pay, the community sees it. Your trust score drops. Workers stop trusting your pledges.'),
    h('div', 'b-desc', 'This is stronger than a contract. It is proof of payment, encoded.'),
    h('div', 'b-desc', h('b', '', 'Workers:'), ' We cannot force anyone to pay. We can only show who keeps their word. Check a pledger\'s trust score before you claim a job. If they are flaky, the pot may look big, but the trusted pot is smaller.')
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'For the circular economy'),
    h('div', 'b-desc', 'This is not just about spending sats. It is about earning sats by solving real problems for real neighbors. The more problems get solved, the more useful Bitcoin becomes in your community. The more useful it becomes, the more people want it.'),
    h('div', 'b-desc', 'This is how circular economies grow. One job at a time.')
  ));
}

async function renderLeaderboard() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(makeTabs('leaderboard'));
  lead.appendChild(h('h1', 't1', 'Community heroes'));
  lead.appendChild(h('p', 'body', 'The people who show up. The people who pay up.'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  try {
    const lb = await api('/leaderboards');

    bodyStack.appendChild(h('div', 'overline', 'Hardest workers'));
    if (!lb.topWorkers.length) bodyStack.appendChild(emptyState('No workers yet.', 'Claim a job and complete it to show up here.', '💪'));
    else lb.topWorkers.forEach((r, i) => {
      const completion = r.jobs > 0 ? Math.round((r.completed || 0) / r.jobs * 100) + '%' : '0%';
      bodyStack.appendChild(rankRow(i + 1, short(r.pubkey), `${r.completed || 0}/${r.jobs} done (${completion})`, i === 0));
    });

    bodyStack.appendChild(h('div', 'overline overline-pad', 'Most reliable pledgers'));
    if (!lb.topReliable.length) bodyStack.appendChild(emptyState('No pledgers yet.', 'Make a pledge and honor it to show up here.', '🤝'));
    else lb.topReliable.forEach((r, i) => {
      const badge = r.reliability_pct >= 90 ? 'Reliable' : r.reliability_pct >= 60 ? 'Mixed' : 'Flaky';
      const right = `${r.reliability_pct ?? 0}% ${badge} · ${fmtS(r.paid_sats)} paid · ${fmtS(r.reneged_sats || 0)} reneged`;
      bodyStack.appendChild(rankRow(i + 1, short(r.pubkey), right, i === 0));
    });
  } catch (e) { bodyStack.appendChild(emptyState('Error', e.message)); }
}

function rankRow(pos, addr, right, gold) {
  return DIV('rank', h('span', 'n' + (gold ? ' gold' : ''), '#' + pos), h('span', 'a', addr), h('span', 'r', right));
}

/* ================================================================
   PENDING TAB: what needs action from me
   ================================================================ */
async function renderPending() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(makeTabs('pending'));
  lead.appendChild(h('h1', 't1', 'Pending'));
  lead.appendChild(h('p', 'body', 'Jobs you claimed, payments you owe, and applications to review.'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  try {
    const { toClaim, toPay, toReview } = await api('/pending?pubkey=' + encodeURIComponent(ME));

    // Admin: Applications to review
    if (toReview?.length > 0) {
      bodyStack.appendChild(h('div', 'overline', 'Applications to review'));
      toReview.forEach(a => {
        const card = DIV('card card-interactive');
        card.onclick = () => go('/b/' + a.bounty_id);
        card.appendChild(h('div', 'b-title', esc(a.bounty_title || 'Untitled job')));
        card.appendChild(h('div', 'hint', 'Applicant: ' + short(a.applicant_pubkey)));
        card.appendChild(h('div', 'b-desc', a.display_name || ''));
        bodyStack.appendChild(card);
      });
    }

    // Jobs to prove
    bodyStack.appendChild(h('div', 'overline', 'Jobs you claimed'));
    if (!toClaim.length) {
      bodyStack.appendChild(emptyState('Nothing to prove.', 'Jobs appear here after you claim them.', '📸'));
    } else {
      toClaim.forEach(b => bodyStack.appendChild(pendingCard(b, 'claim')));
    }

    // Payments to make
    bodyStack.appendChild(h('div', 'overline overline-pad', 'Payments you owe'));
    if (!toPay.length) {
      bodyStack.appendChild(emptyState('Nothing to pay.', 'Pledges appear here after work is submitted.', '💸'));
    } else {
      toPay.forEach(p => {
        const card = DIV('card card-interactive');
        card.onclick = () => go('/b/' + p.bounty_id);
        card.appendChild(h('div', 'b-title', esc(p.bounty_title)));
        if (p.payment_deadline) {
          const daysLeft = Math.ceil((p.payment_deadline - Math.floor(Date.now()/1000)) / 86400);
          card.appendChild(h('div', 'hint', daysLeft <= 0 ? 'Due today' : daysLeft + 'd left'));
        }
        card.appendChild(h('div', 'b-desc', fmtS(p.amount_sats)));
        if (p.invoice_request) {
          card.appendChild(h('div', 'invoice-text', esc(p.invoice_request.slice(0, 40) + '...')));
        }
        bodyStack.appendChild(card);
      });
    }

  } catch (e) { bodyStack.appendChild(emptyState('Could not load pending.', e.message)); }
}

function pendingCard(b, type) {
  const card = DIV('card card-interactive');
  card.onclick = () => go('/b/' + b.id);
  card.appendChild(h('div', 'b-title', esc(b.title)));
  if (type === 'claim' && b.claim_deadline) {
    const daysLeft = Math.ceil((b.claim_deadline - Math.floor(Date.now()/1000)) / 86400);
    card.appendChild(h('div', 'hint', daysLeft <= 0 ? 'Due today' : daysLeft + 'd to prove'));
  }
  return card;
}

/* ================================================================
   COMMUNITY PICKER
   ================================================================ */
async function renderPicker() {
  await loadCommunities();
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  const prev = localStorage.getItem('m2s_prev_community');
  if (prev) {
    lead.appendChild(BTN('btn btn-ghost btn-sm', '← Cancel', () => { setCommunity(prev); route(); }));
  }
  lead.appendChild(h('h1', 't1', 'Join a community'));
  lead.appendChild(h('p', 'body', 'Each community has its own bounties and leaderboard. Pick one to get started.'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  if (!ALL_COMMUNITIES.length) {
    const hero = DIV('hero');
    hero.appendChild(h('div', 'hero-art', '🛠️'));
    hero.appendChild(h('h2', 'hero-title', 'Every road starts somewhere.'));
    hero.appendChild(h('p', 'hero-body', 'Name your community, post the first need, and let neighbors pledge what it is worth to them. You hold your own sats until the work is done.'));
    bodyStack.appendChild(hero);
    const startBtn = BTN('btn btn-lg', 'Start your community', () => {
      const idBox = document.getElementById('community-id-input');
      if (idBox) idBox.focus();
      idBox?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    bodyStack.appendChild(startBtn);
  } else {
    ALL_COMMUNITIES.forEach(c => {
      const card = DIV('card card-interactive');
      card.appendChild(h('div', 'b-title', esc(c.name)));
      card.appendChild(h('div', 'b-desc', esc(c.region || c.description || c.id)));
      card.onclick = () => { setCommunity(c.id); toast('Joined ' + esc(c.name)); route(); };
      bodyStack.appendChild(card);
    });
  }

  const create = DIV('card');
  create.appendChild(h('div', 'overline', 'Start a new community'));

  const cId = h('input', ''); cId.id = 'community-id-input'; cId.placeholder = 'URL-friendly ID, e.g. bitcoin-ekasi';
  create.appendChild(h('label', 'field-label', 'ID')); create.appendChild(cId);

  const cName = h('input', ''); cName.placeholder = 'Mytown Bitcoin Crew';
  create.appendChild(h('label', 'field-label', 'Name')); create.appendChild(cName);

  const cReg = h('input', ''); cReg.placeholder = 'Mossel Bay, South Africa';
  create.appendChild(h('label', 'field-label', 'Region (optional)')); create.appendChild(cReg);

  const cDesc = h('textarea', ''); cDesc.placeholder = 'What makes this community unique?';
  create.appendChild(h('label', 'field-label', 'Description (optional)')); create.appendChild(cDesc);

  create.appendChild(DIV('gap-1',
    BTN('btn', 'Create', async () => {
      const body = { id: cId.value.trim().toLowerCase(), name: cName.value.trim(), region: cReg.value.trim() || null, description: cDesc.value.trim() || null, admin_pubkey: ME, admin_display_name: MENAME };
      if (!body.id || !body.name) return toast('Need ID and name', true);
      const { community } = await api('/communities', { method: 'POST', body });
      setCommunity(community.id); toast('Created ' + esc(community.name)); route();
    })
  ));
  bodyStack.appendChild(create);
}

/* ── Boot ── */

// Wait for Fedi/WebLN/Nostr to be injected (they may not be ready at page load)
async function waitForWalletAPIs(timeoutMs = 1500, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (hasNostr() || hasWebLN() || inFedi()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return hasNostr() || hasWebLN() || inFedi();
}

function renderSignIn() {
  const app = $('app');
  renderHeader();
  const card = DIV('card empty');
  card.appendChild(h('b', '', 'Sign in'));
  card.appendChild(h('p', '', 'Checking for wallet...'));
  app.appendChild(card);

  // Async: detect Fedi/WebLN/Nostr before showing dev key option
  (async () => {
    const hasWallet = await waitForWalletAPIs();
    card.innerHTML = '';
    card.appendChild(h('b', '', 'Sign in'));

    if (hasWallet) {
      card.appendChild(h('p', '', 'Connect your Nostr identity to post, pledge, or claim bounties.'));
      card.appendChild(BTN('btn', 'Connect Nostr', async () => {
        try {
          ME = await getPubkey();
          if (!ME) return toast('Nostr not available', true);
          MENAME = await getDisplayName();
          route();
        } catch (e) { toast(e.message, true); }
      }));
    } else {
      card.appendChild(h('p', '', 'No wallet or Nostr extension detected. You can use a dev key for testing, or open this in the Fedi app for real Lightning + Nostr.'));
      card.appendChild(DIV('gap-1',
        BTN('btn', 'Use dev key', () => { ME = generateDevKey(); MENAME = 'Dev User'; route(); })
      ));
    }
  })();
}

async function renderManagePage() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(makeTabs(null));
  lead.appendChild(h('h1', 't1', 'Manage community'));
  lead.appendChild(h('p', 'body', 'Manage admins for ' + cName(COMMUNITY) + '. Admins can post jobs and approve workers.'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  if (!IS_ADMIN) {
    bodyStack.appendChild(DIV('card warn', h('b', '', 'Admins only.'), ' Only community admins can manage admins.'));
    return;
  }

  // Load admins + members in parallel
  let admins = [], members = [];
  try {
    [{ admins }, { members }] = await Promise.all([
      api('/communities/' + COMMUNITY + '/admins'),
      api('/communities/' + COMMUNITY + '/members?admin_pubkey=' + ME)
    ]);
  } catch (e) { bodyStack.appendChild(h('div', 'hint', 'Could not load data: ' + e.message)); return; }

  const adminSet = new Set(admins);
  const nonAdminMembers = members.filter(m => !adminSet.has(m.pubkey));

  // ── Current Admins ──
  const adminsCard = DIV('card');
  adminsCard.appendChild(h('div', 'overline', 'Current admins'));
  adminsCard.appendChild(hint('Admins can post jobs, approve workers, and manage other admins.'));
  if (!admins.length) {
    adminsCard.appendChild(h('div', 'hint', 'No admins yet.'));
  } else {
    admins.forEach(pk => {
      const row = DIV('b-row');
      const member = members.find(m => m.pubkey === pk);
      const label = (member?.display_name ? esc(member.display_name) + ' — ' : '') + short(pk);
      row.appendChild(h('span', 'pl-addr', label));
      if (pk === ME) {
        row.appendChild(h('span', 'hint', '(you)'));
      } else {
        const removeBtn = BTN('btn btn-ghost btn-sm', 'Remove', async () => {
          if (!confirm('Remove ' + short(pk) + ' as admin?')) return;
          try {
            await api('/communities/' + COMMUNITY + '/admins/' + pk, { method: 'DELETE', body: { removed_by_pubkey: ME } });
            toast('Admin removed.'); renderManagePage();
          } catch (e) { toast(e.message, true); }
        });
        row.appendChild(removeBtn);
      }
      adminsCard.appendChild(row);
    });
  }
  bodyStack.appendChild(adminsCard);

  // ── Community Members (not yet admins) ──
  const membersCard = DIV('card');
  membersCard.appendChild(h('div', 'overline', 'Community members'));
  membersCard.appendChild(hint('Everyone who has pledged or applied in this community. Tap “Make admin” to promote someone.'));
  if (!nonAdminMembers.length) {
    membersCard.appendChild(h('div', 'hint', 'No non-admin members yet. Members appear here when they pledge or apply to a job.'));
  } else {
    nonAdminMembers.forEach(m => {
      const row = DIV('b-row');
      const label = (m.display_name ? esc(m.display_name) + ' — ' : '') + short(m.pubkey);
      row.appendChild(h('span', 'pl-addr', label));
      const promoteBtn = BTN('btn btn-sm', 'Make admin', async () => {
        promoteBtn.disabled = true; promoteBtn.textContent = 'Adding...';
        try {
          await api('/communities/' + COMMUNITY + '/admins', { method: 'POST', body: { admin_pubkey: m.pubkey, added_by_pubkey: ME } });
          toast((m.display_name || short(m.pubkey)) + ' is now an admin.'); renderManagePage();
        } catch (e) { toast(e.message, true); promoteBtn.disabled = false; promoteBtn.textContent = 'Make admin'; }
      });
      row.appendChild(promoteBtn);
      membersCard.appendChild(row);
    });
  }
  bodyStack.appendChild(membersCard);

  // ── Add by pubkey (manual fallback) ──
  const addCard = DIV('card');
  addCard.appendChild(h('div', 'overline', 'Add admin by pubkey'));
  addCard.appendChild(hint('Use this if the person has not yet signed into this community. Paste their Nostr hex public key (64 characters).'));
  const pkInput = h('input', '');
  pkInput.placeholder = 'hex public key (64 chars)';
  addCard.appendChild(pkInput);
  const addBtn = BTN('btn', 'Add admin', async () => {
    const pk = pkInput.value.trim().toLowerCase();
    if (!pk || pk.length !== 64) { toast('Enter a valid 64-character hex public key', true); return; }
    addBtn.disabled = true; addBtn.textContent = 'Adding...';
    try {
      await api('/communities/' + COMMUNITY + '/admins', { method: 'POST', body: { admin_pubkey: pk, added_by_pubkey: ME } });
      toast('Admin added.'); pkInput.value = ''; renderManagePage();
    } catch (e) { toast(e.message, true); addBtn.disabled = false; addBtn.textContent = 'Add admin'; }
  });
  addCard.appendChild(DIV('gap-2', addBtn));
  bodyStack.appendChild(addCard);
}

(async function boot() {
  // Try real wallet first; dev key is absolute last backup
  try { ME = await getPubkey(); MENAME = await getDisplayName(); } catch {}
  if (!ME) {
    const storedPk = localStorage.getItem(LS_KEY);
    if (storedPk) { ME = storedPk; MENAME = 'Dev User'; }
  }
  if (!ME) { renderSignIn(); return; }
  resolveCommunity();
  if (!COMMUNITY && !localStorage.getItem('m2s_community') && !new URLSearchParams(location.search).has('community')) {
    renderPicker(); return;
  }
  if (!inFedi()) {
    const ban = h('div', 'dev-banner', 'Dev mode - open in Fedi app for real Lightning + Nostr.');
    document.querySelector('main').prepend(ban);
  }
  await route();
})();
