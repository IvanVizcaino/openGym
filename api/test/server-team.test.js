/* Coaches and athletes through the real server.js in a child: a coach assigns routines and sets
   the week, an athlete's push cannot change the plan, only coaches reach /api/team/*, invites
   hand out roles, and the admin sets the site name and logo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const ADMIN = 'u_admin', COACH = 'u_coach', ATHLETE = 'u_ath', OTHER = 'u_ath2';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });

const withoutSignupFlags = env => {
  const { INVITE_ONLY, ALLOW_GUEST, FIRST_USER_ADMIN, ...rest } = env;
  return rest;
};

async function startServer(t, { empty = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-team-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const now = new Date().toISOString();
  if (!empty) fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Admin', created: now, admin: true, owner: true },
      { id: COACH, name: 'Coach', created: now, role: 'coach' },
      { id: ATHLETE, name: 'Ana', created: now },
      { id: OTHER, name: 'Bea', created: now, role: 'athlete' }
    ], creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${COACH}.json`), JSON.stringify({
    unit: 'kg', _rev: 1,
    routines: [{ id: 'push', name: 'Push', emoji: 'x', ex: [{ id: '0025', sets: 3, reps: 8 }, { id: 'cx1', sets: 2 }], _ts: 1 }],
    customEx: [{ id: 'cx1', name: 'Sled push', _ts: 1 }]
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    // Without INVITE_ONLY, ALLOW_GUEST and FIRST_USER_ADMIN: what this fork does with none set
    // (invite-only, no guests) is part of what is tested here. `npm test` sets the upstream ones.
    env: { ...withoutSignupFlags(process.env), PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', SITE_NAME: 'Box Norte' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (uid, method, p, body) => {
    const r = await fetch(api + p, { method, headers: uid ? as(uid) : body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), type };
  };
  h.state = uid => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'));
  return h;
}

test('a coach plans an athlete, and the athlete cannot change the plan', async t => {
  const h = await startServer(t);

  // Only coaches (admins coach by default) reach the team routes.
  assert.equal((await h.call(ATHLETE, 'GET', '/api/team/athletes')).status, 403);
  assert.equal((await h.call(null, 'GET', '/api/team/athletes')).status, 401);
  const list = await h.call(COACH, 'GET', '/api/team/athletes');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.athletes.map(a => a.id).sort(), [ATHLETE, OTHER]);
  assert.equal((await h.call(ADMIN, 'GET', '/api/team/athletes')).status, 200);
  // A coach is no athlete: nobody plans for them through here.
  assert.equal((await h.call(COACH, 'GET', `/api/team/athlete?id=${ADMIN}`)).status, 404);

  const me = await h.call(ATHLETE, 'GET', '/api/me');
  assert.equal(me.body.user.role, 'athlete');

  // Assign to both athletes, on Monday and Thursday.
  const a = await h.call(COACH, 'POST', '/api/team/assign', { routines: ['push'], athletes: [ATHLETE, OTHER], days: { push: ['1', '4'] } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const copyId = a.body.assigned[ATHLETE].push;
  let S = h.state(ATHLETE);
  assert.equal(S._rev, 1);
  assert.equal(S.routines.length, 1);
  assert.equal(S.routines[0].id, copyId);
  assert.equal(S.routines[0].coach.rid, 'push');
  assert.deepEqual(S.week, { 1: [copyId], 4: [copyId] });
  assert.deepEqual(S.customEx.map(x => x.id), ['cx1']);
  assert.equal(h.state(OTHER).routines.length, 1);

  // The athlete pushes a copy with the plan changed and a workout logged.
  const push = await h.call(ATHLETE, 'PUT', '/api/data', {
    baseRev: 1, stamped: true,
    state: { ...S, routines: [{ ...S.routines[0], name: 'Mine', _ts: Date.now() + 1000 }], week: { 2: [copyId] },
      edited: { ...S.edited, 'week.2': Date.now() + 1000 }, workouts: [{ id: 'w1', d: '2026-11-02', start: 1, end: 2, entries: [] }] }
  });
  assert.equal(push.status, 200);
  S = h.state(ATHLETE);
  assert.equal(S.routines[0].name, 'Push');
  assert.deepEqual(S.week, { 1: [copyId], 4: [copyId] });
  assert.equal(S.workouts.length, 1);
  assert.equal(S._rev, 3, 'a push that had its plan put back moves the revision past the one it was told');

  // The coach sees the log and the plan.
  const one = await h.call(COACH, 'GET', `/api/team/athlete?id=${ATHLETE}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.workouts.length, 1);
  assert.equal(one.body.plan.routines[0].id, copyId);

  // The week, then removing the routine.
  const w = await h.call(COACH, 'PUT', '/api/team/week', { athlete: ATHLETE, week: { 3: [copyId] } });
  assert.equal(w.status, 200);
  assert.deepEqual(h.state(ATHLETE).week, { 3: [copyId] });
  assert.equal((await h.call(COACH, 'POST', '/api/team/unassign', { athlete: ATHLETE, routine: copyId })).status, 200);
  S = h.state(ATHLETE);
  assert.deepEqual(S.routines, []);
  assert.deepEqual(S.week, {});
  assert.ok(S.deleted.routines[copyId] > 0);

  // A coach's own push keeps their plan changes.
  const C = h.state(COACH);
  const cp = await h.call(COACH, 'PUT', '/api/data', { baseRev: 1, state: { ...C, routines: [...C.routines, { id: 'pull', name: 'Pull', ex: [] }] } });
  assert.equal(cp.status, 200);
  assert.equal(h.state(COACH).routines.length, 2);
});

test('invites hand out roles: a coach invites athletes, an admin invites coaches', async t => {
  const h = await startServer(t);
  const ci = await h.call(COACH, 'POST', '/api/team/invites/new', { note: 'for Carla' });
  assert.equal(ci.status, 200);
  assert.equal(ci.body.invite.role, 'athlete');
  assert.equal((await h.call(COACH, 'GET', '/api/team/invites')).body.invites.length, 1);
  assert.equal((await h.call(ATHLETE, 'POST', '/api/team/invites/new', {})).status, 403);

  const ai = await h.call(ADMIN, 'POST', '/api/admin/invites/new', { role: 'coach' });
  assert.equal(ai.body.invite.role, 'coach');
  // The admin's coach invite is not the coach's to revoke.
  assert.equal((await h.call(COACH, 'POST', '/api/team/invites/revoke', { code: ai.body.invite.code })).status, 404);
  assert.equal((await h.call(COACH, 'POST', '/api/team/invites/revoke', { code: ci.body.invite.code })).status, 200);

  // Invite-only by default: signing up without a code is refused on an instance with profiles.
  const cfg = await h.call(null, 'GET', '/api/config');
  assert.equal(cfg.body.invite_only, true);
  assert.equal(cfg.body.allow_guest, false);
  assert.equal('first_profile' in cfg.body, false);
  assert.equal((await h.call(null, 'POST', '/api/register/options', { name: 'Zed' })).status, 403);

  // An admin turns an athlete into a coach.
  const r = await h.call(ADMIN, 'POST', '/api/admin/user/team-role', { id: ATHLETE, role: 'coach' });
  assert.equal(r.body.role, 'coach');
  assert.equal((await h.call(ATHLETE, 'GET', '/api/team/athletes')).status, 200);
  assert.equal((await h.call(COACH, 'POST', '/api/admin/user/team-role', { id: OTHER, role: 'coach' })).status, 403);
});

test('the admin sets the site name and logo, and everybody reads them', async t => {
  const h = await startServer(t);
  let cfg = await h.call(null, 'GET', '/api/config');
  assert.deepEqual(cfg.body.site, { name: 'Box Norte', logo: null });

  assert.equal((await h.call(COACH, 'PUT', '/api/admin/site', { name: 'Mine' })).status, 403);
  assert.equal((await h.call(ADMIN, 'PUT', '/api/admin/site', { name: '  Crossfit Sur ' })).body.site.name, 'Crossfit Sur');
  const bad = await h.call(ADMIN, 'PUT', '/api/admin/site/logo', { data: 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64') });
  assert.equal(bad.body.code, 'logo-type');
  const up = await h.call(ADMIN, 'PUT', '/api/admin/site/logo', { data: 'data:image/png;base64,' + PNG.toString('base64') });
  assert.equal(up.status, 200);
  assert.match(up.body.site.logo, /^\/api\/site\/logo\?v=[0-9a-f]+$/);

  cfg = await h.call(null, 'GET', '/api/config');
  assert.equal(cfg.body.site.name, 'Crossfit Sur');
  const logo = await h.call(null, 'GET', cfg.body.site.logo);
  assert.equal(logo.status, 200);
  assert.equal(logo.type, 'image/png');
  assert.deepEqual(logo.body, PNG);

  assert.equal((await h.call(ADMIN, 'DELETE', '/api/admin/site/logo')).body.site.logo, null);
  assert.equal((await h.call(null, 'GET', '/api/site/logo')).status, 404);
  assert.equal((await h.call(ADMIN, 'PUT', '/api/admin/site', { name: '' })).body.site.name, 'Box Norte');
});

test('with no signup settings at all: invite-only and no guests, except the very first profile', async t => {
  const h = await startServer(t, { empty: true });
  let cfg = await h.call(null, 'GET', '/api/config');
  assert.equal(cfg.body.allow_guest, false);
  assert.equal(cfg.body.invite_only, false, 'an empty instance lets its first profile in without a code');
  assert.equal(cfg.body.first_profile, true, 'and says so, so the sign-in screen offers it');
  const first = await h.call(null, 'POST', '/api/register/options', { name: 'Owner' });
  assert.equal(first.status, 200);
});
