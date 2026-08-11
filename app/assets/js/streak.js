/**
 * streak.js — how consistent the user has been, as a rank.
 *
 * Pure functions over the session list. Nothing new is persisted: `sessions`
 * already holds everything, and a second stored counter is a counter that can
 * drift out of agreement with the calendar squares.
 *
 * `today` is always an argument rather than read from the clock, so the tests
 * pin every boundary exactly without faking time.
 */

/** Best first. The letters themselves are drawn into the artwork. */
export const RANKS = ['S', 'A', 'B', 'C', 'D', 'F'];

/** `YYYY-MM-DD` → a Date at *local* midnight. */
function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Whole days from `a` to `b`, both `YYYY-MM-DD`.
 *
 * Rounded, not truncated. A local day is 23 or 25 hours long across a DST
 * boundary, and truncating turns a real one-day gap into zero every spring —
 * which would silently fuse two days into one streak day.
 */
function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

/**
 * The rank for a given streak and absence.
 *
 * A finish today *or* yesterday keeps the streak alive: today being unfinished
 * must not demote anyone at 9am, which is the same courtesy the calendar
 * extends by not painting today red in advance.
 */
function rankFor(streak, daysSince) {
  if (daysSince <= 1) {
    if (streak >= 7) return 'S';
    if (streak >= 3) return 'A';
    return 'B';
  }
  if (daysSince <= 3) return 'C';
  if (daysSince <= 7) return 'D';
  return 'F';
}

/**
 * @param {Array<{status: string, localDate: string}>} sessions
 * @param {string} today  `YYYY-MM-DD`
 * @returns {{rank: string, unranked: boolean, streak: number,
 *            best: number, daysSince: number|null}}
 */
export function streakState(sessions, today) {
  // The same fold the calendar does: unique local days holding a finish. A day
  // where the user quit and then finished counts, exactly as it goes green.
  const days = [...new Set(
    sessions.filter((s) => s.status === 'completed').map((s) => s.localDate),
  )].sort();

  if (days.length === 0) {
    return { rank: 'B', unranked: true, streak: 0, best: 0, daysSince: null };
  }

  const last = days[days.length - 1];
  // Clamped: a session dated in the future — a device clock moved backwards —
  // must not produce a negative gap and rank somebody above S.
  const daysSince = Math.max(0, daysBetween(last, today));

  let run = 1;
  let best = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  // `run` ends on the newest day, so it *is* the current streak — but only
  // while that day is still recent enough to count.
  const streak = daysSince <= 1 ? run : 0;

  return { rank: rankFor(streak, daysSince), unranked: false, streak, best, daysSince };
}
