/* my two sats — clean, professional UI
   Design system: atomic classes, no innerHTML soup, intentional spacing. */

import { getPubkey, getDisplayName, signAction, makeInvoice, payInvoice, inFedi } from './fedi.js';

/* ── State ────────────────────────────────────────────── */
let ME=null, MENAME=null, COMMUNITY=null, ALL_COMMUNITIES=[];
const $ = id => document.getElementById(id);
const appEl = () => $('app');
const headerEl = () => $('header-inner');
let currentCleanup = null; // function to call before re-render

/* ── DOM helpers ──────────────────────────────────────── */
const E = (tag, cls='', ...children) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  children.forEach(c => {
    if (c == null) return;
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  });
  return el;
};
const DIV = (cls, ...ch) => E('div', cls, ...ch);
const A = (href, cls, ...ch) => { const a=E('a',cls,...ch); a.href=href; return a; };
const BTN = (cls, text, onClick) => { const b=E('button',cls,text); if(onClick)b.onclick=onClick; return b; };
const esc = s => String(s||'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const short = pk => pk ? pk.slice(0,5)+'…'+pk.slice(-4) : '—';
const fmtSats = n => (n||0).toLocaleString()+' sats';
const fmtNum = n => (n||0).toLocaleString();

/* ── SVG ── */
const B_LOGO = E('svg','',{width:18,height:18,viewBox:'0 0 24 24',fill:'none'});
B_LOGO.innerHTML = '<circle cx="12" cy="12" r="11" fill="#fff"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="800" fill="#FF9419">₿</text>';

/* ── Toast ── */
function toast(msg, err=false) {
  const t = E('div', 'toast'+(err?' err':''), msg);
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}

/* ── API ── */
const api = async (path, opts={}) => {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch('/api'+path+sep+'community='+encodeURIComponent(COMMUNITY||'default'), {
    headers:{'Content-Type':'application/json'}, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(()=>({}));
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
  localStorage.setItem('m2s_community', id);
  const u = new URL(location.href);
  if (id) u.searchParams.set('community', id); else u.searchParams.delete('community');
  history.replaceState(null, '', u.toString());
}
async function loadCommunities() {
  try { ALL_COMMUNITIES = (await api('/communities')).communities || []; }
  catch { ALL_COMMUNITIES = [{id:'default',name:'Sandbox'}]; }
}
function communityName(id) {
  const c = ALL_COMMUNITIES.find(x=>x.id===id);
  return c ? c.name : (id ? id.charAt(0).toUpperCase()+id.slice(1) : '—');
}

/* ── Router ── */
function navigate(hash) { location.hash = hash; }
window.addEventListener('hashchange', route);

function route() {
  if (currentCleanup) { currentCleanup(); currentCleanup=null; }
  if (!COMMUNITY) { renderPicker(); return; }
  const h = location.hash.slice(1) || '/';
  if (h==='/'||h==='/open') renderHome('open');
  else if (h==='/all') renderHome(null);
  else if (h==='/new') renderNew();
  else if (h==='/leaderboard') renderLeaderboard();
  else if (h.startsWith('/b/')) renderDetail(h.slice(3));
  else renderHome('open');
}

/* ── Header ── */
function renderHeader() {
  const el = headerEl();
  el.innerHTML = '';

  const brand = A('#/', 'brand',
    E('span','circle', B_LOGO.cloneNode(true)),
    DIV('word', E('div','name','my two sats'), E('div','tag','community bounty board'))
  );
  brand.onclick = e => { if (e.button===0) { navigate('/'); return false; }};
  el.appendChild(brand);

  const meta = DIV('header-meta');
  if (inFedi() && ME) {
    meta.appendChild(E('div','name', esc(MENAME||short(ME))));
    meta.appendChild(E('div','code', short(ME)));
  } else if (COMMUNITY) {
    const badge = DIV('badge', communityName(COMMUNITY));
    const change = A('#','', 'change');
    change.style = 'margin-left:6px;color:var(--ink-muted);font-size:10px;text-decoration:none';
    change.onclick = e => { e.preventDefault(); setCommunity(null); navigate('/'); };
    badge.appendChild(change);
    meta.appendChild(badge);
  }
  el.appendChild(meta);
}

/* ── Tabs ── */
function makeTabs(active) {
  const wrap = DIV('pill-tabs');
  const mk = (label, href, isActive) => {
    const a = A('#'+href, isActive?'active':'', label);
    a.onclick = e => { navigate(href); return false; };
    return a;
  };
  wrap.appendChild(mk('Open','/open', active==='open'));
  wrap.appendChild(mk('All','/all', active==='all'));
  wrap.appendChild(mk('🏆','/leaderboard', active==='leaderboard'));
  return wrap;
}

/* ── Back link ── */
function backLink(href, text) {
  const a = A('#'+href, 'btn btn-ghost btn-sm', '← '+text);
  a.onclick = e => { navigate(href); return false; };
  return a;
}

/* ── Empty state ── */
function emptyState(title, body) {
  return DIV('empty', E('strong','',title), body);
}

/* ================================================================
   Views
   ================================================================ */

/* ---- Home ---- */
async function renderHome(statusFilter) {
  const root = appEl();
  root.innerHTML = '';
  renderHeader();

  const hero = DIV('hero section', E('h1','','Your neighbour needs something done.'), E('p','','You need a few sats.'));
  root.appendChild(hero);
  root.appendChild(makeTabs(statusFilter==='open'?'open':'all'));

  let list;
  try {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const {bounties} = await api('/bounties'+qs);

    list = DIV('');
    if (!bounties.length) {
      list.appendChild(emptyState('Nothing here yet.', 'Be the first to post a need in '+communityName(COMMUNITY)));
    } else {
      bounties.forEach(b => list.appendChild(makeCard(b)));
    }
  } catch(e) {
    list = DIV(''); list.appendChild(emptyState('Could not load.', e.message));
  }
  root.appendChild(list);

  const fab = BTN('fab', '+ Post a need', ()=>navigate('/new'));
  root.appendChild(fab);
}

function makeCard(b) {
  const c = {cleanup:'tag-cleanup',painting:'tag-paint',repair:'tag-repair',other:'tag-other'}[b.category]||'tag-other';
  const lbl = {cleanup:'🧹 Cleanup',painting:'🎨 Painting',repair:'🔧 Repair',other:'📝 Other'}[b.category]||'Other';
  const pct = b.threshold_sats>0 ? Math.min(100, Math.round(b.pot_sats/b.threshold_sats*100)) : 0;

  const el = A('#/b/'+b.id, 'card card-interactive');
  el.onclick = e => { navigate('/b/'+b.id); return false; };

  const top = DIV('row-btw',
    E('span','tag '+c, esc(lbl)),
    E('span','tag-status tag-'+b.status, esc({open:'Open',claimed:'Claimed',proof_submitted:'Proof sent',settled:'Done',cancelled:'Cancelled',expired:'Expired'}[b.status]||b.status))
  );

  el.appendChild(top);
  el.appendChild(E('div','bounty-title', esc(b.title)));
  el.appendChild(E('div','bounty-desc', esc(b.description)));

  const meta = DIV('row-btw',
    DIV('amount',
      E('div','', E('span','val',fmtNum(b.pot_sats)), ' ', E('span','unit','sats pledged')),
      b.effective_pot_sats!==b.pot_sats ? E('div','sub','~'+fmtNum(b.effective_pot_sats)+' trusted') : null
    ),
    E('span','bounty-meta', b.pledges.length+' pledge'+(b.pledges.length!==1?'s':''))
  );
  el.appendChild(meta);

  if (b.threshold_sats>0) {
    el.appendChild(DIV('progress', E('div','', {style:`width:${pct}%`})));
    el.appendChild(E('div','bounty-meta', pct+'% of '+fmtSats(b.threshold_sats)+' needed'));
  }

  return el;
}

/* ---- New ---- */
function renderNew() {
  const root = appEl();
  root.innerHTML = '';
  renderHeader();

  root.appendChild(DIV('section', backLink('/open','Open needs')));
  root.appendChild(DIV('hero', E('h1','page-title','What needs doing?'), E('p','lede','Describe it like you\'re telling a neighbour.')));

  const card = DIV('card');
  card.appendChild(E('label','field-label','What is it?'));
  const fTitle = E('input',''); fTitle.placeholder='e.g. Clean up the lot behind the rec centre'; fTitle.maxLength=200; fTitle.autocomplete='off'; card.appendChild(fTitle);

  card.appendChild(E('label','field-label','Tell the story'));
  const fDesc = E('textarea',''); fDesc.placeholder="What's the situation? What does 'done' look like?"; card.appendChild(fDesc);

  card.appendChild(E('label','field-label','Category'));
  const fCat = E('select','');
  [['cleanup','🧹 Cleanup'],['painting','🎨 Painting'],['repair','🔧 Repair'],['other','📝 Other']].forEach(([v,l])=>{
    const o=document.createElement('option'); o.value=v; o.textContent=l; fCat.appendChild(o);
  });
  card.appendChild(fCat);

  card.appendChild(E('label','field-label','Minimum pot to start (optional)'));
  const fThresh = E('input',''); fThresh.type='number'; fThresh.placeholder='0 = anyone can claim right away'; card.appendChild(fThresh);

  const submit = BTN('btn','Post it', async () => {
    submit.disabled = true;
    try {
      const body = {
        title: fTitle.value.trim(), description: fDesc.value.trim(),
        category: fCat.value, threshold_sats: parseInt(fThresh.value)||0,
        creator_pubkey: ME, display_name: MENAME, community_id: COMMUNITY,
      };
      if (!body.title || !body.description) throw new Error('Need a title and story.');
      const {bounty} = await api('/bounties', {method:'POST', body});
      toast('Posted.'); navigate('/b/'+bounty.id);
    } catch(e){ toast(e.message,true); submit.disabled=false; }
  });
  card.appendChild(DIV('', {style:'margin-top:18px'}, submit));
  root.appendChild(card);
}

/* ---- Detail ---- */
async function renderDetail(id) {
  const root = appEl();
  root.innerHTML = '';
  renderHeader();
  root.appendChild(DIV('section', backLink('/open','Open needs')));

  let b;
  try { ({bounty:b} = await api('/bounties/'+id)); }
  catch { root.appendChild(emptyState('Not found','That bounty doesn\'t exist in this community.')); return; }

  const myPledge = b.pledges.find(p=>p.pledger_pubkey===ME);
  const isWorker = b.worker_pubkey===ME;
  const pct = b.threshold_sats>0 ? Math.min(100, Math.round(b.pot_sats/b.threshold_sats*100)) : 0;

  // Title + cat
  const cCls = {cleanup:'tag-cleanup',painting:'tag-paint',repair:'tag-repair',other:'tag-other'}[b.category]||'tag-other';
  const cLbl={cleanup:'🧹 Cleanup',painting:'🎨 Painting',repair:'🔧 Repair',other:'📝 Other'}[b.category]||'Other';
  root.appendChild(E('span','tag '+cCls, cLbl));
  root.appendChild(E('h1','page-title', {style:'margin-top:10px'}, esc(b.title)));

  // Description card
  root.appendChild(DIV('card', E('div','',{style:'font-size:15px;line-height:1.6'}, esc(b.description))));

  // Pot card
  const pot = DIV('card');
  pot.appendChild(DIV('row-btw',
    DIV('amount', E('div','', E('span','val',fmtNum(b.pot_sats)), ' ', E('span','unit','sats'))),
    E('span','tag-status tag-'+b.status, esc({open:'Open',claimed:'Claimed',proof_submitted:'Proof sent',settled:'Done',cancelled:'Cancelled',expired:'Expired'}[b.status]||b.status))
  ));
  if (b.effective_pot_sats!==b.pot_sats)
    pot.appendChild(E('div','',{style:'margin-top:6px;font-size:13px;color:var(--ink-muted)'}, '~'+fmtNum(b.effective_pot_sats)+' trusted pot'));
  if (b.threshold_sats>0) {
    pot.appendChild(DIV('progress', E('div','',{style:`width:${pct}%`})));
    pot.appendChild(E('div','bounty-meta', pct+'% of '+fmtSats(b.threshold_sats)+' needed'));
  }
  // Pledge list
  if (b.pledges.length) {
    const pl = DIV('pledge-list');
    b.pledges.forEach(p=>{
      pl.appendChild(DIV('pledge-entry',
        DIV('who', p.status==='paid'?E('span','badge-paid','paid'):null, E('span','addr',short(p.pledger_pubkey))),
        E('span','amt', fmtSats(p.amount_sats))
      ));
    });
    pot.appendChild(pl);
  }
  root.appendChild(pot);

  // Actions
  if (b.status==='open') {
    const pledgeCard = DIV('card');
    pledgeCard.appendChild(E('div','overline','Your pledge'));
    const pAmt = E('input',''); pAmt.type='number'; pAmt.placeholder='e.g. 5000'; if (myPledge) pAmt.value=myPledge.amount_sats;
    pledgeCard.appendChild(pAmt);
    const pBtn = BTN('btn', myPledge?'Update pledge':'Pledge', async ()=>{
      const amt=parseInt(pAmt.value); if (!amt||amt<1) return toast('Enter an amount',true);
      const sig=await signAction('Pledge',{kind:'m2s-pledge',bounty:b.id});
      await api(`/bounties/${id}/pledge`,{method:'POST',body:{pledger_pubkey:ME,display_name:MENAME,amount_sats:amt,community_id:COMMUNITY,...sig}});
      toast('Pledged.'); renderDetail(id);
    });
    pledgeCard.appendChild(DIV('',{style:'margin-top:12px'}, pBtn));
    root.appendChild(pledgeCard);

    if (!isWorker && !myPledge) {
      const canClaim = b.threshold_sats===0 || b.pot_sats>=b.threshold_sats;
      root.appendChild(BTN('btn btn-ghost', canClaim?"🙋 I'll do this":`Need ${fmtSats(Math.max(0,b.threshold_sats-b.pot_sats))} more`, async ()=>{
        if (!canClaim) return;
        const sig=await signAction('Claim',{kind:'m2s-claim',bounty:b.id});
        await api(`/bounties/${id}/claim`,{method:'POST',body:{worker_pubkey:ME,display_name:MENAME,community_id:COMMUNITY,...sig}});
        toast('Claimed. Go build.'); renderDetail(id);
      }));
    }
  }

  if (b.status==='claimed' && isWorker) {
    const pf = DIV('card');
    pf.appendChild(E('div','overline','Submit proof'));
    const pImg = E('input',''); pImg.type='file'; pImg.accept='image/*';
    pf.appendChild(pImg);
    pf.appendChild(E('label','field-label','Note (optional)'));
    const pNote = E('textarea',''); pNote.placeholder='What did you do?'; pf.appendChild(pNote);
    pf.appendChild(E('label','field-label','Lightning invoice'));
    const pInv = E('input',''); pInv.placeholder='Your wallet makes this'; pf.appendChild(pInv);
    pf.appendChild(DIV('',{style:'margin-top:14px'},
      BTN('btn','Submit proof', async ()=>{
        let b64=null; if (pImg.files[0]) b64=await readFile(pImg.files[0]);
        await api(`/bounties/${id}/proof`,{method:'POST',body:{image_base64:b64,proof_note:pNote.value.trim(),worker_invoice:pInv.value.trim(),community_id:COMMUNITY}});
        toast('Proof sent.'); renderDetail(id);
      })
    ));
    root.appendChild(pf);
  }

  if (b.status==='proof_submitted') {
    if (b.proof_image || b.proof_note) {
      const pr = DIV('card');
      pr.appendChild(E('div','overline','Proof of work'));
      if (b.proof_note) pr.appendChild(E('div','',{style:'margin-bottom:12px'}, esc(b.proof_note)));
      if (b.proof_image) { const img=E('img',''); img.src=b.proof_image; img.style='border-radius:10px;width:100%;'; pr.appendChild(img); }
      root.appendChild(pr);
    }
    if (myPledge && myPledge.status==='pledged') {
      const pay = DIV('card');
      pay.appendChild(E('div','overline','Your turn'));
      pay.appendChild(E('div','',{style:'margin-bottom:14px;font-size:14px;color:var(--ink-dim)'}, `You pledged ${fmtSats(myPledge.amount_sats)}. The work is done.`));
      pay.appendChild(DIV('row',
        BTN('btn','Pay '+fmtSats(myPledge.amount_sats), async ()=>{
          if (!b.worker_invoice) return toast('No invoice yet.',true);
          const preimage = await payInvoice(b.worker_invoice);
          await api(`/pledges/${myPledge.id}/pay`,{method:'POST',body:{preimage}});
          toast('Paid.'); renderDetail(id);
        }),
        BTN('btn btn-ghost','Flag', async ()=>{
          await api(`/bounties/${id}/flag`,{method:'POST',body:{flagger_pubkey:ME,target_pubkey:b.worker_pubkey,reason:'bad work'}});
          toast('Flagged.'); renderDetail(id);
        })
      ));
      root.appendChild(pay);
    }
    if (b.creator_pubkey===ME) {
      root.appendChild(BTN('btn btn-ghost','Close bounty', async ()=>{
        await api(`/bounties/${id}/settle`,{method:'POST',body:{community_id:COMMUNITY}});
        toast('Settled.'); renderDetail(id);
      }));
    }
  }
}

function readFile(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
}

/* ---- Leaderboard ---- */
async function renderLeaderboard() {
  const root = appEl();
  root.innerHTML = '';
  renderHeader();
  root.appendChild(DIV('section', backLink('/open','Open needs')));
  root.appendChild(E('h1','page-title','Community heroes'));
  root.appendChild(E('p','lede','The people who show up — and the people who pay up.'));

  try {
    const lb = await api('/leaderboards');
    root.appendChild(E('div','overline','Hardest workers'));
    if (!lb.topWorkers.length) root.appendChild(DIV('card card-flat', emptyState('No jobs done yet.','Be the first.')));
    else lb.topWorkers.forEach((w,i)=>root.appendChild(rankRow(i+1, short(w.pubkey), w.jobs+' done', i===0?'gold':'')));

    root.appendChild(E('div','overline',{style:'margin-top:20px'},'Most generous'));
    if (!lb.topFunders.length) root.appendChild(DIV('card card-flat', emptyState('No payments yet.','Back someone\'s work.')));
    else lb.topFunders.forEach((f,i)=>root.appendChild(rankRow(i+1, short(f.pubkey), fmtSats(f.sats), i===0?'gold':'')));
  } catch(e){ root.appendChild(emptyState('Error',e.message)); }
}

function rankRow(pos, addr, right, cls='') {
  return DIV('rank', E('span','num '+cls, '#'+pos), E('span','addr truncate', addr), E('span','right', right));
}

/* ---- Community picker ---- */
async function renderPicker() {
  const root = appEl();
  root.innerHTML = '';
  await loadCommunities();

  root.appendChild(E('h1','page-title',{style:'margin-bottom:6px'},'Join a community'));
  root.appendChild(E('p','lede','Each community has its own bounties and leaderboard.'));

  if (ALL_COMMUNITIES.length) {
    ALL_COMMUNITIES.forEach(c=>{
      const el = A('#','card card-interactive');
      el.appendChild(E('div','',{style:'font-weight:700;font-size:16px'}, esc(c.name)));
      el.appendChild(E('div','',{style:'font-size:13px;color:var(--ink-muted);margin-top:2px'}, esc(c.region || c.id)));
      el.onclick = e => { e.preventDefault(); setCommunity(c.id); navigate('/'); };
      root.appendChild(el);
    });
  }

  const create = DIV('card');
  create.appendChild(E('div','overline','Start a new community'));
  const cId = E('input',''); cId.placeholder='URL-friendly ID, e.g. bitcoin-ekasi'; create.appendChild(cId);
  create.appendChild(E('label','field-label','Name'));
  const cName = E('input',''); cName.placeholder='Mytown Bitcoin Crew'; create.appendChild(cName);
  create.appendChild(E('label','field-label','Region (optional)'));
  const cReg = E('input',''); cReg.placeholder='Mossel Bay, South Africa'; create.appendChild(cReg);
  create.appendChild(E('label','field-label','Description'));
  const cDesc = E('textarea',''); cDesc.placeholder='What makes this community unique?'; create.appendChild(cDesc);

  create.appendChild(DIV('',{style:'margin-top:14px'},
    BTN('btn','Create', async ()=>{
      const body={id:cId.value.trim().toLowerCase(),name:cName.value.trim(),region:cReg.value.trim()||null,description:cDesc.value.trim()||null,admin_pubkey:ME,admin_display_name:MENAME};
      if (!body.id||!body.name) return toast('Need ID and name',true);
      const {community} = await api('/communities',{method:'POST',body});
      setCommunity(community.id); toast('Created.'); navigate('/');
    })
  ));
  root.appendChild(create);
}

/* ── Boot ── */
(async function boot() {
  resolveCommunity();
  if (!COMMUNITY && !localStorage.getItem('m2s_community') && !new URLSearchParams(location.search).has('community')) {
    renderPicker(); return;
  }
  try {
    ME = await getPubkey();
    MENAME = await getDisplayName();
  } catch {}
  if (!inFedi()) {
    const ban = E('div','dev-banner','Dev mode — open in Fedi app for real Lightning + Nostr.');
    document.querySelector('main').prepend(ban);
  }
  route();
})();
