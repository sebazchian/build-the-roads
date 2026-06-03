/* build the roads  -  clean, no-weird-links */
import { getPubkey, getDisplayName, signAction, makeInvoice, payInvoice, getLightningAddress, resolveInvoiceFromAddress, inFedi, hasWebLN, hasNostr, generateDevKey, copyToClipboard } from './fedi.js';

/* ── State ── */
let ME=null, MENAME=null, COMMUNITY=null, ALL_COMMUNITIES=[];
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

/* ── Helpers ── */
const esc = s => String(s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const short = pk => pk ? pk.slice(0, 5) + '…' + pk.slice(-4) : ' - ';
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

/* ── SVG logo (safe DOM, not innerHTML) ── */
function makeBrandOrb() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '11'); c.setAttribute('fill', '#fff');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', '12'); t.setAttribute('y', '17'); t.setAttribute('text-anchor', 'middle');
  t.setAttribute('font-size', '14'); t.setAttribute('font-weight', '800'); t.setAttribute('fill', '#FF9419');
  t.textContent = '₿';
  svg.appendChild(c); svg.appendChild(t);
  return svg;
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
    const { toClaim, toPay, toVerify } = await api('/pending?pubkey=' + encodeURIComponent(ME));
    ACTION_COUNT = (toClaim?.length || 0) + (toPay?.length || 0) + (toVerify?.length || 0);
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
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', () => route());

async function route() {
  const app = $('app');
  app.innerHTML = '';
  const h = location.hash.slice(1) || '/';
  resolveCommunity();
  if (h === '/philosophy') { renderPhilosophy(); return; }
  if (!COMMUNITY) { renderPicker(); return; }
  if (!ME) { renderSignIn(); return; }
  await refreshActionCount(); // wait for count so header highlights correctly
  if (h === '/' || h === '/open') renderHome('open');
  else if (h === '/all') renderHome(null);
  else if (h === '/new') renderNew();
  else if (h === '/leaderboard') renderLeaderboard();
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
  brand.href = '#/';
  brand.onclick = e => { if (e.button === 0) { go('/'); return false; }};
  hd.appendChild(brand);

  const meta = DIV('header-meta');
  if (COMMUNITY) {
    const badge = DIV('badge', cName(COMMUNITY));
    const change = BTN('badge-change', 'change', () => { setCommunity(null); route(); });
    badge.appendChild(change);
    meta.appendChild(badge);
  }
  if (ME) {
    meta.appendChild(h('div', 'up', esc(MENAME || short(ME))));
    meta.appendChild(h('div', 'down', short(ME)));
    const pendingBtn = BTN('btn btn-ghost btn-sm' + (ACTION_COUNT > 0 ? ' action-alert' : ''), 'To-do', () => go('/pending'));
    pendingBtn.style.marginLeft = '8px';
    meta.appendChild(pendingBtn);
  }
  const phil = BTN('btn btn-ghost btn-sm', 'Why?', () => go('/philosophy'));
  phil.style.marginLeft = '8px';
  meta.appendChild(phil);
  hd.appendChild(meta);
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
  return wrap;
}

function backLink(href, text) {
  return BTN('btn btn-ghost btn-sm', '← ' + text, () => go(href));
}

function emptyState(title, body) {
  return DIV('empty', h('b', '', title), body);
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
    h('div', 'help-step', h('span', 'num', '1'), h('div', '', h('b', '', 'Someone posts a need.'), '  -  Paint the hall, fix the gate, clean the lot.')),
    h('div', 'help-step', h('span', 'num', '2'), h('div', '', h('b', '', 'Neighbours chip in sats.'), '  -  Pledge a small amount. If the work gets done, you pay.')),
    h('div', 'help-step', h('span', 'num', '3'), h('div', '', h('b', '', 'A worker claims it.'), '  -  They do the job and send proof.')),
    h('div', 'help-step', h('span', 'num', '4'), h('div', '', h('b', '', 'Pledgers pay up.'), '  -  Everyone who promised sends sats to the worker.')),
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

  wrap.appendChild(howItWorks());

  let list;
  try {
    const qs = filter ? `?status=${filter}` : '';
    const { bounties } = await api('/bounties' + qs);
    list = DIV('stack');
    if (!bounties.length) {
      list.appendChild(emptyState('Nothing here yet.', 'Be the first to post a need.'));
    } else {
      bounties.forEach(b => list.appendChild(bountyCard(b)));
    }
  } catch (e) {
    list = DIV('stack'); list.appendChild(emptyState('Could not load.', e.message));
  }
  wrap.appendChild(list);

  const fab = BTN('fab', '+ Post a need', () => go('/new'));
  wrap.appendChild(fab);
}

function bountyCard(b) {
  const cat = CAT_MAP[b.category] || CAT_MAP.other;
  const now = Math.floor(Date.now() / 1000);

  const card = DIV('card card-interactive');
  card.onclick = () => go('/b/' + b.id);

  card.appendChild(DIV('b-row',
    h('span', 'tag ' + cat.cls, esc(cat.label)),
    h('span', 'tag-status tag-' + b.status, esc({ open: 'Open', claimed: 'Claimed', proof_submitted: 'Proof sent', settled: 'Done', payment_claimed: 'Awaiting verification', cancelled: 'Cancelled', expired: 'Expired' }[b.status] || b.status))
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
  stack.appendChild(backLink('/open', 'Open needs'));
  stack.appendChild(DIV('', h('h1', 't1', 'What needs doing?'), h('p', 'body', "Describe it like you're telling a neighbour.")));
  w.appendChild(stack);

  w.appendChild(howItWorks());

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
      toast('Posted.'); go('/b/' + bounty.id);
    } catch (e) { toast(e.message, true); submit.disabled = false; }
  });
  card.appendChild(DIV('gap-2', submit));
  w.appendChild(card);
}

/* ================================================================
   DETAIL
   ================================================================ */
async function renderDetail(id) {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(backLink('/open', 'Open needs'));
  w.appendChild(lead);

  let b;
  try { ({ bounty: b } = await api('/bounties/' + id)); }
  catch { w.appendChild(emptyState('Not found', "That bounty doesn't exist in this community.")); return; }

  const myPledge = b.pledges.find(p => p.pledger_pubkey === ME);
  const isWorker = b.worker_pubkey === ME;

  const cat = CAT_MAP[b.category] || CAT_MAP.other;

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  // title block
  const titleBlock = DIV('stack-sm padded');
  titleBlock.appendChild(h('span', 'tag ' + cat.cls, cat.label));
  titleBlock.appendChild(h('h1', 't2', esc(b.title)));
  titleBlock.appendChild(h('div', 'hint', `Posted by ${short(b.creator_pubkey)}${b.expires_at ? ' \u00b7 Due ' + fmtDate(b.expires_at) : ''}`));
  bodyStack.appendChild(titleBlock);

  // description
  bodyStack.appendChild(DIV('card', h('div', '', esc(b.description))));

  // pot card
  const pot = DIV('card');
  pot.appendChild(DIV('b-row',
    h('span', 'b-nums', h('span', 'big', fmt(b.pot_sats)), ' sats'),
    h('span', 'tag-status tag-' + b.status, esc({ open: 'Open', claimed: 'Claimed', proof_submitted: 'Proof sent', settled: 'Done', payment_claimed: 'Awaiting verification' }[b.status] || b.status))
  ));
  if (b.effective_pot_sats !== b.pot_sats)
    pot.appendChild(h('div', 'b-nums', '~' + fmt(b.effective_pot_sats) + ' trusted pot'));
  if (b.pledges.length) {
    const pl = DIV('pl-list');
    b.pledges.forEach(p => {
      const trustSlot = h('span', 'trust-slot');
      trustSlot.dataset.pk = p.pledger_pubkey;
      const row = DIV('pl-row',
        DIV('pl-who',
          p.status === 'paid' ? h('span', 'pl-paid', 'paid') : null,
          h('span', 'pl-addr', short(p.pledger_pubkey)),
          trustSlot
        ),
        h('span', 'pl-amt', fmtS(p.amount_sats))
      );
      pl.appendChild(row);
    });
    pot.appendChild(pl);
    // load trust badges async
    setTimeout(() => {
      b.pledges.forEach(async p => {
        const t = await loadTrust(p.pledger_pubkey);
        const slots = pot.querySelectorAll('.trust-slot');
        for (const slot of slots) {
          if (slot.dataset.pk === p.pledger_pubkey && t) {
            slot.replaceWith(trustBadge(t));
            break;
          }
        }
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

  // Actions  -  open
  if (b.status === 'open') {
    const pledgeCard = DIV('card');
    pledgeCard.appendChild(h('div', 'overline', 'Your pledge'));
    pledgeCard.appendChild(hint('You are promising to pay if a worker does the job. Your sats stay in your wallet until then.'));
    const pAmt = h('input', ''); pAmt.type = 'number'; pAmt.placeholder = 'e.g. 5000'; if (myPledge) pAmt.value = myPledge.amount_sats; pAmt.style.marginBottom = '12px';
    pledgeCard.appendChild(pAmt);

    const pBtn = BTN('btn', myPledge ? 'Update pledge' : 'Pledge', async () => {
      const amt = parseInt(pAmt.value); if (!amt || amt < 1) return toast('Enter an amount', true);
      if (pBtn._submitting) return;
      pBtn._submitting = true;
      pBtn.disabled = true;
      pBtn.textContent = myPledge ? 'Updating…' : 'Pledging…';
      try {
        const sig = await signAction('Pledge', { kind: 'm2s-pledge', bounty: b.id });
        await api(`/bounties/${id}/pledge`, { method: 'POST', body: { pledger_pubkey: ME, display_name: MENAME, amount_sats: amt, community_id: COMMUNITY, ...sig } });
        toast('Pledged.'); renderDetail(id);
      } catch (e) {
        toast(e.message, true);
        pBtn.disabled = false;
        pBtn.textContent = myPledge ? 'Update pledge' : 'Pledge';
        pBtn._submitting = false;
      }
    });
    pledgeCard.appendChild(DIV('', pBtn));
    bodyStack.appendChild(pledgeCard);

    if (!isWorker) {
      const claimCard = DIV('card');
      claimCard.appendChild(h('div', 'overline', 'Do the work'));
      claimCard.appendChild(hint('Claim this job, do the work, then send proof. The pledgers will pay you.'));
      const claimBtn = BTN('btn btn-ghost', "🙋 I'll do this", async () => {
        if (claimBtn._submitting) return;
        claimBtn._submitting = true;
        claimBtn.disabled = true;
        claimBtn.textContent = 'Claiming…';
        try {
          const sig = await signAction('Claim', { kind: 'm2s-claim', bounty: b.id });
          await api(`/bounties/${id}/claim`, { method: 'POST', body: { worker_pubkey: ME, display_name: MENAME, community_id: COMMUNITY, ...sig } });
          toast('Claimed.'); renderDetail(id);
        } catch (e) {
          toast(e.message, true);
          claimBtn.disabled = false;
          claimBtn.textContent = "🙋 I'll do this";
          claimBtn._submitting = false;
        }
      });
      claimCard.appendChild(claimBtn);
      bodyStack.appendChild(claimCard);
    }
  }

  // Actions  -  claimed (worker proof)
  if (b.status === 'claimed' && isWorker) {
    const pf = DIV('card');
    pf.appendChild(h('div', 'overline', 'Submit proof'));
    if (b.claim_deadline) {
      const daysLeft = Math.ceil((b.claim_deadline - Math.floor(Date.now()/1000)) / 86400);
      const warn = daysLeft <= 0 ? '\u26A0\uFE0F Due today!' : daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' left to submit';
      pf.appendChild(h('div', 'hint', warn));
    }
    pf.appendChild(hint('Photo or note showing the work is done. The app will generate payment invoices for all pledgers automatically.'));
    const pImg = h('input', ''); pImg.type = 'file'; pImg.accept = 'image/*'; pImg.style.marginBottom = '12px'; pf.appendChild(pImg);
    pf.appendChild(h('label', 'field-label', 'What did you do?'));
    const pNote = h('textarea', ''); pNote.placeholder = 'Describe the work - what you did, how it looks now.'; pf.appendChild(pNote);

    const submitPfBtn = BTN('btn', 'Submit proof', async () => {
      if (submitPfBtn._submitting) return;
      submitPfBtn._submitting = true;
      submitPfBtn.disabled = true;
      submitPfBtn.textContent = 'Submitting…';
      try {
        let b64 = null; if (pImg.files[0]) b64 = await readFile(pImg.files[0]);
        await api(`/bounties/${id}/proof`, { method: 'POST', body: { image_base64: b64, proof_note: pNote.value.trim() } });
        // Generate invoices for pledgers automatically
        api(`/bounties/${id}/invoices`, { method: 'POST' }).catch(() => {});
        toast('Proof sent  -  pledgers will be notified.'); renderDetail(id);
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

  // Actions  -  proof submitted
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

      pay.appendChild(h('div', 'b-desc', 'You pledged ' + fmtS(myPledge.amount_sats) + '. The work is done  -  honour your pledge.'));

      if (myPledge.invoice_request || b.worker_invoice) {
        const invBox = DIV('invoice-box');
        const invoiceToShow = myPledge.invoice_request || null;
        if (invoiceToShow) {
          invBox.appendChild(h('div', 'hint', 'Use your Lightning wallet to pay this invoice:'));
          invBox.appendChild(h('div', 'invoice-text', esc(invoiceToShow)));
          const copyRow = DIV('gap-1');
          copyRow.appendChild(BTN('btn btn-ghost btn-sm', '\u{1F4CB} Copy invoice', () => { copyToClipboard(invoiceToShow); toast('Copied'); }));
          // WebLN auto-pay with pre-generated invoice
          if (hasWebLN()) {
            copyRow.appendChild(BTN('btn btn-sm', '\u26A1 Pay now', async () => {
              try {
                const preimage = await payInvoice(invoiceToShow);
                await api(`/pledges/${myPledge.id}/autopay`, { method: 'POST', body: { preimage } });
                toast('Paid! Your trust score will update.'); renderDetail(id);
              } catch (e) { toast(e.message === 'NO_WEBLN' ? 'Wallet not connected' : e.message, true); }
            }));
          }
          invBox.appendChild(copyRow);
        } else if (b.worker_invoice) {
          invBox.appendChild(h('div', 'hint', 'Worker Lightning address:'));
          invBox.appendChild(h('div', 'invoice-text', esc(b.worker_invoice)));
          const copyRow = DIV('gap-1');
          copyRow.appendChild(BTN('btn btn-ghost btn-sm', '\u{1F4CB} Copy address', () => { copyToClipboard(b.worker_invoice); toast('Copied'); }));
          if (hasWebLN()) {
            copyRow.appendChild(BTN('btn btn-sm', '\u26A1 Pay', async () => {
              try {
                const result = await resolveInvoiceFromAddress(b.worker_invoice, myPledge.amount_sats, 'build the roads bounty');
                let preimage = 'manual';
                if (result.invoice) { preimage = await payInvoice(result.invoice); }
                else if (result.preimage) { preimage = result.preimage; }
                await api(`/pledges/${myPledge.id}/autopay`, { method: 'POST', body: { preimage } });
                toast('Paid!'); renderDetail(id);
              } catch (e) { toast(e.message === 'NO_WEBLN' ? 'Wallet not connected' : e.message, true); }
            }));
          }
          invBox.appendChild(copyRow);
        }
        pay.appendChild(invBox);
      } else {
        pay.appendChild(h('div', 'hint', 'The worker has not provided a payment address yet.'));
      }

      const payActions = DIV('stack-xs');
      payActions.style.marginTop = '12px';
      payActions.appendChild(BTN('btn', '\u2705 I paid manually', async () => {
        await api(`/pledges/${myPledge.id}/pay`, { method: 'POST', body: { preimage: 'manual' } });
        toast('Payment reported  -  the community will verify it.'); renderDetail(id);
      }));
      payActions.appendChild(BTN('btn btn-ghost', 'Flag as bad work', async () => {
        await api(`/bounties/${id}/flag`, { method: 'POST', body: { flagger_pubkey: ME, target_pubkey: b.worker_pubkey, reason: 'bad work' } });
        toast('Flagged.'); renderDetail(id);
      }));
      pay.appendChild(payActions);
      bodyStack.appendChild(pay);
    }
    // Payment claimed, awaiting admin verification
    if (myPledge && myPledge.status === 'payment_claimed') {
      const pending = DIV('card');
      pending.appendChild(h('div', 'overline', 'Payment reported'));
      pending.appendChild(h('div', 'b-desc', 'Your payment of ' + fmtS(myPledge.amount_sats) + ' has been reported and is waiting to be verified by the community guardian. Your trust score will update once confirmed.'));
      bodyStack.appendChild(pending);
    }
    // NOTE: Settlement ("Close bounty") is intentionally NOT shown here.
    // The community guardian settles via admin API only, after verifying payments.
    const adminNote = DIV('card');
    adminNote.appendChild(h('div', 'hint', 'Settlement is managed by the community guardian after payments are verified.'));
    bodyStack.appendChild(adminNote);
  }
}

function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

/* ================================================================
   PHILOSOPHY
   ================================================================ */
function renderPhilosophy() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(backLink('/open', 'Open needs'));
  lead.appendChild(h('h1', 't1', 'Why this works'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'The old problem'),
    h('div', 'b-desc', '"Who will build the roads?" The question assumes only a government can coordinate public goods. But the real question is: who decides what gets built?'),
    h('div', 'b-desc', 'In every community, the same thing happens. The hall needs painting. The gate is rusted. The sign fell down. Everyone agrees it should be fixed. But nobody fixes it.'),
    h('div', 'b-desc', h('b', '', '"Everybody\'s job is nobody\'s job."'))
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'The new answer'),
    h('div', 'b-desc', 'It becomes somebody\'s job when enough people are willing to pay for it.'),
    h('div', 'b-desc', 'Not through taxes. Not through a committee. Through direct, voluntary pledges. Neighbours say: "I will pay 5 000 sats if someone paints that hall." When enough people say the same thing, a worker sees the pot, claims the job, does the work, and collects.'),
    h('div', 'b-desc', 'No manager. No budget meeting. No waiting for permission. Just people who need things, people who can do things, and sats that move when work is proven.')
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'Why Bitcoin?'),
    h('div', 'b-desc', 'Sats are small enough that anyone can pledge. A few hundred sats is a meaningful signal. A few thousand is a real commitment. Lightning makes it instant and cheap.'),
    h('div', 'b-desc', 'More importantly: Bitcoin does not care who you are. No bank account needed. No ID. No credit check. If you have a phone and a Lightning wallet, you can pledge, work, and earn.'),
    h('div', 'b-desc', 'This is financial inclusion in action. Not a charity. A market.')
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'Trust, not force'),
    h('div', 'b-desc', 'We do not hold your money. You pledge with your word, backed by your reputation. If you do not pay, the community sees it. Your trust score drops. Workers stop trusting your pledges.'),
    h('div', 'b-desc', 'This is stronger than a contract. It is social pressure, encoded.'),
    h('div', 'b-desc', h('b', '', 'Workers:'), ' We cannot force anyone to pay. We can only show who keeps their word. Check a pledger\'s trust score before you claim a job. If they are flaky, the pot may look big but the trusted pot is small.')
  ));

  bodyStack.appendChild(DIV('card',
    h('div', 'overline', 'For the circular economy'),
    h('div', 'b-desc', 'This is not just about spending sats. It is about earning sats by solving real problems for real neighbours. The more problems get solved, the more useful Bitcoin becomes in your community. The more useful it becomes, the more people want it.'),
    h('div', 'b-desc', 'This is how circular economies start. One job at a time.')
  ));
}

async function renderLeaderboard() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(backLink('/open', 'Open needs'));
  lead.appendChild(h('h1', 't1', 'Community heroes'));
  lead.appendChild(h('p', 'body', 'The people who show up  -  and the people who pay up.'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  try {
    const lb = await api('/leaderboards');

    bodyStack.appendChild(h('div', 'overline', 'Hardest workers'));
    if (!lb.topWorkers.length) bodyStack.appendChild(emptyState('No jobs done yet.', 'Be the first.'));
    else lb.topWorkers.forEach((r, i) => bodyStack.appendChild(rankRow(i + 1, short(r.pubkey), r.jobs + ' done', i === 0)));

    bodyStack.appendChild(h('div', 'overline overline-pad', 'Most reliable pledgers'));
    if (!lb.topReliable.length) bodyStack.appendChild(emptyState('Not enough data yet.', 'Need at least 3 settled pledges per person.'));
    else lb.topReliable.forEach((r, i) => bodyStack.appendChild(rankRow(i + 1, short(r.pubkey), (r.reliability_pct ?? 0) + '% (' + fmtS(r.paid_sats) + ' paid)', i === 0)));
  } catch (e) { bodyStack.appendChild(emptyState('Error', e.message)); }
}

function rankRow(pos, addr, right, gold) {
  return DIV('rank', h('span', 'n' + (gold ? ' gold' : ''), '#' + pos), h('span', 'a', addr), h('span', 'r', right));
}

/* ================================================================
   PENDING TAB  -  what needs action from me
   ================================================================ */
async function renderPending() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack');
  lead.appendChild(backLink('/open', 'Open needs'));
  lead.appendChild(h('h1', 't1', 'Pending'));
  lead.appendChild(h('p', 'body', 'Jobs you claimed, payments you owe, and things to verify.'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  try {
    const { toClaim, toPay, toVerify } = await api('/pending?pubkey=' + encodeURIComponent(ME));

    // Jobs to prove
    bodyStack.appendChild(h('div', 'overline', 'Jobs you claimed'));
    if (!toClaim.length) {
      bodyStack.appendChild(emptyState('Nothing to prove.', 'Jobs appear here after you claim them.'));
    } else {
      toClaim.forEach(b => bodyStack.appendChild(pendingCard(b, 'claim')));
    }

    // Payments to make
    bodyStack.appendChild(h('div', 'overline overline-pad', 'Payments you owe'));
    if (!toPay.length) {
      bodyStack.appendChild(emptyState('Nothing to pay.', 'Pledges appear here after work is submitted.'));
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

    // Admin: to verify
    if (toVerify && toVerify.length) {
      bodyStack.appendChild(h('div', 'overline overline-pad', 'Needs admin verification'));
      toVerify.forEach(b => {
        const card = DIV('card card-interactive');
        card.onclick = () => go('/b/' + b.id);
        card.appendChild(h('div', 'b-title', esc(b.title)));
        if (b.proof_at) card.appendChild(h('div', 'hint', 'Proof sent ' + fmtDate(b.proof_at)));
        card.appendChild(h('div', 'b-desc', fmtS(b.pot_sats) + ' in pledges'));
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
    bodyStack.appendChild(emptyState('No communities yet.', 'Be the first to start one.'));
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

  const cId = h('input', ''); cId.placeholder = 'URL-friendly ID, e.g. bitcoin-ekasi';
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
function renderSignIn() {
  const app = $('app');
  renderHeader();
  const card = DIV('card empty');
  card.appendChild(h('b', '', 'Sign in'));
  if (inFedi()) {
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
    card.appendChild(h('p', '', 'You are in a normal browser. Use a dev key for testing, or open this in the Fedi app for real Lightning + Nostr.'));
    card.appendChild(DIV('gap-1',
      BTN('btn', 'Use dev key', () => { ME = generateDevKey(); MENAME = 'Dev User'; route(); })
    ));
  }
  app.appendChild(card);
}

(async function boot() {
  resolveCommunity();
  if (!COMMUNITY && !localStorage.getItem('m2s_community') && !new URLSearchParams(location.search).has('community')) {
    renderPicker(); return;
  }
  try { ME = await getPubkey(); MENAME = await getDisplayName(); } catch {}
  if (!ME) { renderSignIn(); return; }
  if (!inFedi()) {
    const ban = h('div', 'dev-banner', 'Dev mode  -  open in Fedi app for real Lightning + Nostr.');
    document.querySelector('main').prepend(ban);
  }
  await route();
})();
