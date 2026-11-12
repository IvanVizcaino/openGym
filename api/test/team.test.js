/* team.js: what an athlete's push may not change, and how a coach's routine lands in an
   athlete's plan. Pure functions, no server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, lockPlan, assignRoutines, updateRoutine, removeRoutine, setWeek, setDiet, planOf, athleteRow, parseLogo, cleanSiteName } from '../team.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

test('roleOf: an admin coaches, everyone else trains, unless a role was set', () => {
  assert.equal(roleOf({ id: 'a' }, true), 'coach');
  assert.equal(roleOf({ id: 'a' }, false), 'athlete');
  assert.equal(roleOf({ id: 'a', role: 'athlete' }, true), 'athlete');
  assert.equal(roleOf({ id: 'a', role: 'coach' }, false), 'coach');
  assert.equal(roleOf({ id: 'a', role: 'boss' }, false), 'athlete');
});

test('lockPlan puts back the stored plan and its stamps, and leaves the rest alone', () => {
  const cur = {
    routines: [{ id: 'r1', name: 'Coach A', ex: [], _ts: 10 }],
    week: { 1: ['r1'] }, scheduleMode: 'week',
    edited: { 'week.1': 10, unit: 5 }, deleted: { routines: { old: 3 }, workouts: { w0: 2 } },
  };
  const next = {
    routines: [{ id: 'r1', name: 'Mine now', ex: [], _ts: 99 }, { id: 'r2', name: 'Extra', ex: [], _ts: 99 }],
    week: { 1: ['r2'], 3: ['r1'] }, scheduleMode: 'rotation', programme: { id: 'p' },
    edited: { 'week.1': 99, 'week.3': 99, scheduleMode: 99, theme: 50 },
    deleted: { routines: { r1: 99 }, workouts: { w1: 40 } },
    workouts: [{ d: '2026-11-01' }], theme: 'light',
  };
  assert.equal(lockPlan(cur, next), true);
  assert.deepEqual(next.routines, cur.routines);
  assert.deepEqual(next.week, cur.week);
  assert.equal(next.scheduleMode, 'week');
  assert.equal('programme' in next, false);
  assert.deepEqual(next.edited, { 'week.1': 10, theme: 50 });
  assert.deepEqual(next.deleted, { routines: { old: 3 }, workouts: { w1: 40 } });
  assert.deepEqual(next.workouts, [{ d: '2026-11-01' }]);
  assert.equal(next.theme, 'light');
});

test('lockPlan: a push that kept the plan reports nothing put back', () => {
  const cur = { routines: [{ id: 'r1', ex: [] }], week: { 2: ['r1'] }, edited: { 'week.2': 1 } };
  const next = JSON.parse(JSON.stringify({ ...cur, workouts: [{ d: 'x' }] }));
  assert.equal(lockPlan(cur, next), false);
});

test('lockPlan: a first push from an athlete brings no plan with it', () => {
  const next = { routines: [{ id: 'sample', ex: [] }], week: { 1: ['sample'] } };
  lockPlan(null, next);
  assert.deepEqual(next.routines, []);
  assert.equal('week' in next, false);
});

test('lockPlan puts the coach diet back and setDiet stamps it', () => {
  const cur = { diet: '# Breakfast\nOats', edited: { diet: 10 } };
  const next = { diet: 'Hacked', edited: { diet: 99, theme: 1 }, theme: 'light' };
  assert.equal(lockPlan(cur, next), true);
  assert.equal(next.diet, '# Breakfast\nOats');
  assert.equal(next.edited.diet, 10);
  assert.equal(next.edited.theme, 1);
  const S = {};
  setDiet(S, '  Eggs  ', 50);
  assert.equal(S.diet, '  Eggs  ');
  assert.equal(S.edited.diet, 50);
  assert.equal(planOf(S).diet, '  Eggs  ');
  setDiet(S, '', 60);
  assert.equal('diet' in S, false);
  assert.equal(planOf(S).diet, '');
  setDiet(S, '<p>ok</p><script>bad</script>', 70);
  assert.equal(S.diet, '<p>ok</p>');
});

test('lockPlan: the queue is the athlete\'s only while a rotation runs', () => {
  const withRotation = { rotation: { id: 'rot' }, queue: { items: [1] } };
  const n1 = { queue: { items: [2] }, edited: { queue: 9 } };
  lockPlan(withRotation, n1);
  assert.deepEqual(n1.queue, { items: [2] });
  assert.equal(n1.edited.queue, 9);
  const n2 = { queue: { items: [2] } };
  lockPlan({ queue: { items: [1] } }, n2);
  assert.deepEqual(n2.queue, { items: [1] });
});

test('assignRoutines copies with a new id, and replaces that copy when assigned again', () => {
  const S = { routines: [{ id: 'own', ex: [] }] };
  const src = { id: 'c1', name: 'Push', emoji: 'x', ex: [{ id: 'bench', sets: 3 }], _ts: 5, _f: { name: 5 } };
  const ids = assignRoutines(S, [src], 'coach', { days: { c1: ['1', '4', '9'] }, now: 100 });
  const copy = S.routines.find(r => r.id === ids.c1);
  assert.notEqual(copy.id, 'c1');
  assert.equal(copy.name, 'Push');
  assert.deepEqual(copy.coach, { id: 'coach', rid: 'c1', at: 100 });
  assert.equal(copy._ts, 100);
  assert.deepEqual(S.week, { 1: [copy.id], 4: [copy.id] });
  assert.equal(S.edited['week.1'], 100);
  assert.equal(S.edited.routineOrder, 100);

  const again = assignRoutines(S, [{ ...src, name: 'Push v2' }], 'coach', { days: { c1: ['2'] }, now: 200 });
  assert.equal(again.c1, copy.id);
  assert.equal(S.routines.length, 2);
  const v2 = S.routines.find(r => r.id === copy.id);
  assert.equal(v2.name, 'Push v2');
  assert.equal(v2._ts, 200);
  assert.equal(v2._f.name, 200);
  assert.deepEqual(S.week, { 2: [copy.id] });
});

test('assignRoutines: a copy removed before and assigned again is an add-back', () => {
  const S = {};
  const { c1 } = assignRoutines(S, [{ id: 'c1', ex: [] }], 'coach', { now: 1 });
  removeRoutine(S, c1, 2);
  assert.equal(S.deleted.routines[c1], 2);
  // Removed means its copy is gone, so the next assignment makes a new one.
  const { c1: c2 } = assignRoutines(S, [{ id: 'c1', ex: [] }], 'coach', { now: 3 });
  assert.notEqual(c2, c1);
  assert.equal(S.routines.length, 1);
});

test('updateRoutine edits the copy in place and keeps id and coach tag', () => {
  const S = {};
  const { c1 } = assignRoutines(S, [{ id: 'c1', name: 'Push', emoji: 'dumbbell', ex: [{ id: 'bench', sets: 3 }], prog: 'linear' }], 'coach', { now: 100 });
  const prev = S.routines.find(r => r.id === c1);
  const out = updateRoutine(S, c1, {
    id: 'ignored', name: 'Push + arms', emoji: 'arm', prog: 'double',
    ex: [{ id: 'bench', sets: 4 }, { id: 'curl', sets: 3 }], coach: { id: 'hacker' },
  }, 200);
  assert.equal(out.id, c1);
  assert.equal(out.name, 'Push + arms');
  assert.equal(out.prog, 'double');
  assert.equal(out.ex.length, 2);
  assert.deepEqual(out.coach, prev.coach);
  assert.equal(out._ts, 200);
  assert.equal(updateRoutine(S, 'nope', { id: 'nope', name: 'x' }, 201), null);
});

test('removeRoutine takes it off every day and records the removal', () => {
  const S = { routines: [{ id: 'a' }, { id: 'b' }], week: { 1: ['a', 'b'], 3: ['a'] } };
  assert.equal(removeRoutine(S, 'a', 7), true);
  assert.deepEqual(S.routines, [{ id: 'b' }]);
  assert.deepEqual(S.week, { 1: ['b'] });
  assert.equal(S.deleted.routines.a, 7);
  assert.equal(S.edited['week.3'], 7);
  assert.equal(removeRoutine(S, 'nope', 8), false);
});

test('setWeek keeps only routines the plan holds and stamps the days that changed', () => {
  const S = { routines: [{ id: 'a' }, { id: 'b' }], week: { 1: ['a'], 2: ['b'] }, edited: {} };
  setWeek(S, { 1: ['a'], 2: ['zzz'], 5: ['b', 'b'] }, 9);
  assert.deepEqual(S.week, { 1: ['a'], 5: ['b'] });
  assert.deepEqual(S.edited, { 'week.2': 9, 'week.5': 9, scheduleMode: 9 });
  assert.equal(S.scheduleMode, 'week');
  assert.deepEqual(planOf(S).week, { 1: ['a'], 5: ['b'] });
});

test('athleteRow counts the workouts of the last seven days', () => {
  const today = new Date().toISOString().slice(0, 10);
  const row = athleteRow({ id: 'u', name: 'Ana' }, { workouts: [{ d: '2000-01-01' }, { d: today }], routines: [{ id: 'a' }] });
  assert.equal(row.workouts, 2);
  assert.equal(row.thisWeek, 1);
  assert.equal(row.lastWorkout, today);
  assert.equal(row.routines, 1);
});

test('parseLogo takes PNG, JPEG and WebP and refuses everything else', () => {
  assert.equal(parseLogo('data:image/png;base64,' + PNG.toString('base64')).ext, 'png');
  assert.equal(parseLogo('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64')).error, 'logo-type');
  assert.equal(parseLogo('nope').error, 'logo-invalid');
  assert.equal(parseLogo('data:image/png;base64,' + Buffer.concat([PNG, Buffer.alloc(300 * 1024)]).toString('base64')).error, 'logo-too-large');
});

test('cleanSiteName trims, flattens and caps', () => {
  assert.equal(cleanSiteName('  Box\nGym  '), 'Box Gym');
  assert.equal(cleanSiteName('x'.repeat(80)).length, 40);
  assert.equal(cleanSiteName(5), '');
});
