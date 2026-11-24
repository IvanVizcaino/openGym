/* Recipients of a finished-workout notice, the activity store, and when a push is (not) sent. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  coachesForAthlete, isBackfill, createTeamNotify, BACKFILL_MS, notifyKey, ACTIVITY_KEEP, ACTIVITY_MAX_BYTES,
} from '../team-notify.js';

const COACH = { id: 'c1', name: 'Grego', role: 'coach' };
const COACH2 = { id: 'c2', name: 'Luis', role: 'coach' };
const ADMIN = { id: 'admin', name: 'Admin', role: 'coach', admin: true };
const DISABLED = { id: 'c3', name: 'Off', role: 'coach', disabled: true };
const ANA = { id: 'a1', name: 'Ana', role: 'athlete', invitedBy: 'ABC123' };
const BEA = { id: 'a2', name: 'Bea', role: 'athlete' };

const isCoach = u => u?.role === 'coach';

test('coachesForAthlete: invite creator and assigned-routine coaches, else every coach', () => {
  const coaches = [COACH, COACH2, ADMIN, DISABLED];
  const invites = [{ code: 'ABC123', createdBy: 'c1' }, { code: 'OTHER', createdBy: 'c2' }];

  assert.deepEqual(
    coachesForAthlete(ANA, coaches, invites, { routines: [] }).map(c => c.id),
    ['c1'],
    'the invite author is enough',
  );
  assert.deepEqual(
    coachesForAthlete(BEA, coaches, invites, {
      routines: [{ id: 'r1', coach: { id: 'c2' } }, { id: 'r2', coach: { id: 'c1' } }],
    }).map(c => c.id).sort(),
    ['c1', 'c2'],
    'every coach tagged on a routine',
  );
  assert.deepEqual(
    coachesForAthlete(ANA, coaches, invites, { routines: [{ coach: { id: 'c2' } }] }).map(c => c.id).sort(),
    ['c1', 'c2'],
    'invite plus assigned, no duplicates',
  );
  assert.deepEqual(
    coachesForAthlete(BEA, coaches, invites, {}).map(c => c.id).sort(),
    ['admin', 'c1', 'c2'],
    'nobody linked → every enabled coach, never a disabled one',
  );
  assert.deepEqual(
    coachesForAthlete(ANA, coaches, [{ code: 'ABC123', createdBy: 'c3' }], {}).map(c => c.id).sort(),
    ['admin', 'c1', 'c2'],
    'an invite by a disabled (or unknown) coach does not count as a link, so all coaches',
  );
  assert.ok(
    coachesForAthlete(ANA, coaches, invites, { routines: [{ coach: { id: 'a1' } }] }).every(c => c.id !== 'a1'),
    'the athlete is never a recipient, even if a routine points at them',
  );
  assert.deepEqual(coachesForAthlete(ANA, null, null, null).map(c => c.id), []);
});

test('isBackfill: older than 12 hours, or no usable time', () => {
  const now = Date.parse('2026-11-24T18:00:00Z');
  assert.equal(isBackfill({ end: now - 3 * 3600_000 }, now), false);
  assert.equal(isBackfill({ end: now - BACKFILL_MS - 1 }, now), true);
  assert.equal(isBackfill({ start: now - BACKFILL_MS - 1000 }, now), true);
  assert.equal(isBackfill({}, now), true);
});

const NOW = Date.parse('2026-11-24T18:00:00Z');
const W = (id, endAgo, extra = {}) => ({
  id, d: '2026-11-24', name: 'Push', start: NOW - endAgo - 45 * 60_000, end: NOW - endAgo,
  entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 40, r: 10, done: true, phase: 'warmup' }] }],
  ...extra,
});

function harness(t, { states = {}, users, invites } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-notify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sent = [];
  const hub = createTeamNotify({
    dataDir: dir,
    users: () => users || [COACH, COACH2, ANA, BEA],
    invites: () => invites || [{ code: 'ABC123', createdBy: 'c1' }],
    isCoach,
    readState: uid => states[uid] || {},
    sendPush: (uid, payload) => { sent.push({ uid, payload }); },
    now: () => NOW,
  });
  return { hub, sent, dir };
}

test('a new recent workout is recorded and pushed to the linked coach only', t => {
  const { hub, sent } = harness(t);
  const w = W('w1', 60_000);
  const r = hub.onStateWrite(ANA, { workouts: [] }, { workouts: [w], unit: 'kg' });
  assert.equal(r.recorded, 1);
  assert.equal(r.pushed, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].uid, 'c1');
  assert.equal(sent[0].payload.tag, 'workout-finished:a1:w1');
  assert.equal(sent[0].payload.url, '#/team/a1');
  assert.match(sent[0].payload.title, /Ana/);
  assert.match(sent[0].payload.title, /Push/);
  assert.match(sent[0].payload.body, /45 min/);
  assert.match(sent[0].payload.body, /1 series|1 sets/);
  assert.match(sent[0].payload.body, /480 kg/);

  const feed = hub.listFor('c1');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.unread, 1);
  assert.equal(feed.items[0].athleteId, 'a1');
  assert.equal(feed.items[0].sets, 1);
  assert.equal(feed.items[0].volume, 480);
  assert.equal(hub.listFor('c2').items.length, 0, 'an unlinked coach does not see the row');
});

test('an edit, a re-sync and a re-upload of the same id do not notify again', t => {
  const { hub, sent } = harness(t);
  const w = W('w1', 60_000);
  hub.onStateWrite(ANA, { workouts: [] }, { workouts: [w] });
  sent.length = 0;
  const edited = W('w1', 60_000, { name: 'Push edited', note: 'secret' });
  assert.deepEqual(hub.onStateWrite(ANA, { workouts: [w] }, { workouts: [edited] }), { recorded: 0, pushed: 0 });
  assert.deepEqual(hub.onStateWrite(ANA, { workouts: [w] }, { workouts: [w] }), { recorded: 0, pushed: 0 });
  // Deleted locally, then the same id comes back (the reason notified ids are kept).
  const again = hub.onStateWrite(ANA, { workouts: [] }, { workouts: [W('w1', 30_000)] });
  assert.deepEqual(again, { recorded: 0, pushed: 0 });
  assert.equal(sent.length, 0);
  assert.equal(hub.listFor('c1').items.length, 1);
  assert.ok(!JSON.stringify(hub.listFor('c1').items[0]).includes('secret'));
});

test('opt-out turns the push off but the feed still records the session', t => {
  const { hub, sent } = harness(t, { states: { c1: { teamNotify: false, lang: 'en' } } });
  const r = hub.onStateWrite(ANA, { workouts: [] }, { workouts: [W('w2', 1000)] });
  assert.equal(r.recorded, 1);
  assert.equal(r.pushed, 0);
  assert.equal(sent.length, 0);
  assert.equal(hub.listFor('c1').items.length, 1);
});

test('a backfill older than 12 hours is listed and not pushed', t => {
  const { hub, sent } = harness(t);
  const r = hub.onStateWrite(ANA, { workouts: [] }, { workouts: [W('old', BACKFILL_MS + 60_000)] });
  assert.equal(r.recorded, 1);
  assert.equal(r.pushed, 0);
  assert.equal(sent.length, 0);
  assert.equal(hub.listFor('c1').items[0].workoutId, 'old');
});

test('a coach finishing their own session does not notify anyone', t => {
  const { hub, sent } = harness(t);
  const r = hub.onStateWrite(COACH, { workouts: [] }, { workouts: [W('mine', 1000)] });
  assert.deepEqual(r, { recorded: 0, pushed: 0 });
  assert.equal(sent.length, 0);
});

test('with no link, every coach is notified and can read the feed', t => {
  const { hub, sent } = harness(t);
  const r = hub.onStateWrite(BEA, { workouts: [] }, { workouts: [W('w3', 1000)] });
  assert.equal(r.recorded, 1);
  assert.equal(r.pushed, 2);
  assert.deepEqual(sent.map(s => s.uid).sort(), ['c1', 'c2']);
  assert.equal(hub.listFor('c1').items.length, 1);
  assert.equal(hub.listFor('c2').items.length, 1);
});

test('the push follows the coach language, defaulting to English', t => {
  const { hub, sent } = harness(t, { states: { c1: { lang: 'es' } } });
  hub.onStateWrite(ANA, { workouts: [] }, { workouts: [W('w4', 1000)] });
  assert.equal(sent[0].payload.title, 'Ana ha terminado Push');
  assert.match(sent[0].payload.body, /series/);
});

test('markSeen clears unread for that coach only', t => {
  let clock = NOW;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-notify-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hub = createTeamNotify({
    dataDir: dir,
    users: () => [COACH, COACH2, ANA, BEA],
    invites: () => [{ code: 'ABC123', createdBy: 'c1' }],
    isCoach,
    readState: () => ({}),
    sendPush: () => {},
    now: () => clock,
  });
  hub.onStateWrite(ANA, { workouts: [] }, { workouts: [W('w5', 1000)] });
  assert.equal(hub.listFor('c1').unread, 1);
  const seen = hub.markSeen('c1', clock);
  assert.equal(seen.ok, true);
  assert.equal(hub.listFor('c1').unread, 0);
  // A later session is unread again.
  clock = NOW + 60_000;
  hub.onStateWrite(ANA, { workouts: [W('w5', 1000)] }, { workouts: [W('w5', 1000), W('w6', 500)] });
  assert.equal(hub.listFor('c1').unread, 1);
});

test('the store is capped and survives a reload', t => {
  const { hub, dir } = harness(t);
  const first = W('keep-me', 1000);
  hub.onStateWrite(ANA, { workouts: [] }, { workouts: [first] });
  let prev = [first];
  for (let i = 0; i < ACTIVITY_KEEP; i++) {
    const w = W('n' + i, 1000);
    hub.onStateWrite(ANA, { workouts: prev }, { workouts: [...prev, w] });
    prev = [...prev, w];
  }
  assert.ok(hub._store().items.length <= ACTIVITY_KEEP);
  assert.ok(!hub._store().items.some(it => it.workoutId === 'keep-me'), 'the oldest row is dropped');
  const text = fs.readFileSync(path.join(dir, 'team-activity.json'), 'utf8');
  assert.ok(Buffer.byteLength(text) <= ACTIVITY_MAX_BYTES);
  hub._reload();
  assert.equal(hub.listFor('c1').items[0].workoutId, 'n' + (ACTIVITY_KEEP - 1));
});
