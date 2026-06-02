// Fedi mini-app bridge: WebLN + Nostr (NIP-07) with graceful fallback for normal browsers (dev).
// In Fedi, window.webln / window.nostr / window.fedi are injected automatically.

export const inFedi = () => typeof window !== 'undefined' && !!window.fedi;

const LS_KEY = 'm2s_dev_pubkey';

// --- Identity ---
export async function getPubkey() {
  if (window.nostr?.getPublicKey) {
    try { return await window.nostr.getPublicKey(); } catch (e) { console.warn('nostr.getPublicKey failed', e); }
  }
  // Dev fallback: stable random pubkey-shaped hex per browser
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
    try { const s = await window.nostr.signEvent(event); return { sig_event_id: s.id, sig: s.sig }; }
    catch (e) { console.warn('signEvent denied/failed', e); return {}; }
  }
  return {}; // dev: unsigned
}

// --- Payments ---
// Worker creates an invoice (their wallet receives). Used at proof time.
export async function makeInvoice(amount, memo) {
  if (window.webln?.makeInvoice) {
    await window.webln.enable();
    const r = await window.webln.makeInvoice({ amount, defaultMemo: memo });
    return r.paymentRequest;
  }
  throw new Error('Lightning not available — open this in the Fedi app to receive payments.');
}

// Pledger pays a BOLT11 invoice. Returns preimage (proof of payment).
export async function payInvoice(bolt11) {
  if (window.webln?.sendPayment) {
    await window.webln.enable();
    const r = await window.webln.sendPayment(bolt11);
    return r.preimage;
  }
  throw new Error('Lightning not available — open this in the Fedi app to pay.');
}
