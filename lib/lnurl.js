/**
 * Server-side LNURL-pay resolution.
 * Resolves a Lightning address (user@domain) to a BOLT11 invoice for a given amount.
 * Pure HTTP; no wallet required.
 */

// Resolve Lightning address to BOLT11 invoice
// Returns { pr: string } or throws with user-friendly message
export async function resolveInvoiceFromAddress(lightningAddress, amountSats, memo) {
  const [user, domain] = lightningAddress.split('@');
  if (!user || !domain) throw new Error('Invalid Lightning address format');
  const metaUrl = `https://${domain}/.well-known/lnurlp/${user}`;
  let meta;
  try {
    const resp = await fetch(metaUrl, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`LNURL server returned ${resp.status}`);
    meta = await resp.json();
  } catch (e) {
    throw new Error(`Cannot reach Lightning address server: ${e.message}`);
  }
  if (meta.status === 'ERROR') throw new Error(meta.reason || 'Lightning address error');
  const amountMsats = amountSats * 1000;
  if (amountMsats < meta.minSendable || amountMsats > meta.maxSendable) {
    throw new Error(`Amount ${amountSats} sats is outside range ${meta.minSendable/1000}–${meta.maxSendable/1000}`);
  }
  const cbUrl = new URL(meta.callback);
  cbUrl.searchParams.set('amount', String(amountMsats));
  if (memo) cbUrl.searchParams.set('comment', memo);
  let cbResp;
  try {
    const r = await fetch(cbUrl.toString(), { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`LNURL callback returned ${r.status}`);
    cbResp = await r.json();
  } catch (e) {
    throw new Error(`Invoice generation failed: ${e.message}`);
  }
  if (cbResp.status === 'ERROR') throw new Error(cbResp.reason || 'Invoice generation error');
  if (!cbResp.pr) throw new Error('No invoice returned from Lightning address');
  return { pr: cbResp.pr, descriptionHash: cbResp.description_hash };
}
