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
  return null; // no silent fallback — caller must handle
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

// --- Payments ---
// Worker creates an invoice (their wallet receives). Used at proof time.
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
// Returns { preimage: string } or throws with user-friendly message.
export async function payInvoice(bolt11) {
  if (window.webln?.sendPayment) {
    await window.webln.enable();
    const r = await window.webln.sendPayment(bolt11);
    return r.preimage;
  }
  throw new Error('NO_WEBLN');
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
