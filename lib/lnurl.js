/**
 * Server-side LNURL-pay resolution.
 * Resolves a Lightning address (user@domain) OR raw LNURL to a BOLT11 invoice.
 * Pure HTTP; no wallet required.
 */

import { bech32 } from 'bech32';

// Decode a bech32 LNURL (e.g. LNURL1DP68GURN8GHJ7...)
function decodeLnurl(lnurl) {
  try {
    const { prefix, words } = bech32.decode(lnurl, 2000);
    if (prefix.toLowerCase() !== 'lnurl') return null;
    const data = bech32.fromWords(words);
    return new TextDecoder().decode(new Uint8Array(data));
  } catch (e) {
    return null;
  }
}

// Resolve Lightning address or LNURL to BOLT11 invoice
// Returns { pr: string } or throws with user-friendly message
export async function resolveInvoiceFromAddress(lightningAddress, amountSats, memo) {
  let metaUrl;
  let source = 'address';

  if (lightningAddress.startsWith('LNURL') || lightningAddress.startsWith('lnurl')) {
    // Raw bech32 LNURL
    const decoded = decodeLnurl(lightningAddress);
    if (!decoded) throw new Error('Invalid LNURL format');
    metaUrl = decoded;
    source = 'lnurl';
  } else if (lightningAddress.includes('@')) {
    // Lightning address: user@domain
    const [user, domain] = lightningAddress.split('@');
    if (!user || !domain) throw new Error('Invalid Lightning address format');
    metaUrl = `https://${domain}/.well-known/lnurlp/${user}`;
  } else if (lightningAddress.startsWith('https://')) {
    // Direct LNURL-pay endpoint URL
    metaUrl = lightningAddress;
    source = 'url';
  } else {
    throw new Error('Invalid payment address: must be user@domain, LNURL..., or https:// URL');
  }

  console.log(`[lnurl] resolving ${source}: ${metaUrl.substring(0, 60)}...`);

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

  console.log(`[lnurl] invoice generated: ${cbResp.pr.substring(0, 50)}...`);
  return { pr: cbResp.pr, descriptionHash: cbResp.description_hash };
}
