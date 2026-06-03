/* my two sats — clean, no-weird-links */
import { getPubkey, getDisplayName, signAction, makeInvoice, payInvoice, inFedi, generateDevKey } from './fedi.js';

/* ── State ── */
let ME=null, MENAME=null, COMMUNITY=null, ALL_COMMUNITIES=[];

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
const short = pk => pk ? pk.slice(0, 5) + '…' + pk.slice(-4) : '—';
const fmt = n => (n || 0).toLocaleString();
const fmtS = n => fmt(n) + ' sats';
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
  { id: 'painting',  label: '🎨 Painting',     cls: 'tag-paint' },
  { id: 'repair',    label: '🔧 Repair',       cls: 'tag-repair' },
  { id: 'build',     label: '🏗️ Build',        cls: 'tag-build' },
  { id: 'signage',   label: '🪧 Signage',      cls: 'tag-signage' },
  { id: 'electrical',label: '⚡ Electrical',   cls: 'tag-electrical' },
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
  return c ? c.name : (id ? id.charAt(0).toUpperCase() + id.slice(1) : '—');
}

/* ── Router ── */
function go(hash) { location.hash = hash; }
window.addEventListener('hashchange', route);

function route() {
  const app = $('app');
  app.innerHTML = '';
  const h = location.hash.slice(1) || '/';
  resolveCommunity();
  if (h === '/philosophy') { renderPhilosophy(); return; }
  if (!COMMUNITY) { renderPicker(); return; }
  if (!ME) { renderSignIn(); return; }
  if (h === '/' || h === '/open') renderHome('open');
  else if (h === '/all') renderHome(null);
  else if (h === '/new') renderNew();
  else if (h === '/leaderboard') renderLeaderboard();
  else if (h.startsWith('/b/')) renderDetail(h.slice(3));
  else renderHome('open');
}

/* ── Header ── */
function renderHeader() {
  const hd = $('header-inner');
  hd.innerHTML = '';

  const orb = h('span', 'orb');
  orb.appendChild(makeBrandOrb());
  const brand = h('a', 'brand', orb, DIV('word', h('div', 'name', 'my two sats'), h('div', 'tag', 'community bounty board')));
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
    const b = BTN(on ? 'on' : '', label, () => go(href));
    return b;
  };
  wrap.appendChild(mk('Open', '/open', active === 'open'));
  wrap.appendChild(mk('All', '/all', active === 'all'));
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
    h('div', 'help-step', h('span', 'num', '1'), h('div', '', h('b', '', 'Someone posts a need.'), ' — Paint the hall, fix the gate, clean the lot.')),
    h('div', 'help-step', h('span', 'num', '2'), h('div', '', h('b', '', 'Neighbours chip in sats.'), ' — Pledge a small amount. If the work gets done, you pay.')),
    h('div', 'help-step', h('span', 'num', '3'), h('div', '', h('b', '', 'A worker claims it.'), ' — They do the job and send proof.')),
    h('div', 'help-step', h('span', 'num', '4'), h('div', '', h('b', '', 'Pledgers pay up.'), ' — Everyone who promised sends sats to the worker.')),
    h('div', 'help-foot', 'No upfront escrow. You hold your own money until the work is done. If someone does not pay, the community remembers.')
  );
}


/* ================================================================
   HOME
   ================================================================ */
async function renderHome(filter) {
  const wrap = $('app');
  renderHeader();

  const stack = DIV('stack padded');
  stack.appendChild(DIV('', h('h1', 't1', 'Your neighbour needs something done.'), h('p', 'body', 'You need a few sats.')));
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
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;

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

  if (b.threshold_sats > 0) {
    card.appendChild(h('div', 'bar', h('i', '', { style: { width: pct + '%' } })));
    card.appendChild(h('div', 'b-nums', pct + '% of ' + fmtS(b.threshold_sats) + ' needed'));
  }

  return card;
}

/* ================================================================
   NEW BOUNTY
   ================================================================ */
function renderNew() {
  const w = $('app');
  renderHeader();

  const stack = DIV('stack padded');
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

  const fThresh = h('input', ''); fThresh.type = 'number'; fThresh.placeholder = '0 = anyone can claim right away';
  card.appendChild(h('label', 'field-label', 'Minimum pot (optional)')); card.appendChild(fThresh);

  const submit = BTN('btn', 'Post it', async () => {
    submit.disabled = true;
    try {
      const body = {
        title: fTitle.value.trim(), description: fDesc.value.trim(),
        category: fCat.value, threshold_sats: parseInt(fThresh.value) || 0,
        creator_pubkey: ME, display_name: MENAME, community_id: COMMUNITY,
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

  const lead = DIV('stack padded');
  lead.appendChild(backLink('/open', 'Open needs'));
  w.appendChild(lead);

  let b;
  try { ({ bounty: b } = await api('/bounties/' + id)); }
  catch { w.appendChild(emptyState('Not found', "That bounty doesn't exist in this community.")); return; }

  const myPledge = b.pledges.find(p => p.pledger_pubkey === ME);
  const isWorker = b.worker_pubkey === ME;
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;

  const cat = CAT_MAP[b.category] || CAT_MAP.other;

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  // title block
  const titleBlock = DIV('stack-sm padded');
  titleBlock.appendChild(h('span', 'tag ' + cat.cls, cat.label));
  titleBlock.appendChild(h('h1', 't2', esc(b.title)));
  bodyStack.appendChild(titleBlock);

  // description
  bodyStack.appendChild(DIV('card', h('div', '', esc(b.description))));

  // pot card
  const pot = DIV('card');
  pot.appendChild(DIV('b-row',
    h('span', 'b-nums', h('span', 'big', fmt(b.pot_sats)), ' sats'),
    h('span', 'tag-status tag-' + b.status, esc({ open: 'Open', claimed: 'Claimed', proof_submitted: 'Proof sent', settled: 'Done' }[b.status] || b.status))
  ));
  if (b.effective_pot_sats !== b.pot_sats)
    pot.appendChild(h('div', 'b-nums', '~' + fmt(b.effective_pot_sats) + ' trusted pot'));
  if (b.threshold_sats > 0) {
    pot.appendChild(h('div', 'bar', h('i', '', { style: { width: pct + '%' } })));
    pot.appendChild(h('div', 'b-nums', pct + '% of ' + fmtS(b.threshold_sats) + ' needed'));
  }
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

  // Actions — open
  if (b.status === 'open') {
    const pledgeCard = DIV('card');
    pledgeCard.appendChild(h('div', 'overline', 'Your pledge'));
    pledgeCard.appendChild(hint('You are promising to pay if a worker does the job. Your sats stay in your wallet until then.'));
    const pAmt = h('input', ''); pAmt.type = 'number'; pAmt.placeholder = 'e.g. 5000'; if (myPledge) pAmt.value = myPledge.amount_sats;
    pledgeCard.appendChild(pAmt);

    const pBtn = BTN('btn', myPledge ? 'Update pledge' : 'Pledge', async () => {
      const amt = parseInt(pAmt.value); if (!amt || amt < 1) return toast('Enter an amount', true);
      const sig = await signAction('Pledge', { kind: 'm2s-pledge', bounty: b.id });
      await api(`/bounties/${id}/pledge`, { method: 'POST', body: { pledger_pubkey: ME, display_name: MENAME, amount_sats: amt, community_id: COMMUNITY, ...sig } });
      toast('Pledged.'); renderDetail(id);
    });
    pledgeCard.appendChild(DIV('gap-1', pBtn));
    bodyStack.appendChild(pledgeCard);

    if (!isWorker && !myPledge) {
      const canClaim = b.threshold_sats === 0 || b.pot_sats >= b.threshold_sats;
      const claimCard = DIV('card');
      claimCard.appendChild(h('div', 'overline', 'Do the work'));
      claimCard.appendChild(hint('Claim this job, do the work, then send proof. The pledgers will pay you.'));
      claimCard.appendChild(BTN('btn btn-ghost', canClaim ? "🙋 I'll do this" : 'Need ' + fmtS(Math.max(0, b.threshold_sats - b.pot_sats)) + ' more', async () => {
        if (!canClaim) return;
        const sig = await signAction('Claim', { kind: 'm2s-claim', bounty: b.id });
        await api(`/bounties/${id}/claim`, { method: 'POST', body: { worker_pubkey: ME, display_name: MENAME, community_id: COMMUNITY, ...sig } });
        toast('Claimed.'); renderDetail(id);
      }));
      bodyStack.appendChild(claimCard);
    }
  }

  // Actions — claimed (worker proof)
  if (b.status === 'claimed' && isWorker) {
    const pf = DIV('card');
    pf.appendChild(h('div', 'overline', 'Submit proof'));
    pf.appendChild(hint('Take a photo of the finished work and paste your Lightning invoice so the pledgers can pay you.'));
    const pImg = h('input', ''); pImg.type = 'file'; pImg.accept = 'image/*'; pf.appendChild(pImg);
    pf.appendChild(h('label', 'field-label', 'Note (optional)'));
    const pNote = h('textarea', ''); pNote.placeholder = 'What did you do?'; pf.appendChild(pNote);
    pf.appendChild(h('label', 'field-label', 'Lightning invoice'));
    const pInv = h('input', ''); pInv.placeholder = 'Your wallet makes this'; pf.appendChild(pInv);
    pf.appendChild(DIV('gap-1',
      BTN('btn', 'Submit proof', async () => {
        let b64 = null; if (pImg.files[0]) b64 = await readFile(pImg.files[0]);
        await api(`/bounties/${id}/proof`, { method: 'POST', body: { image_base64: b64, proof_note: pNote.value.trim(), worker_invoice: pInv.value.trim(), community_id: COMMUNITY } });
        toast('Proof sent.'); renderDetail(id);
      })
    ));
    bodyStack.appendChild(pf);
  }

  // Actions — proof submitted
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
      pay.appendChild(h('div', 'overline', 'Your turn'));
      pay.appendChild(h('div', 'b-desc', 'You pledged ' + fmtS(myPledge.amount_sats) + '. The work is done.'));
      pay.appendChild(hint('Tap Pay to send sats from your Lightning wallet to the worker. You promised — now you keep your word. If the work is bad, use Flag instead.'));
      pay.appendChild(DIV('stack-xs',
        BTN('btn', 'Pay ' + fmtS(myPledge.amount_sats), async () => {
          if (!b.worker_invoice) return toast('No invoice yet.', true);
          const preimage = await payInvoice(b.worker_invoice);
          await api(`/pledges/${myPledge.id}/pay`, { method: 'POST', body: { preimage } });
          toast('Paid.'); renderDetail(id);
        }),
        BTN('btn btn-ghost', 'Flag as bad', async () => {
          await api(`/bounties/${id}/flag`, { method: 'POST', body: { flagger_pubkey: ME, target_pubkey: b.worker_pubkey, reason: 'bad work' } });
          toast('Flagged.'); renderDetail(id);
        })
      ));
      bodyStack.appendChild(pay);
    }
    if (b.creator_pubkey === ME) {
      const settleCard = DIV('card');
      settleCard.appendChild(h('div', 'overline', 'Close it out'));
      settleCard.appendChild(hint('This marks the bounty done. Any pledgers who have not paid yet will get off the hook.'));
      settleCard.appendChild(BTN('btn btn-ghost', 'Close bounty', async () => {
        await api(`/bounties/${id}/settle`, { method: 'POST', body: { community_id: COMMUNITY } });
        toast('Settled.'); renderDetail(id);
      }));
      bodyStack.appendChild(settleCard);
    }
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

  const lead = DIV('stack padded');
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

  const lead = DIV('stack padded');
  lead.appendChild(backLink('/open', 'Open needs'));
  lead.appendChild(h('h1', 't1', 'Community heroes'));
  lead.appendChild(h('p', 'body', 'The people who show up — and the people who pay up.'));
  w.appendChild(lead);

  const bodyStack = DIV('stack');
  w.appendChild(bodyStack);

  try {
    const lb = await api('/leaderboards');

    bodyStack.appendChild(h('div', 'overline', 'Hardest workers'));
    if (!lb.topWorkers.length) bodyStack.appendChild(emptyState('No jobs done yet.', 'Be the first.'));
    else lb.topWorkers.forEach((r, i) => bodyStack.appendChild(rankRow(i + 1, short(r.pubkey), r.jobs + ' done', i === 0)));

    bodyStack.appendChild(h('div', 'overline overline-pad', 'Most generous'));
    if (!lb.topFunders.length) bodyStack.appendChild(emptyState('No payments yet.', 'Back someone\'s work.'));
    else lb.topFunders.forEach((r, i) => bodyStack.appendChild(rankRow(i + 1, short(r.pubkey), fmtS(r.sats), i === 0)));
  } catch (e) { bodyStack.appendChild(emptyState('Error', e.message)); }
}

function rankRow(pos, addr, right, gold) {
  return DIV('rank', h('span', 'n' + (gold ? ' gold' : ''), '#' + pos), h('span', 'a', addr), h('span', 'r', right));
}

/* ================================================================
   COMMUNITY PICKER
   ================================================================ */
async function renderPicker() {
  await loadCommunities();
  const w = $('app');
  renderHeader();

  const lead = DIV('stack padded');
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
    const ban = h('div', 'dev-banner', 'Dev mode — open in Fedi app for real Lightning + Nostr.');
    document.querySelector('main').prepend(ban);
  }
  route();
})();
