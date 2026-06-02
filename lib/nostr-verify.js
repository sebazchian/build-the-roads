/**
 * Server-side Nostr event verification (nostr-tools)
 * Verifies both event-id hash and schnorr signature.
 */
import { verifyEvent } from 'nostr-tools';

/**
 * Verify a Nostr event. Optionally enforce that event.pubkey === expectedPubkey.
 * Returns { ok: boolean, error?: string }
 */
export function verifyNostrEvent(event, expectedPubkey = null) {
  if (!event || typeof event !== 'object') {
    return { ok: false, error: 'Missing event object' };
  }
  const required = ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'];
  for (const k of required) {
    if (!(k in event)) return { ok: false, error: `Event missing field: ${k}` };
  }
  if (!/^[0-9a-f]{64}$/i.test(event.pubkey)) {
    return { ok: false, error: 'Invalid pubkey in event' };
  }
  if (expectedPubkey && event.pubkey !== expectedPubkey) {
    return { ok: false, error: 'Event pubkey does not match expected pubkey' };
  }
  try {
    const valid = verifyEvent(event);
    if (!valid) return { ok: false, error: 'Signature or event hash invalid' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Verification error: ${e.message}` };
  }
}
