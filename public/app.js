/* my two sats — UI that does not overlap */
import { getPubkey, getDisplayName, signAction, makeInvoice, payInvoice, inFedi } from './fedi.js';

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
    else if (typeof k === 'object' && k.innerHTML) e.innerHTML = k.innerHTML;
  });
  return e;
}

const DIV = (cls, ...ch) => h('div', cls, ...ch);
const A = (href, cls, ...ch) => { const a = h('a', cls, ...ch); a.href = href; return a; };
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

/* ── SVG logo ── */
const B_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#fff"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" fill="#FF9419">₿</text></svg>`;

/* ── API ── */
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
  if (!COMMUNITY) { renderPicker(); return; }
  const h = location.hash.slice(1) || '/';
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

  const brand = A('#/', 'brand',
    h('span', 'orb', DIV('', { innerHTML: B_SVG })),
    DIV('word', h('div', 'name', 'my two sats'), h('div', 'tag', 'community bounty board'))
  );
  brand.onclick = e => { if (e.button === 0) { go('/'); return false; }};
  hd.appendChild(brand);

  const meta = DIV('header-meta');
  if (inFedi() && ME) {
    meta.appendChild(h('div', 'up', esc(MENAME || short(ME))));
    meta.appendChild(h('div', 'down', short(ME)));
  } else if (COMMUNITY) {
    const badge = DIV('badge', cName(COMMUNITY));
    const change = A('#', '', 'change');
    change.style.cssText = 'margin-left:5px;font-size:10px;text-decoration:none;color:inherit;opacity:.7';
    change.onclick = e => { e.preventDefault(); setCommunity(null); go('/'); };
    badge.appendChild(change);
    meta.appendChild(badge);
  }
  hd.appendChild(meta);
}

/* ── Shared components ── */
function makeTabs(active) {
  const wrap = DIV('pill-tabs');
  const mk = (label, href, on) => {
    const a = A('#' + href, on ? 'on' : '', label);
    a.onclick = e => { go(href); return false; };
    return a;
  };
  wrap.appendChild(mk('Open', '/open', active === 'open'));
  wrap.appendChild(mk('All', '/all', active === 'all'));
  wrap.appendChild(mk('🏆', '/leaderboard', active === 'leaderboard'));
  return wrap;
}

function backLink(href, text) {
  const a = A('#' + href, 'btn btn-ghost btn-sm', '← ' + text);
  a.onclick = e => { go(href); return false; };
  return a;
}

function emptyState(title, body) {
  return DIV('empty', h('b', '', title), body);
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

  let list;
  try {
    const qs = filter ? `?status=${filter}` : '';
    const { bounties } = await api('/bounties' + qs);
    list = DIV('');
    if (!bounties.length) {
      list.appendChild(emptyState('Nothing here yet.', 'Be the first to post a need.'));
    } else {
      bounties.forEach(b => list.appendChild(bountyCard(b)));
    }
  } catch (e) {
    list = DIV(''); list.appendChild(emptyState('Could not load.', e.message));
  }
  wrap.appendChild(list);

  const fab = BTN('fab', '+ Post a need', () => go('/new'));
  wrap.appendChild(fab);
}

function bountyCard(b) {
  const catCls = { cleanup: 'tag-cleanup', painting: 'tag-paint', repair: 'tag-repair', other: 'tag-other' }[b.category] || 'tag-other';
  const catLbl = { cleanup: '🧹 Cleanup', painting: '🎨 Painting', repair: '🔧 Repair', other: '📝 Other' }[b.category] || 'Other';
  const pct = b.threshold_sats > 0 ? Math.min(100, Math.round(b.pot_sats / b.threshold_sats * 100)) : 0;

  const card = A('#/b/' + b.id, 'card card-interactive');
  card.onclick = e => { go('/b/' + b.id); return false; };

  card.appendChild(DIV('b-row',
    h('span', 'tag ' + catCls, esc(catLbl)),
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

  const card = DIV('card');

  const fTitle = h('input', ''); fTitle.placeholder = 'e.g. Clean up the lot behind the rec centre'; fTitle.maxLength = 200;
  card.appendChild(h('label', 'field-label', 'What is it?')); card.appendChild(fTitle);

  const fDesc = h('textarea', ''); fDesc.placeholder = "What's the situation? What does 'done' look like?";
  card.appendChild(h('label', 'field-label', 'Tell the story')); card.appendChild(fDesc);

  const fCat = h('select', '');
  ['cleanup:🧹 Cleanup', 'painting:🎨 Painting', 'repair:🔧 Repair', 'other:📝 Other'].forEach(s => {
    const [v, l] = s.split(':'); const o = el('option'); o.value = v; o.textContent = l; fCat.appendChild(o);
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

  const catCls = { cleanup: 'tag-cleanup', painting: 'tag-paint', repair: 'tag-repair', other: 'tag-other' }[b.category] || 'tag-other';
  const catLbl = { cleanup: '🧹 Cleanup', painting: '🎨 Painting', repair: '🔧 Repair', other: '📝 Other' }[b.category] || 'Other';

  // title block
  const titleBlock = DIV('stack-sm');
  titleBlock.appendChild(h('span', 'tag ' + catCls, catLbl));
  titleBlock.appendChild(h('h1', 't2', esc(b.title)));
  w.appendChild(titleBlock);

  // description
  w.appendChild(DIV('card', h('div', '', esc(b.description))));

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
      pl.appendChild(DIV('pl-row',
        DIV('pl-who', p.status === 'paid' ? h('span', 'pl-paid', 'paid') : null, h('span', 'pl-addr', short(p.pledger_pubkey))),
        h('span', 'pl-amt', fmtS(p.amount_sats))
      ));
    });
    pot.appendChild(pl);
  }
  w.appendChild(pot);

  // Actions — open
  if (b.status === 'open') {
    const pledgeCard = DIV('card');
    pledgeCard.appendChild(h('div', 'overline', 'Your pledge'));
    const pAmt = h('input', ''); pAmt.type = 'number'; pAmt.placeholder = 'e.g. 5000'; if (myPledge) pAmt.value = myPledge.amount_sats;
    pledgeCard.appendChild(pAmt);

    const pBtn = BTN('btn', myPledge ? 'Update pledge' : 'Pledge', async () => {
      const amt = parseInt(pAmt.value); if (!amt || amt < 1) return toast('Enter an amount', true);
      const sig = await signAction('Pledge', { kind: 'm2s-pledge', bounty: b.id });
      await api(`/bounties/${id}/pledge`, { method: 'POST', body: { pledger_pubkey: ME, display_name: MENAME, amount_sats: amt, community_id: COMMUNITY, ...sig } });
      toast('Pledged.'); renderDetail(id);
    });
    pledgeCard.appendChild(DIV('gap-1', pBtn));
    w.appendChild(pledgeCard);

    if (!isWorker && !myPledge) {
      const canClaim = b.threshold_sats === 0 || b.pot_sats >= b.threshold_sats;
      w.appendChild(BTN('btn btn-ghost', canClaim ? "🙋 I'll do this" : 'Need ' + fmtS(Math.max(0, b.threshold_sats - b.pot_sats)) + ' more', async () => {
        if (!canClaim) return;
        const sig = await signAction('Claim', { kind: 'm2s-claim', bounty: b.id });
        await api(`/bounties/${id}/claim`, { method: 'POST', body: { worker_pubkey: ME, display_name: MENAME, community_id: COMMUNITY, ...sig } });
        toast('Claimed.'); renderDetail(id);
      }));
    }
  }

  // Actions — claimed (worker proof)
  if (b.status === 'claimed' && isWorker) {
    const pf = DIV('card');
    pf.appendChild(h('div', 'overline', 'Submit proof'));
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
    w.appendChild(pf);
  }

  // Actions — proof submitted
  if (b.status === 'proof_submitted') {
    if (b.proof_image || b.proof_note) {
      const pr = DIV('card');
      pr.appendChild(h('div', 'overline', 'Proof of work'));
      if (b.proof_note) pr.appendChild(h('div', '', esc(b.proof_note)));
      if (b.proof_image) { const img = h('img', ''); img.src = b.proof_image; style(img, { borderRadius: '8px', width: '100%', marginTop: '12px' }); pr.appendChild(img); }
      w.appendChild(pr);
    }
    if (myPledge && myPledge.status === 'pledged') {
      const pay = DIV('card');
      pay.appendChild(h('div', 'overline', 'Your turn'));
      pay.appendChild(h('div', 'b-desc', 'You pledged ' + fmtS(myPledge.amount_sats) + '. The work is done.'));
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
      w.appendChild(pay);
    }
    if (b.creator_pubkey === ME) {
      w.appendChild(BTN('btn btn-ghost', 'Close bounty', async () => {
        await api(`/bounties/${id}/settle`, { method: 'POST', body: { community_id: COMMUNITY } });
        toast('Settled.'); renderDetail(id);
      }));
    }
  }
}

function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

/* ================================================================
   LEADERBOARD
   ================================================================ */
async function renderLeaderboard() {
  const w = $('app');
  renderHeader();

  const lead = DIV('stack padded');
  lead.appendChild(backLink('/open', 'Open needs'));
  lead.appendChild(h('h1', 't1', 'Community heroes'));
  lead.appendChild(h('p', 'body', 'The people who show up — and the people who pay up.'));
  w.appendChild(lead);

  try {
    const lb = await api('/leaderboards');

    w.appendChild(h('div', 'overline overline-pad', 'Hardest workers'));
    if (!lb.topWorkers.length) w.appendChild(emptyState('No jobs done yet.', 'Be the first.'));
    else lb.topWorkers.forEach((r, i) => w.appendChild(rankRow(i + 1, short(r.pubkey), r.jobs + ' done', i === 0)));

    w.appendChild(h('div', 'overline overline-pad', 'Most generous'));
    if (!lb.topFunders.length) w.appendChild(emptyState('No payments yet.', 'Back someone\'s work.'));
    else lb.topFunders.forEach((r, i) => w.appendChild(rankRow(i + 1, short(r.pubkey), fmtS(r.sats), i === 0)));
  } catch (e) { w.appendChild(emptyState('Error', e.message)); }
}

function rankRow(pos, addr, right, gold) {
  return DIV('rank', h('span', 'n' + (gold ? ' gold' : ''), '#' + pos), h('span', 'a', addr), h('span', 'r', right));
}

/* ================================================================
   COMMUNITY PICKER
   ================================================================ */
async function renderPicker() {
  const w = $('app');
  await loadCommunities();

  const lead = DIV('stack padded');
  lead.appendChild(h('h1', 't1', 'Join a community'));
  lead.appendChild(h('p', 'body', 'Each community has its own bounties and leaderboard.'));
  w.appendChild(lead);

  ALL_COMMUNITIES.forEach(c => {
    const card = A('#', 'card card-interactive');
    card.appendChild(h('div', 'b-title', esc(c.name)));
    card.appendChild(h('div', 'b-desc', esc(c.region || c.id)));
    card.onclick = e => { e.preventDefault(); setCommunity(c.id); go('/'); };
    w.appendChild(card);
  });

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
      setCommunity(community.id); toast('Created.'); go('/');
    })
  ));
  w.appendChild(create);
}

/* ── Boot ── */
(async function boot() {
  resolveCommunity();
  if (!COMMUNITY && !localStorage.getItem('m2s_community') && !new URLSearchParams(location.search).has('community')) {
    renderPicker(); return;
  }
  try { ME = await getPubkey(); MENAME = await getDisplayName(); } catch {}
  if (!inFedi()) {
    const ban = h('div', 'dev-banner', 'Dev mode — open in Fedi app for real Lightning + Nostr.');
    document.querySelector('main').prepend(ban);
  }
  route();
})();
