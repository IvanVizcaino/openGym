// Coaches and athletes. Every profile on the instance has a role: a coach plans, an athlete
// trains what was planned. The plan is the part of the profile document that says what to train
// (the routines, the week, the programmes, the rotation); the rest (workouts, weigh-ins,
// settings) stays the athlete's own. Pure helpers here, wired into server.js, tested in
// test/team.test.js.
//
// Two ways the plan of an athlete changes:
//   - a coach assigns one of their own routines (a copy, tagged with where it came from, so the
//     same routine assigned again replaces that copy), edits that copy in place, removes one, or
//     sets the week. The copy is stamped the way the app stamps its own edits (sync-stamps.js),
//     so an athlete's device takes the coach's version on its next merge.
//   - an athlete's own push (PUT /api/data) never changes it: lockPlan puts back the stored plan
//     and its stamps before anything else reads the document.

import crypto from 'node:crypto';
import { stampEntry } from './sync-stamps.js';

import { ROLES, PLAN_FIELDS, WEEK_DAYS, roleOf, lockPlan } from './team-plan.js';

export { ROLES, PLAN_FIELDS, WEEK_DAYS, roleOf, lockPlan };
const ORDER_KEY = 'routineOrder';
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

export const DIET_MAX = 50000;

/** Strip tags/attrs that must never reach an athlete's device (mirrors frontend/src/lib/safe-html.js). */
function scrubDietHtml(html) {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style)(\s[^>]*)?>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|svg|math)(\s[^>]*)?\/?>/gi, '');
  s = s.replace(/\s(on\w+|formaction|style|class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s(href|src)\s*=\s*(['"]?)\s*javascript:[^'"\s>]*/gi, ' href="#"');
  return s;
}

/** A diet string as stored: HTML from the coach editor (or legacy Markdown), capped. Empty clears it. */
export function cleanDiet(v) {
  if (typeof v !== 'string') return '';
  return scrubDietHtml(v.replace(/\u0000/g, '')).slice(0, DIET_MAX);
}

/** The plan as the coach's screen shows it. */
export function planOf(S) {
  const routines = (Array.isArray(S?.routines) ? S.routines : []).filter(isMap);
  const week = {};
  for (const d of WEEK_DAYS) {
    const v = S?.week?.[d];
    const ids = (Array.isArray(v) ? v : v != null ? [v] : []).filter(x => typeof x === 'string' || typeof x === 'number');
    if (ids.length) week[d] = ids.map(String);
  }
  const diet = typeof S?.diet === 'string' ? S.diet : '';
  return { routines, week, programme: S?.programme || null, rotation: S?.rotation || null, diet };
}

/** Sets the athlete's diet (coach-owned). Mutates `S`. */
export function setDiet(S, text, now = Date.now()) {
  const next = cleanDiet(text);
  const ed = isMap(S.edited) ? S.edited : (S.edited = {});
  if (next) S.diet = next; else delete S.diet;
  ed.diet = now;
}

// The copy of a coach's routine that goes into an athlete's plan: the same exercises under a new
// id, and `coach` naming where it came from.
function copyOf(src, coachId, now, prev) {
  const { id, _ts, _f, _u, coach, ...body } = clone(src);
  const x = { id: prev?.id || 'c' + crypto.randomBytes(6).toString('hex'), ...body, coach: { id: coachId, rid: String(id), at: now } };
  return stampEntry(prev || null, x, now);
}

/**
 * Puts `routines` (the coach's own) into an athlete's document `S`, replacing a copy assigned
 * before from the same routine. `days` (optional) are the weekdays each one is trained on:
 * `{ [routineId]: ['1', '4'] }`. Mutates `S`; returns the ids of the copies, by source id.
 */
export function assignRoutines(S, routines, coachId, { days = {}, now = Date.now() } = {}) {
  S.routines = (Array.isArray(S.routines) ? S.routines : []).filter(isMap);
  const ids = {};
  const ed = isMap(S.edited) ? S.edited : (S.edited = {});
  for (const src of routines) {
    if (!isMap(src) || src.id == null) continue;
    const at = S.routines.findIndex(r => r.coach?.id === coachId && r.coach?.rid === String(src.id));
    const prev = at >= 0 ? S.routines[at] : null;
    const x = copyOf(src, coachId, now, prev);
    if (at >= 0) S.routines[at] = x; else { S.routines.push(x); ed[ORDER_KEY] = now; }
    // A copy removed before and assigned again is an add-back, as the app records one.
    if (isMap(S.deleted?.routines) && x.id in S.deleted.routines) S.deleted.routines[x.id] = -now;
    ids[String(src.id)] = x.id;
    const want = Array.isArray(days[String(src.id)]) ? days[String(src.id)].map(String).filter(d => WEEK_DAYS.includes(d)) : null;
    if (want) setDays(S, x.id, want, now);
  }
  return ids;
}

// The routine `id` on exactly the weekdays `want`, the other routines of each day left as they are.
function setDays(S, id, want, now) {
  S.week = isMap(S.week) ? S.week : {};
  const ed = isMap(S.edited) ? S.edited : (S.edited = {});
  for (const d of WEEK_DAYS) {
    const had = S.week[d] == null ? [] : [].concat(S.week[d]).map(String);
    const has = had.includes(id);
    const on = want.includes(d);
    if (has === on) continue;
    const next = on ? [...had, id] : had.filter(x => x !== id);
    if (next.length) S.week[d] = next; else delete S.week[d];
    ed['week.' + d] = now;
  }
}

export const ROUTINE_EX_MAX = 40;

/**
 * Replaces the body of routine `id` in `S` with `patch` (name, emoji, prog, ex, …). Keeps the
 * copy's id and `coach` tag so re-assign still finds it. Mutates `S`. Returns the updated
 * routine, or null if it was not in the plan.
 */
export function updateRoutine(S, id, patch, now = Date.now()) {
  if (!isMap(patch)) return null;
  S.routines = (Array.isArray(S.routines) ? S.routines : []).filter(isMap);
  const at = S.routines.findIndex(r => String(r.id) === String(id));
  if (at < 0) return null;
  const prev = S.routines[at];
  const { id: _id, _ts, _f, _u, coach: _coach, ...body } = clone(patch);
  if (Array.isArray(body.ex)) body.ex = body.ex.filter(isMap).slice(0, ROUTINE_EX_MAX);
  else delete body.ex;
  if (typeof body.name === 'string') body.name = body.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || prev.name || 'Routine';
  const x = { ...body, id: prev.id, coach: prev.coach };
  S.routines[at] = stampEntry(prev, x, now);
  return S.routines[at];
}

/** Removes routine `id` from `S` and from every day of its week. Returns whether it was there. */
export function removeRoutine(S, id, now = Date.now()) {
  const list = Array.isArray(S.routines) ? S.routines : [];
  if (!list.some(r => isMap(r) && String(r.id) === String(id))) return false;
  S.routines = list.filter(r => !(isMap(r) && String(r.id) === String(id)));
  setDays(S, String(id), [], now);
  S.deleted = isMap(S.deleted) ? S.deleted : {};
  S.deleted.routines = isMap(S.deleted.routines) ? S.deleted.routines : {};
  S.deleted.routines[String(id)] = now;
  return true;
}

/**
 * The whole week of `S` set to `week` (`{ [day]: [routineId] }`). Only routines the plan holds
 * are kept; a day left out is a rest day. Mutates `S`.
 */
export function setWeek(S, week, now = Date.now()) {
  const have = new Set((Array.isArray(S.routines) ? S.routines : []).filter(isMap).map(r => String(r.id)));
  const prev = isMap(S.week) ? S.week : {};
  const next = {};
  for (const d of WEEK_DAYS) {
    const ids = (Array.isArray(week?.[d]) ? week[d] : []).map(String).filter(id => have.has(id));
    if (ids.length) next[d] = [...new Set(ids)];
  }
  const ed = isMap(S.edited) ? S.edited : (S.edited = {});
  for (const d of WEEK_DAYS) if (!same(prev[d] == null ? null : [].concat(prev[d]).map(String), next[d] || null)) ed['week.' + d] = now;
  // The week the coach sets is the schedule the app shows.
  if (S.scheduleMode !== 'week' && Object.keys(next).length) { S.scheduleMode = 'week'; ed.scheduleMode = now; }
  S.week = next;
}

/** One row of the coach's list of athletes. */
export function athleteRow(u, S) {
  const workouts = (Array.isArray(S?.workouts) ? S.workouts : []).filter(isMap);
  const last = workouts[workouts.length - 1];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return {
    id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled,
    workouts: workouts.length,
    lastWorkout: last ? last.d || null : null,
    thisWeek: workouts.filter(w => typeof w.d === 'string' && w.d >= weekAgo).length,
    routines: (Array.isArray(S?.routines) ? S.routines : []).filter(isMap).length,
  };
}

// --- site name and logo -------------------------------------------------------------------------

export const SITE_NAME_MAX = 40;
export const LOGO_MAX = 256 * 1024;
// Raster images only: an SVG is a document that can carry script, and the logo is served to
// anyone, signed in or not.
const LOGO_TYPES = [
  { mime: 'image/png', ext: 'png', ok: b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { mime: 'image/jpeg', ext: 'jpg', ok: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', ok: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/** A logo sent as a data URL: its bytes and type, or an error code. */
export function parseLogo(dataUrl) {
  const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) return { error: 'logo-invalid' };
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) return { error: 'logo-invalid' };
  if (bytes.length > LOGO_MAX) return { error: 'logo-too-large' };
  const type = LOGO_TYPES.find(t => t.ok(bytes));
  if (!type) return { error: 'logo-type' };
  return { bytes, mime: type.mime, ext: type.ext };
}

export const logoMime = ext => LOGO_TYPES.find(t => t.ext === ext)?.mime || null;

/** The site name as stored: trimmed, one line, capped. Empty means the default. */
export const cleanSiteName = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, SITE_NAME_MAX) : '');
