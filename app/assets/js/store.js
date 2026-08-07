/**
 * store.js — the only thing in Omnia that persists.
 *
 * One localStorage key, one shape. Phase 12 syncs this same shape to Supabase,
 * so the field names here are the field names there and the migration is a
 * copy rather than a translation.
 */

const KEY = 'omnia.v1';

const EMPTY = {
  version: 1,
  prefs: {
    intervalSeconds: 30,
    continuous: false,
    theme: 'auto',
    // Sound is on by default, but nothing plays until a user gesture unlocks
    // the audio context, so this can never surprise someone on page load.
    soundMuted: false,
    musicEnabled: true,
  },
  sessions: [],
  customRoutines: [],
};

/**
 * The user's own calendar day for a Date, as `YYYY-MM-DD`.
 *
 * Built from local getters rather than `toISOString()`, which converts to UTC
 * first: a workout finished at 11pm on the 5th would be stamped the 6th and
 * paint the wrong calendar square for anyone west of London.
 */
export function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(EMPTY),
      ...parsed,
      prefs: { ...EMPTY.prefs, ...(parsed.prefs || {}) },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      customRoutines: Array.isArray(parsed.customRoutines) ? parsed.customRoutines : [],
    };
  } catch {
    // Corrupt or blocked storage (Safari private mode throws on read). Losing
    // history is bad; refusing to open the app is worse.
    return structuredClone(EMPTY);
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Quota or private mode. The session still runs; it just won't be there
       tomorrow. Failing loudly here would interrupt a workout to no purpose. */
  }
}

let state = read();

/* ── Preferences ──────────────────────────────────────────────────────── */

export function getPrefs() {
  return { ...state.prefs };
}

export function setPrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  write(state);
  return getPrefs();
}

/* ── Sessions ─────────────────────────────────────────────────────────── */

/**
 * Append one finished attempt. Called once per routine — never per exercise.
 *
 * @param {object} session
 * @param {string} session.routineId
 * @param {'completed'|'quit'} session.status
 * @param {number} session.intervalSeconds
 * @param {boolean} session.continuous
 * @param {number} session.exercisesDone
 * @param {string} session.startedAt  ISO timestamp
 */
export function addSession(session) {
  const now = new Date();
  const record = {
    id: `s_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    routineId: session.routineId,
    status: session.status,
    intervalSeconds: session.intervalSeconds,
    continuous: Boolean(session.continuous),
    exercisesDone: session.exercisesDone ?? 0,
    startedAt: session.startedAt ?? now.toISOString(),
    finishedAt: now.toISOString(),
    localDate: localDate(now),
  };
  // Append-only. The calendar folds this list per day; it never rewrites it.
  state.sessions.push(record);
  write(state);
  return record;
}

export function allSessions() {
  return state.sessions.slice();
}

/** Every session on one `YYYY-MM-DD`. */
export function sessionsOn(dateKey) {
  return state.sessions.filter((s) => s.localDate === dateKey);
}

/**
 * The calendar state for one day.
 *
 * `green` wins over `yellow` by design: quitting once and then finishing a
 * routine — the same one or another — makes the day green. The rule rewards
 * the finish, not the false start.
 *
 * @returns {'green'|'yellow'|'red'}
 */
export function dayStatus(dateKey) {
  const sessions = sessionsOn(dateKey);
  if (sessions.some((s) => s.status === 'completed')) return 'green';
  if (sessions.length > 0) return 'yellow';
  return 'red';
}

/** Dates a routine was *completed* on, newest first. Drives "also done on". */
export function completionDates(routineId) {
  const dates = state.sessions
    .filter((s) => s.routineId === routineId && s.status === 'completed')
    .map((s) => s.localDate);
  return [...new Set(dates)].sort().reverse();
}

/* ── Custom routines ──────────────────────────────────────────────────── */

/**
 * Routines the user built.
 *
 * Stored unresolved — `exercises` is a list of ids, and `customExercises`
 * holds any movements the user invented, scoped to this routine. Resolution
 * against the catalog happens in catalog.js, so the stored shape stays a
 * plain record that Phase 12 can send to Supabase unchanged.
 */
export function getCustomRoutines() {
  return state.customRoutines.map((routine) => ({ ...routine }));
}

export function getCustomRoutine(id) {
  return state.customRoutines.find((r) => r.id === id) || null;
}

/** Insert or update by id. Returns the saved record. */
export function saveCustomRoutine(routine) {
  const now = new Date().toISOString();
  const index = state.customRoutines.findIndex((r) => r.id === routine.id);

  const record = {
    ...routine,
    id: routine.id || `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    custom: true,
    createdAt: index === -1 ? now : state.customRoutines[index].createdAt,
    updatedAt: now,
  };

  if (index === -1) state.customRoutines.push(record);
  else state.customRoutines[index] = record;

  write(state);
  return record;
}

/**
 * Remove a routine. Its past sessions are deliberately left alone — deleting a
 * routine should not silently repaint the calendar and erase days the user
 * actually trained. The calendar falls back to the stored id for the name.
 */
export function deleteCustomRoutine(id) {
  state.customRoutines = state.customRoutines.filter((r) => r.id !== id);
  write(state);
}

/** The earliest day with any history — days before it are blank, not red. */
export function firstActiveDate() {
  if (state.sessions.length === 0) return null;
  return state.sessions.map((s) => s.localDate).sort()[0];
}
