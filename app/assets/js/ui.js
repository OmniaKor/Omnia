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

/**
 * An exercise rendered as a moving figure.
 *
 * There are no animated files to show. free-exercise-db ships exactly two
 * JPEGs per movement — frame 0 is the start of the rep and frame 1 is the end —
 * so the animation is made here by alternating them. That is what the two
 * frames are for, and it is the closest thing to a demonstration loop the
 * catalog can provide.
 *
 * Done in CSS rather than with a JS timer: no interval to start, stop or leak
 * when the player tears down, and the browser keeps it off the main thread.
 * The reduced-motion rule at the bottom of omnia.css settles it on one frame.
 *
 * @param {object} exercise
 * @param {object} options
 * @param {string} options.className  applied to the figure wrapper
 * @param {string} options.sizeClass  applied to the placeholder card
 * @param {boolean} [options.eager]   preload both frames immediately
 */
export function exerciseFigure(exercise, { className, sizeClass, eager = false }) {
  if (exercise.placeholder || exercise.images.length === 0) {
    return `<div class="ph-card ${sizeClass}" role="img"
                 aria-label="${esc(exercise.name)} — illustration pending">
              [placeholder]
            </div>`;
  }

  // One frame only: nothing to alternate, so render it still rather than
  // flashing the same picture on and off.
  if (exercise.images.length === 1) {
    return `<img class="${className}" src="${esc(exercise.images[0])}"
                 alt="${esc(exercise.name)}" decoding="async">`;
  }

  const loading = eager ? 'eager' : 'lazy';
  return `
    <div class="frames ${className}" role="img" aria-label="${esc(exercise.name)}">
      <img class="frames__a" src="${esc(exercise.images[0])}" alt=""
           loading="${loading}" decoding="async">
      <img class="frames__b" src="${esc(exercise.images[1])}" alt=""
           loading="${loading}" decoding="async">
    </div>
  `;
}

/** Announce a state change to screen readers. */
export function announce(message) {
  const live = document.getElementById('live');
  if (live) live.textContent = message;
}
