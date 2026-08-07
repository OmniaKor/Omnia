/**
 * keys.js — the two API keys the video importer needs.
 *
 * Deliberately NOT in `omnia.v1`. That key is the user's workout history, and
 * Phase 12 syncs its exact shape to Supabase — an API key that rode along in
 * that object would be uploaded to a server the moment accounts ship. Secrets
 * live in their own bucket so that migration can never pick them up by
 * accident.
 *
 * They are still only localStorage: anything that can run script on this
 * origin can read them. That is the honest cost of calling an API from a
 * static page with no server to hold a secret, and it is why the importer
 * says so in plain words before asking for anything.
 */

const KEY = 'omnia.keys.v1';

const EMPTY = {
  /** Anthropic key — reads the video's text and returns the routine. */
  anthropic: '',
  /** YouTube Data API key — fetches the title and description. */
  youtube: '',
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    // Corrupt, or storage blocked (Safari private mode throws on read).
    // Importing stops working; nothing else does.
    return { ...EMPTY };
  }
}

export function getKeys() {
  return read();
}

export function setKeys(patch) {
  const next = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* over quota or blocked — the keys just will not survive a reload */
  }
  return next;
}

export function clearKeys() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to do */ }
}

/**
 * Show enough of a key to recognise it, never enough to use it.
 *
 * Someone checking which key is saved needs to tell one from another; nobody
 * needs the middle of it echoed back onto a screen that might be shared.
 */
export function maskKey(value) {
  if (!value) return '';
  if (value.length <= 12) return '••••';
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}
