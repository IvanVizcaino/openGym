// The rule both sides keep about an athlete's plan: which fields are the coach's, and how a copy
// of the document gets the stored plan back. Pure and import-free, because the app imports it too
// (frontend/src/lib/team.js), the way it imports api/coach/core: an athlete's device takes the
// server's plan on every merge, exactly as the server puts it back on every push (team.js).

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const ROLES = ['coach', 'athlete'];
// What the coach owns in an athlete's document. `queue` is left to the athlete while a rotation
// is set (the app starts the next pass when a workout lands, lib/rotation.js); without one it is a
// planner's week and the coach's too.
export const PLAN_FIELDS = ['routines', 'week', 'dayPlan', 'programmes', 'programme', 'rotation', 'scheduleMode'];
const PER_KEY_PLAN = new Set(['week', 'dayPlan', 'programmes']);
const ORDER_KEY = 'routineOrder';
export const WEEK_DAYS = ['0', '1', '2', '3', '4', '5', '6'];   // getDay() indexes, as the app keys `week`

/** A profile's role. Admins coach unless someone set them otherwise; everybody else trains. */
export const roleOf = (user, isAdmin) => (ROLES.includes(user?.role) ? user.role : isAdmin ? 'coach' : 'athlete');

// Whether an edit stamp belongs to the plan: `week.1`, `programmes.abc`, `rotation`, the order.
const planStamp = k => {
  if (k === ORDER_KEY) return true;
  const dot = k.indexOf('.');
  return dot < 0 ? PLAN_FIELDS.includes(k) || k === 'queue' : PER_KEY_PLAN.has(k.slice(0, dot));
};

/**
 * An athlete's push with the stored plan put back. Mutates `next` and returns whether anything had
 * to be put back. `cur` is the stored document (null for a profile with none yet: then the plan
 * pushed is empty too, since nobody planned anything).
 */
export function lockPlan(cur, next) {
  const was = JSON.stringify(pickPlan(next));
  const keepQueue = isMap(cur?.rotation);
  for (const k of [...PLAN_FIELDS, ...(keepQueue ? [] : ['queue'])]) {
    if (cur && k in cur) next[k] = clone(cur[k]);
    else if (k === 'routines') next[k] = [];
    else delete next[k];
  }
  const ed = isMap(next.edited) ? { ...next.edited } : {};
  for (const k of Object.keys(ed)) if (planStamp(k) && !(keepQueue && k === 'queue')) delete ed[k];
  for (const [k, v] of Object.entries(isMap(cur?.edited) ? cur.edited : {})) if (planStamp(k) && !(keepQueue && k === 'queue')) ed[k] = v;
  if (Object.keys(ed).length) next.edited = ed; else delete next.edited;
  const del = isMap(next.deleted) ? { ...next.deleted } : {};
  if (isMap(cur?.deleted?.routines)) del.routines = clone(cur.deleted.routines); else delete del.routines;
  if (Object.keys(del).length) next.deleted = del; else delete next.deleted;
  return JSON.stringify(pickPlan(next)) !== was;
}

const pickPlan = S => {
  const out = {};
  for (const k of [...PLAN_FIELDS, 'queue']) if (S && k in S) out[k] = S[k];
  for (const [k, v] of Object.entries(isMap(S?.edited) ? S.edited : {})) if (planStamp(k)) out['edited.' + k] = v;
  if (isMap(S?.deleted?.routines)) out.deletedRoutines = S.deleted.routines;
  return out;
};
