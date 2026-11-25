/* Finished-workout notices through the real server: the activity feed is coach-only and
   filtered, a new session is recorded, and an edit / re-sync / backfill / opt-out behaves. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { BACKFILL_MS } from '../team-notify.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const ADMIN = 'u_admin', COACH = 'u_coach', OTHER = 'u_coach2', ATHLETE = 'u_ath';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });
const withoutSignupFlags = env => {
  const { INVITE_ONLY, ALLOW_GUEST, FIRST_USER_ADMIN, ...rest } = env;
  return rest;
};

async function startServer(t, { coachState = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-team-notify-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Admin', created: now, admin: true, owner: true },
      { id: COACH, name: 'Coach', created: now, role: 'coach' },
      { id: OTHER, name: 'Luis', created: now, role: 'coach' },
      { id: ATHLETE, name: 'Ana', created: now, role: 'athlete', invitedBy: 'ABC123' },
    ],
    creds: [], subs: [],
    invites: [{ code: 'ABC123', createdBy: COACH, usedBy: ATHLETE, role: 'athlete', created: now }],
  }));
  fs.writeFileSync(path.join(dataDir, `state-${COACH}.json`), JSON.stringify({ unit: 'kg', lang: 'es', _rev: 1, ...coachState }));
  fs.writeFileSync(path.join(dataDir, `state-${OTHER}.json`), JSON.stringify({ unit: 'kg', lang: 'en', _rev: 1 }));
  fs.writeFileSync(path.join(dataDir, `state-${ATHLETE}.json`), JSON.stringify({ unit: 'kg', workouts: [], routines: [], _rev: 1 }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...withoutSignupFlags(process.env), PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (uid, method, p, body) => {
    const r = await fetch(api + p, { method, headers: uid ? as(uid) : body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  h.state = uid => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'));
  return h;
}

const workout = (id, endAgo, extra = {}) => {
  const end = Date.now() - endAgo;
  return { id, d: new Date(end).toISOString().slice(0, 10), name: 'Push', start: end - 45 * 60_000, end, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }], ...extra };
};

test('the activity feed is coach-only and lists only the caller\'s athletes', async t => {
  const h = await startServer(t);
  assert.equal((await h.call(null, 'GET', '/api/team/activity')).status, 401);
  assert.equal((await h.call(ATHLETE, 'GET', '/api/team/activity')).status, 403);
  assert.equal((await h.call(ATHLETE, 'POST', '/api/team/activity/seen')).status, 403);

  const empty = await h.call(COACH, 'GET', '/api/team/activity');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.unread, 0);

  const w = workout('w1', 30_000);
  const put = await h.call(ATHLETE, 'PUT', '/api/data', { baseRev: 1, stamped: true, state: { unit: 'kg', workouts: [w], routines: [] } });
  assert.equal(put.status, 200, JSON.stringify(put.body));

  const feed = await h.call(COACH, 'GET', '/api/team/activity');
  assert.equal(feed.status, 200);
  assert.equal(feed.body.items.length, 1);
  assert.equal(feed.body.unread, 1);
  assert.equal(feed.body.items[0].athleteId, ATHLETE);
  assert.equal(feed.body.items[0].workoutId, 'w1');
  assert.equal(feed.body.items[0].name, 'Push');
  assert.equal(feed.body.items[0].sets, 1);
  assert.ok(!JSON.stringify(feed.body.items[0]).includes('note'));

  const other = await h.call(OTHER, 'GET', '/api/team/activity');
  assert.equal(other.body.items.length, 0, 'an unlinked coach does not see Ana\'s session');

  const seen = await h.call(COACH, 'POST', '/api/team/activity/seen');
  assert.equal(seen.status, 200);
  assert.equal((await h.call(COACH, 'GET', '/api/team/activity')).body.unread, 0);
});

test('an edit or re-sync of the same workout does not add a second feed row', async t => {
  const h = await startServer(t);
  const w = workout('w1', 20_000);
  assert.equal((await h.call(ATHLETE, 'PUT', '/api/data', { baseRev: 1, stamped: true, state: { unit: 'kg', workouts: [w], routines: [] } })).status, 200);
  const rev = (await h.call(ATHLETE, 'GET', '/api/data/rev')).body.rev;
  const edited = { ...w, name: 'Push +', note: 'keep this off the feed' };
  assert.equal((await h.call(ATHLETE, 'PUT', '/api/data', { baseRev: rev, stamped: true, state: { unit: 'kg', workouts: [edited], routines: [] } })).status, 200);
  const feed = await h.call(COACH, 'GET', '/api/team/activity');
  assert.equal(feed.body.items.length, 1);
  assert.equal(feed.body.items[0].name, 'Push');
});

test('a backfill is listed and an opted-out coach still sees the feed', async t => {
  const h = await startServer(t, { coachState: { teamNotify: false } });
  const old = workout('old', BACKFILL_MS + 60_000);
  const put = await h.call(ATHLETE, 'PUT', '/api/data', { baseRev: 1, stamped: true, state: { unit: 'kg', workouts: [old], routines: [] } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const feed = await h.call(COACH, 'GET', '/api/team/activity');
  assert.equal(feed.body.items.length, 1);
  assert.equal(feed.body.items[0].workoutId, 'old');
});

const HASH = 'ab'.repeat(32);
const HASH2 = 'cd'.repeat(32);
const photoRef = (hash = HASH) => ({ kind: 'image', hash, mime: 'image/jpeg', size: 1200, width: 100, height: 100 });

test('a progress photo on PUT /api/data is listed on the coach feed and not for an unlinked coach', async t => {
  const h = await startServer(t);
  const put = await h.call(ATHLETE, 'PUT', '/api/data', {
    baseRev: 1, stamped: true,
    state: {
      unit: 'kg', workouts: [], routines: [],
      dayPhotos: { [HASH]: { d: '2026-11-25', m: photoRef(), _ts: Date.now() } },
    },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));

  const feed = await h.call(COACH, 'GET', '/api/team/activity');
  assert.equal(feed.status, 200);
  assert.equal(feed.body.items.length, 1);
  assert.equal(feed.body.items[0].type, 'body.photo');
  assert.equal(feed.body.items[0].athleteId, ATHLETE);
  assert.equal(feed.body.items[0].count, 1);
  assert.equal(feed.body.items[0].thumb.hash, HASH);
  assert.ok(!JSON.stringify(feed.body.items[0]).includes('mime'));

  const other = await h.call(OTHER, 'GET', '/api/team/activity');
  assert.equal(other.body.items.length, 0, 'an unlinked coach does not see Ana\'s photo');
});

test('several photos in one PUT are one feed row, and a re-sync does not add another', async t => {
  const h = await startServer(t);
  const state = {
    unit: 'kg', workouts: [], routines: [],
    dayPhotos: {
      [HASH]: { d: '2026-11-25', m: photoRef(HASH), _ts: Date.now() },
      [HASH2]: { d: '2026-11-25', m: photoRef(HASH2), _ts: Date.now() },
    },
  };
  assert.equal((await h.call(ATHLETE, 'PUT', '/api/data', { baseRev: 1, stamped: true, state })).status, 200);
  const rev = (await h.call(ATHLETE, 'GET', '/api/data/rev')).body.rev;
  assert.equal((await h.call(ATHLETE, 'PUT', '/api/data', { baseRev: rev, stamped: true, state })).status, 200);
  const feed = await h.call(COACH, 'GET', '/api/team/activity');
  assert.equal(feed.body.items.length, 1);
  assert.equal(feed.body.items[0].type, 'body.photo');
  assert.equal(feed.body.items[0].count, 2);
});

test('a photo attached to a workout is also listed as body.photo', async t => {
  const h = await startServer(t);
  const end = Date.now() - 20_000;
  const w = {
    id: 'w-photo', d: new Date(end).toISOString().slice(0, 10), name: 'Push',
    start: end - 45 * 60_000, end,
    entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }],
    media: [photoRef()],
  };
  assert.equal((await h.call(ATHLETE, 'PUT', '/api/data', { baseRev: 1, stamped: true, state: { unit: 'kg', workouts: [w], routines: [] } })).status, 200);
  const feed = await h.call(COACH, 'GET', '/api/team/activity');
  const types = feed.body.items.map(it => it.type || 'workout.finished');
  assert.ok(types.includes('body.photo'), JSON.stringify(types));
  assert.ok(types.includes('workout.finished'), JSON.stringify(types));
});
