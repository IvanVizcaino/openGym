// When an athlete finishes a workout: a Web Push to the coaches who plan for them, and a row
// on the coach's activity feed (GET /api/team/activity). The only place the server sees a
// session land is PUT /api/data, so this runs off the same detectEvents the integrations hub
// uses — a finish from the app, the watch or log_workout all look the same.
//
// Recipients (coachesForAthlete): the coach who created the athlete's invite, and any coach
// whose routine is in the athlete's plan. If nobody is linked, every coach on the instance.
// A preference `teamNotify === false` on the coach's document turns the push off (default is
// on); the feed still records the session. A finish whose end (or start) is older than
// BACKFILL_MS is treated as a backfill: it is listed, not pushed.
//
// Dedup is by athleteId:workoutId in data/team-activity.json, so deleting a workout and
// uploading the same id again does not notify twice. The file is capped (rows, notified keys,
// and a byte ceiling).

import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './durable.js';
import { detectEvents, workoutPayload, workoutTime, RECENT_MS } from './integrations/events.js';
import { workoutFinishedPush } from './push-messages.js';

export const BACKFILL_MS = 12 * 3600_000;
export const ACTIVITY_KEEP = 200;
export const NOTIFIED_KEEP = 2000;
export const ACTIVITY_MAX_BYTES = 512 * 1024;
export const FEED_LIMIT = 50;

export { RECENT_MS };

export const notifyKey = (athleteId, workoutId) => `${athleteId}:${workoutId}`;

/**
 * The coaches who should hear about this athlete's session.
 * `athlete` is the user record (`id`, `invitedBy`), `coaches` the current coach users,
 * `invites` the instance's invites, `state` the athlete's document (`routines[].coach.id`).
 * Disabled coaches and the athlete themselves are left out. If nobody is linked, every
 * remaining coach.
 */
export function coachesForAthlete(athlete, coaches, invites, state) {
  const all = (Array.isArray(coaches) ? coaches : []).filter(c => c && c.id && !c.disabled && c.id !== athlete?.id);
  const byId = new Map(all.map(c => [c.id, c]));
  const linked = new Set();

  const code = typeof athlete?.invitedBy === 'string' ? athlete.invitedBy : '';
  if (code) {
    const inv = (Array.isArray(invites) ? invites : []).find(i => i && i.code === code);
    if (inv?.createdBy && byId.has(inv.createdBy)) linked.add(inv.createdBy);
  }
  for (const r of Array.isArray(state?.routines) ? state.routines : []) {
    const id = r?.coach?.id;
    if (id && byId.has(id)) linked.add(id);
  }
  const ids = linked.size ? [...linked] : all.map(c => c.id);
  return ids.map(id => byId.get(id)).filter(Boolean);
}

/** A session whose own clock is older than BACKFILL_MS, or has no usable time. */
export function isBackfill(workout, now = Date.now()) {
  const at = workoutTime(workout);
  return !at || now - at > BACKFILL_MS;
}

const empty = () => ({ items: [], notified: {}, seen: {} });

function loadStore(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty();
    return {
      items: Array.isArray(raw.items) ? raw.items.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [],
      notified: raw.notified && typeof raw.notified === 'object' && !Array.isArray(raw.notified) ? raw.notified : {},
      seen: raw.seen && typeof raw.seen === 'object' && !Array.isArray(raw.seen) ? raw.seen : {},
    };
  } catch (e) {
    if (e.code === 'ENOENT') return empty();
    console.error('team-activity: could not read', e.message);
    return empty();
  }
}

function prune(store) {
  if (store.items.length > ACTIVITY_KEEP) store.items = store.items.slice(-ACTIVITY_KEEP);
  const keys = Object.keys(store.notified);
  if (keys.length > NOTIFIED_KEEP) {
    keys.sort((a, b) => (Number(store.notified[a]) || 0) - (Number(store.notified[b]) || 0));
    for (const k of keys.slice(0, keys.length - NOTIFIED_KEEP)) delete store.notified[k];
  }
  let text = JSON.stringify(store);
  while (Buffer.byteLength(text) > ACTIVITY_MAX_BYTES && store.items.length) {
    store.items.shift();
    text = JSON.stringify(store);
  }
  return text;
}

function activityItem(athlete, ev, doc, coaches, now) {
  const w = workoutPayload(ev.data, doc);
  return {
    id: notifyKey(athlete.id, w.id),
    athleteId: String(athlete.id),
    athleteName: String(athlete.name || '').slice(0, 80),
    workoutId: w.id,
    name: w.name || null,
    date: w.date,
    endedAt: w.endedAt,
    durationMin: w.durationMin,
    sets: w.totals.sets,
    volume: w.totals.volume,
    unit: w.unit,
    at: now,
    coaches: coaches.map(c => c.id),
  };
}

/**
 * `users` / `invites` are functions so the live db.json is read on each write.
 * `sendPush(userId, payload)` is the same helper the rest of the server uses; it is
 * not awaited (a failed delivery must not turn the athlete's PUT into a 500).
 */
export function createTeamNotify({ dataDir, users, invites, isCoach, readState, sendPush, now = Date.now, file } = {}) {
  const activityFile = file || path.join(dataDir, 'team-activity.json');
  let store = loadStore(activityFile);

  const save = () => {
    try { atomicWrite(activityFile, prune(store), 0o600); }
    catch (e) { console.error('team-activity: could not save', e.message); }
  };

  const coachesOf = () => (typeof users === 'function' ? users() : users) || [];
  const invitesOf = () => (typeof invites === 'function' ? invites() : invites) || [];
  const liveCoaches = () => coachesOf().filter(u => u && !u.disabled && isCoach(u));

  return {
    onStateWrite(user, prev, next) {
      if (!user || user.disabled || isCoach(user)) return { recorded: 0, pushed: 0 };
      const evs = detectEvents(prev, next, { now: now() }).filter(e => e.type === 'workout.finished');
      if (!evs.length) return { recorded: 0, pushed: 0 };
      const coaches = coachesForAthlete(user, liveCoaches(), invitesOf(), next);
      if (!coaches.length) return { recorded: 0, pushed: 0 };
      const t = now();
      let recorded = 0, pushed = 0;
      for (const ev of evs) {
        const key = notifyKey(user.id, ev.entity);
        if (store.notified[key]) continue;
        store.notified[key] = t;
        const item = activityItem(user, ev, next, coaches, t);
        store.items.push(item);
        recorded++;
        if (isBackfill(ev.data, t)) continue;
        for (const c of coaches) {
          const S = readState(c.id) || {};
          if (S.teamNotify === false) continue;
          const payload = workoutFinishedPush(S.lang, {
            athlete: user.name,
            routine: item.name,
            durationMin: item.durationMin,
            sets: item.sets,
            volume: item.volume,
            unit: item.unit,
          }, { tag: `workout-finished:${user.id}:${item.workoutId}`, url: `#/team/${user.id}` });
          try { Promise.resolve(sendPush(c.id, payload)).catch(e => console.error('team-notify push', c.id, e.message)); }
          catch (e) { console.error('team-notify push', c.id, e.message); }
          pushed++;
        }
      }
      if (recorded) save();
      return { recorded, pushed };
    },

    listFor(coachId, { limit = FEED_LIMIT } = {}) {
      const cap = Math.max(1, Math.min(ACTIVITY_KEEP, Number(limit) || FEED_LIMIT));
      const seenAt = Number(store.seen[coachId]) || 0;
      const items = store.items
        .filter(it => Array.isArray(it.coaches) && it.coaches.includes(coachId))
        .slice(-cap)
        .reverse();
      const unread = items.filter(it => (Number(it.at) || 0) > seenAt).length;
      return { items, unread, seenAt };
    },

    markSeen(coachId, at = now()) {
      store.seen[String(coachId)] = at;
      save();
      return { ok: true, seenAt: at };
    },

    // For the tests.
    _store: () => store,
    _reload: () => { store = loadStore(activityFile); },
    _file: activityFile,
  };
}
