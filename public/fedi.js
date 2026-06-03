// Fedi mini-app bridge: WebLN + Nostr (NIP-07) with graceful fallback for normal browsers (dev).
// In Fedi, window.webln / window.nostr / window.fedi are injected automatically.

export const inFedi = () => typeof window !== 'undefined' && !!window.fedi;
export const hasWebLN = () => typeof window !== 'undefined' && !!window.webln;
export const hasNostr = () => typeof window !== 'undefined' && !!window.nostr?.getPublicKey;

const LS_KEY = 'm2s_dev_pubkey';

// --- Identity ---
export async function getPubkey() {
  if (window.nostr?.getPublicKey) {
    try { return await window.nostr.getPublicKey(); } catch (e) { console.warn('nostr.getPublicKey failed', e); }
  }
  return null; // no silent fallback  -  caller must handle
}

export function generateDevKey() {
  let pk = localStorage.getItem(LS_KEY);
  if (!pk) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    pk = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(LS_KEY, pk);
  }
  return pk;
}

export async function getDisplayName() {
  try {
    if (window.webln?.enable) { await window.webln.enable(); const i = await window.webln.getInfo(); return i?.node?.alias || null; }
  } catch {}
  return null;
}

// --- Provable action: sign a nostr event describing the action ---
export async function signAction(content, tags = []) {
  const event = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content };
  if (window.nostr?.signEvent) {
    try {
      const s = await window.nostr.signEvent(event);
      // Return full event so server can verifyEvent(id, pubkey, created_at, kind, tags, content, sig)
      return { sig_event: { id: s.id, pubkey: s.pubkey, created_at: s.created_at, kind: s.kind, tags: s.tags, content: s.content, sig: s.sig } };
    } catch (e) { console.warn('signEvent denied/failed', e); return {}; }
  }
  return {}; // dev: unsigned (server will warn and accept in dev)
}

// --- Lightning Address ---
// Get the worker's Lightning address from their wallet automatically.
// Priority: 1) Fedi webln.getInfo() lnAddress, 2) Alby lnAddress, 3) null (manual entry)
export async function getLightningAddress() {
  // Try WebLN (Fedi or Alby both expose webln.getInfo)
  if (window.webln?.getInfo) {
    try {
      await window.webln.enable();
      const info = await window.webln.getInfo();
      // Alby and Fedi both return node.alias, but Alby also returns lnAddress
      if (info?.lnAddress) return info.lnAddress;          // Alby
      if (info?.node?.lnAddress) return info.node.lnAddress; // Alby (alternate)
      if (info?.node?.alias && info.node.alias.includes('@')) return info.node.alias; // some wallets
    } catch (e) { console.warn('getLightningAddress: webln.getInfo failed', e); }
  }
  // Try window.fedi for ecash-based address
  if (window.fedi?.getActiveFederation) {
    try {
      const fed = await window.fedi.getActiveFederation();
      if (fed?.lnAddress) return fed.lnAddress;
    } catch (e) { console.warn('getLightningAddress: fedi.getActiveFederation failed', e); }
  }
  return null; // caller should show manual input field
}

// --- Payments ---
// Worker creates an invoice from a Lightning address (LNURL-pay / lightning: URI).
// Returns { invoice: string } or throws with user-friendly message.
export async function makeInvoice(amount, memo) {
  if (window.webln?.makeInvoice) {
    await window.webln.enable();
    const r = await window.webln.makeInvoice({ amount, defaultMemo: memo });
    return r.paymentRequest;
  }
  throw new Error('NO_WEBLN');
}

// Pledger pays a BOLT11 invoice. Returns preimage (proof of payment).
export async function payInvoice(bolt11) {
  if (window.webln?.sendPayment) {
    await window.webln.enable();
    const r = await window.webln.sendPayment(bolt11);
    return r.preimage;
  }
  throw new Error('NO_WEBLN');
}

// Resolve a Lightning address to a BOLT11 invoice for a given amount.
// Lightning address format: user@domain -> https://domain/.well-known/lnurlp/user
export async function resolveInvoiceFromAddress(lightningAddress, amountSats, memo) {
  // If WebLN supports sendPaymentAsync with lnurl, use it directly
  if (window.webln?.sendPayment) {
    try {
      await window.webln.enable();
      // Try paying the lightning address directly via WebLN (Alby supports this)
      const r = await window.webln.sendPayment('lightning:' + lightningAddress);
      return { preimage: r.preimage, via: 'webln-direct' };
    } catch (e) { /* fall through to LNURL fetch */ }
  }
  // Resolve via LNURL-pay HTTP fetch
  const [user, domain] = lightningAddress.split('@');
  if (!user || !domain) throw new Error('Invalid Lightning address: ' + lightningAddress);
  const lnurlMetaUrl = `https://${domain}/.well-known/lnurlp/${user}`;
  let meta;
  try {
    const resp = await fetch(lnurlMetaUrl);
    meta = await resp.json();
  } catch (e) { throw new Error('Could not reach Lightning address server for ' + domain); }
  if (meta.status === 'ERROR') throw new Error(meta.reason || 'Lightning address error');
  const amountMsats = amountSats * 1000;
  if (amountMsats < meta.minSendable || amountMsats > meta.maxSendable)
    throw new Error(`Amount out of range: ${meta.minSendable/1000}–${meta.maxSendable/1000} sats`);
  const cbUrl = meta.callback + '?amount=' + amountMsats + (memo ? '&comment=' + encodeURIComponent(memo) : '');
  let cbResp;
  try {
    const r = await fetch(cbUrl);
    cbResp = await r.json();
  } catch (e) { throw new Error('LNURL callback failed'); }
  if (cbResp.status === 'ERROR') throw new Error(cbResp.reason || 'LNURL callback error');
  return { invoice: cbResp.pr, via: 'lnurl' };
}

// --- Fallback helpers for UI ---
export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for older browsers / insecure contexts
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}
