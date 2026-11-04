// Coaches and athletes (api/team.js). An athlete trains the plan their coach set: the server puts
// the stored plan back on every push, and this device takes the server's plan on every merge
// (useStore mergeInto), with the same rule, imported from the server's own file, so the two can
// never disagree about what the plan is.
import { lockPlan, PLAN_FIELDS, WEEK_DAYS } from '../../../api/team-plan.js'

export { PLAN_FIELDS, WEEK_DAYS }

/** The signed-in profile's role; null signed out or on a server from before roles. */
export const roleOf = user => (user && (user.role === 'coach' || user.role === 'athlete') ? user.role : null)
export const isAthlete = user => roleOf(user) === 'athlete'
export const isCoach = user => roleOf(user) === 'coach'

/**
 * `merged` with the plan of `server` (the copy the server sent) and its stamps, for an athlete.
 * Mutates and returns `merged`. Nothing changes for anyone else.
 */
export function keepServerPlan(user, server, merged) {
  if (!isAthlete(user) || !server || !merged) return merged
  lockPlan(server, merged)
  return merged
}

const DAY_MS = 86400000
const isoDay = ms => new Date(ms).toISOString().slice(0, 10)

/**
 * What the coach's Stats tab shows of an athlete's log (GET /api/team/athlete `workouts`):
 * counts over the last 7 and 30 days, the volume of the last 30, sessions per week for the last
 * `weeks` weeks (oldest first), and the best estimated 1RM per exercise, highest first.
 * `volumeOf` and `bestOf` are lib/history.js workoutVolume and lib/onerm.js bestSetOf, passed in
 * so this stays free of the exercise catalogue.
 */
export function athleteStats(workouts, { today, weeks = 8, volumeOf, bestOf, top = 8 } = {}) {
  const ws = (Array.isArray(workouts) ? workouts : []).filter(w => w && typeof w.d === 'string')
  const end = Date.parse(today + 'T00:00:00Z')
  const since = n => isoDay(end - (n - 1) * DAY_MS)
  const last7 = ws.filter(w => w.d >= since(7) && w.d <= today)
  const last30 = ws.filter(w => w.d >= since(30) && w.d <= today)
  const perWeek = Array.from({ length: weeks }, (_, i) => {
    const from = isoDay(end - ((weeks - i) * 7 - 1) * DAY_MS)
    const to = isoDay(end - (weeks - i - 1) * 7 * DAY_MS)
    return { from, to, n: ws.filter(w => w.d >= from && w.d <= to).length }
  })
  const best = new Map()
  if (bestOf) {
    for (const w of ws) for (const e of Array.isArray(w.entries) ? w.entries : []) {
      if (!e || e.id == null) continue
      const b = bestOf(e)
      if (b && b.est > (best.get(e.id)?.est || 0)) best.set(e.id, { id: e.id, est: b.est, w: b.w, r: b.r, d: w.d })
    }
  }
  return {
    total: ws.length,
    last7: last7.length,
    last30: last30.length,
    volume30: volumeOf ? last30.reduce((sum, w) => sum + (Number(w.vol ?? volumeOf(w)) || 0), 0) : 0,
    lastDay: ws.reduce((m, w) => (w.d > m ? w.d : m), '') || null,
    perWeek,
    bestLifts: [...best.values()].sort((a, b) => b.est - a.est).slice(0, top),
  }
}

/** A week as the coach edits it: `{ [day]: [ids] }` with routine `id` switched on or off `day`. */
export function toggleDay(week, day, id) {
  const d = String(day)
  const ids = [].concat(week?.[d] || []).map(String)
  const next = ids.includes(String(id)) ? ids.filter(x => x !== String(id)) : [...ids, String(id)]
  const out = { ...(week || {}) }
  if (next.length) out[d] = next; else delete out[d]
  return out
}
