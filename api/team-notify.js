// When an athlete finishes a workout or uploads a progress photo (the Body / Cuerpo gallery):
// a Web Push to the coaches who plan for them, and a row on the coach's activity feed
// (GET /api/team/activity). The only place the server sees either land is PUT /api/data.
// Workout finishes reuse detectEvents from the integrations hub (app, watch or log_workout
// all look the same). Progress photos are detected separately (detectBodyPhotos): they are
// not an integrations webhook event, and several new photos in one PUT are batched into a
// single feed row and a single push.
//
// Recipients (coachesForAthlete): the coach who created the athlete's invite, and any coach
// whose routine is in the athlete's plan. If nobody is linked, every coach on the instance.
// A preference `teamNotify === false` on the coach's document turns the push off (default is
// on); the feed still records the event. A workout whose end (or start) is older than
// BACKFILL_MS, or a photo whose write time is, is treated as a backfill: it is listed, not
// pushed. In a photo batch, a push is sent only if at least one photo is not a backfill.
//
// Dedup is by athleteId:workoutId or photo:<athleteId>:<hash> in data/team-activity.json, so
// deleting and re-uploading the same workout id or the same file hash does not notify twice.
// The file is capped (rows, notified keys, and a byte ceiling).

import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './durable.js';
import { detectEvents, workoutPayload, workoutTime, RECENT_MS } from './integrations/events.js';
import { workoutFinishedPush, bodyPhotoPush } from './push-messages.js';

export const BACKFILL_MS = 12 * 3600_000;
export const ACTIVITY_KEEP = 200;
export const NOTIFIED_KEEP = 2000;
export const ACTIVITY_MAX_BYTES = 512 * 1024;
export const FEED_LIMIT = 50;

export { RECENT_MS };

export const notifyKey = (athleteId, workoutId) => `${athleteId}:${workoutId}`;
export const photoNotifyKey = (athleteId, hash) => `photo:${athleteId}:${hash}`;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_HASH = /^[0-9a-f]{64}$/;

/** A still progress photo (not a form-check video). */
export function isProgressPhotoRef(m) {
  if (!m || typeof m !== 'object' || typeof m.hash !== 'string' || !PHOTO_HASH.test(m.hash)) return false;
  const kind = m.kind;
  return kind === 'image' || kind === 'gif' || kind == null || kind === '';
}

function dayPhotosMap(doc) {
  const map = doc?.dayPhotos;
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

function readDayPhoto(hash, entry) {
  if (!entry || typeof entry !== 'object' || !ISO_DAY.test(String(entry.d || ''))) return null;
  if (!isProgressPhotoRef(entry.m) || entry.m.hash !== hash) return null;
  const at = (typeof entry._ts === 'number' && Number.isFinite(entry._ts) && entry._ts > 0)
    ? entry._ts
    : (typeof entry.m.at === 'number' && Number.isFinite(entry.m.at) && entry.m.at > 0 ? entry.m.at : 0);
  return { hash, date: entry.d.slice(0, 10), at, size: entry.m.size, kind: entry.m.kind || 'image', source: 'day' };
}

function knownPhotoHashes(doc) {
  const out = new Set();
  for (const [hash, e] of Object.entries(dayPhotosMap(doc))) {
    if (readDayPhoto(hash, e)) out.add(hash);
  }
  for (const w of Array.isArray(doc?.workouts) ? doc.workouts : []) {
    if (!w || !Array.isArray(w.media)) continue;
    for (const m of w.media) if (isProgressPhotoRef(m)) out.add(m.hash);
  }
  return out;
}

/**
 * New progress photos in `next` that were not already in `prev`: entries under dayPhotos
 * (the Body gallery files a photo under the day when that day has no workout, or the
 * workout is full) and stills on workouts[].media (the same gallery files there when the
 * day already has a session). Videos are ignored. A file that only moves from dayPhotos
 * to a workout, or the other way, is not new. Returns [{ type, entity, at, hash, date,
 * size, source }] in time order.
 */
export function detectBodyPhotos(prev, next, { now = Date.now() } = {}) {
  const out = [];
  const seen = knownPhotoHashes(prev);
  for (const [hash, e] of Object.entries(dayPhotosMap(next))) {
    const p = readDayPhoto(hash, e);
    if (!p || seen.has(hash)) continue;
    seen.add(hash);
    out.push({ type: 'body.photo', entity: hash, at: p.at || now, hash, date: p.date, size: p.size, source: 'day' });
  }
  for (const w of Array.isArray(next?.workouts) ? next.workouts : []) {
    if (!w || !Array.isArray(w.media)) continue;
    for (const m of w.media) {
      if (!isProgressPhotoRef(m) || seen.has(m.hash)) continue;
      seen.add(m.hash);
      const at = (typeof m.at === 'number' && Number.isFinite(m.at) && m.at > 0)
        ? m.at
        : (typeof m._ts === 'number' && Number.isFinite(m._ts) && m._ts > 0 ? m._ts : now);
      const date = typeof w.d === 'string' && ISO_DAY.test(w.d.slice(0, 10)) ? w.d.slice(0, 10) : null;
      out.push({ type: 'body.photo', entity: m.hash, at, hash: m.hash, date, size: m.size, source: 'workout' });
    }
  }
  return out.sort((a, b) => (a.at - b.at) || a.hash.localeCompare(b.hash));
}

export function isPhotoBackfill(photo, now = Date.now()) {
  const at = typeof photo?.at === 'number' && Number.isFinite(photo.at) ? photo.at : 0;
  return !at || now - at > BACKFILL_MS;
}

function photoThumb(photos) {
  const p = photos[photos.length - 1];
  if (!p || !PHOTO_HASH.test(p.hash)) return null;
  const thumb = { hash: p.hash };
  if (typeof p.size === 'number' && Number.isFinite(p.size) && p.size >= 0) thumb.size = p.size;
  return thumb;
}

function photoActivityItem(athlete, photos, coaches, now) {
  const latest = photos[photos.length - 1];
  return {
    id: photoNotifyKey(athlete.id, photos[0].hash),
    type: 'body.photo',
    athleteId: String(athlete.id),
    athleteName: String(athlete.name || '').slice(0, 80),
    count: photos.length,
    date: latest?.date || null,
    thumb: photoThumb(photos),
    at: now,
    coaches: coaches.map(c => c.id),
  };
}

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

  const pushCoaches = (coaches, payloadOf) => {
    let n = 0;
    for (const c of coaches) {
      const payload = payloadOf(c);
      if (!payload) continue;
      try { Promise.resolve(sendPush(c.id, payload)).catch(e => console.error('team-notify push', c.id, e.message)); }
      catch (e) { console.error('team-notify push', c.id, e.message); }
      n++;
    }
    return n;
  };

  return {
    onStateWrite(user, prev, next) {
      if (!user || user.disabled || isCoach(user)) return { recorded: 0, pushed: 0 };
      const t = now();
      const evs = detectEvents(prev, next, { now: t }).filter(e => e.type === 'workout.finished');
      const photos = detectBodyPhotos(prev, next, { now: t });
      if (!evs.length && !photos.length) return { recorded: 0, pushed: 0 };
      const coaches = coachesForAthlete(user, liveCoaches(), invitesOf(), next);
      if (!coaches.length) return { recorded: 0, pushed: 0 };
      let recorded = 0, pushed = 0;
      for (const ev of evs) {
        const key = notifyKey(user.id, ev.entity);
        if (store.notified[key]) continue;
        store.notified[key] = t;
        const item = activityItem(user, ev, next, coaches, t);
        store.items.push(item);
        recorded++;
        if (isBackfill(ev.data, t)) continue;
        pushed += pushCoaches(coaches, c => {
          const S = readState(c.id) || {};
          if (S.teamNotify === false) return null;
          return workoutFinishedPush(S.lang, {
            athlete: user.name,
            routine: item.name,
            durationMin: item.durationMin,
            sets: item.sets,
            volume: item.volume,
            unit: item.unit,
          }, { tag: `workout-finished:${user.id}:${item.workoutId}`, url: `#/team/${user.id}` });
        });
      }
      const fresh = photos.filter(p => !store.notified[photoNotifyKey(user.id, p.hash)]);
      if (fresh.length) {
        for (const p of fresh) store.notified[photoNotifyKey(user.id, p.hash)] = t;
        const item = photoActivityItem(user, fresh, coaches, t);
        store.items.push(item);
        recorded++;
        if (!fresh.every(p => isPhotoBackfill(p, t))) {
          pushed += pushCoaches(coaches, c => {
            const S = readState(c.id) || {};
            if (S.teamNotify === false) return null;
            return bodyPhotoPush(S.lang, {
              athlete: user.name,
              count: item.count,
              date: item.date,
            }, { tag: `body-photo:${user.id}:${item.thumb?.hash || item.id}`, url: `#/team/${user.id}/body` });
          });
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
