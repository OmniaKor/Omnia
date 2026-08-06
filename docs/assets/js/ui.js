/** ui.js — small shared helpers. No framework; there is not enough app here
 *  to earn one, and a framework would need a build step. */

/** Escape text bound for an innerHTML template. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** `2026-08-05` → `Wed 5 Aug`. */
export function prettyDate(dateKey, opts = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...opts,
  });
}

/** Seconds → `M:SS`. */
export function clockText(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The image markup for one exercise.
 *
 * Movements the database has no photograph of render drawn placeholder art
 * rather than being dropped from the routine — a core routine without a
 * hollow hold is a worse routine, and a broken-image icon is worse still.
 */
export function exerciseImage(exercise, { className, sizeClass, alt }) {
  if (exercise.placeholder || exercise.images.length === 0) {
    return `<div class="ph-card ${sizeClass}" role="img"
                 aria-label="${esc(exercise.name)} — illustration pending">
              [placeholder]
            </div>`;
  }
  return `<img class="${className}" src="${esc(exercise.images[0])}"
               alt="${esc(alt ?? exercise.name)}" loading="lazy" decoding="async">`;
}

/** Announce a state change to screen readers. */
export function announce(message) {
  const live = document.getElementById('live');
  if (live) live.textContent = message;
}
