/**
 * Lightweight i18n for my two sats
 * Supports en (default), af (Afrikaans), xh (isiXhosa)
 * Detects: ?lang= URL param → window.fedi?.locale → navigator.language
 */

const FALLBACK = 'en';
const _locales = {};
let LANG = 'en';

async function fetchLocale(code) {
  if (code === FALLBACK || _locales[code]) return;
  try {
    const res = await fetch(`./locales/${code}.json`);
    if (!res.ok) throw new Error('not found');
    _locales[code] = await res.json();
  } catch {
    // silently fall back
  }
}

export async function initI18n() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  const fromFedi = typeof window !== 'undefined' && window.fedi?.locale;
  const fromNav = typeof navigator !== 'undefined' && navigator.language;
  const raw = fromUrl || fromFedi || fromNav || FALLBACK;
  const code = raw.split('-')[0].toLowerCase();

  // Always load English as base, then target locale on top
  await fetchLocale(FALLBACK);
  await fetchLocale(code);
  LANG = (_locales[code] && Object.keys(_locales[code]).length) ? code : FALLBACK;
}

export function t(key, ...args) {
  const dict = _locales[LANG] || _locales[FALLBACK] || {};
  let str = dict[key];
  if (str === undefined) str = (_locales[FALLBACK] || {})[key];
  if (str === undefined) str = key;
  args.forEach(a => { str = str.replace('%s', a); });
  return str;
}
