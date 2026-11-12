import { describe, it, expect } from 'vitest'
import { keepServerPlan, roleOf, isAthlete, isCoach, athleteStats, toggleDay } from './team.js'

describe('roles', () => {
  it('reads the role the server sends; otherwise admin coaches and everybody else trains', () => {
    expect(roleOf({ role: 'coach' })).toBe('coach')
    expect(roleOf({ role: 'athlete' })).toBe('athlete')
    expect(roleOf({ role: 'boss' })).toBe('athlete')
    expect(roleOf({ admin: true })).toBe('coach')
    expect(roleOf({})).toBe('athlete')
    expect(roleOf(null)).toBe(null)
    expect(isAthlete({ role: 'athlete' })).toBe(true)
    expect(isCoach({ role: 'athlete' })).toBe(false)
  })
})

describe('keepServerPlan', () => {
  const server = { routines: [{ id: 'c1', name: 'Coach', ex: [] }], week: { 1: ['c1'] }, edited: { 'week.1': 5 } }
  const merged = () => ({ routines: [{ id: 'sample', ex: [] }], week: { 2: ['sample'] }, edited: { 'week.2': 9, theme: 3 }, workouts: [{ d: 'x' }] })

  it('gives an athlete the server plan and its stamps, and keeps the rest of the merge', () => {
    const m = keepServerPlan({ role: 'athlete' }, server, merged())
    expect(m.routines).toEqual(server.routines)
    expect(m.week).toEqual(server.week)
    expect(m.edited).toEqual({ 'week.1': 5, theme: 3 })
    expect(m.workouts).toEqual([{ d: 'x' }])
  })

  it('leaves a coach and a copy with no server alone; a profile with no role trains', () => {
    expect(keepServerPlan({ role: 'coach' }, server, merged()).routines[0].id).toBe('sample')
    expect(keepServerPlan({}, server, merged()).routines).toEqual(server.routines)
    expect(keepServerPlan({ role: 'athlete' }, null, merged()).routines[0].id).toBe('sample')
  })
})

describe('athleteStats', () => {
  const ws = [
    { d: '2026-10-01', vol: 1000, entries: [{ id: 'bench', best: 80 }] },
    { d: '2026-10-28', vol: 2000, entries: [{ id: 'bench', best: 90 }, { id: 'squat', best: 120 }] },
    { d: '2026-11-02', vol: 3000, entries: [{ id: 'squat', best: 110 }] },
  ]
  const bestOf = e => ({ est: e.best, w: e.best, r: 1 })
  const s = athleteStats(ws, { today: '2026-11-03', weeks: 2, volumeOf: () => 0, bestOf })

  it('counts the last 7 and 30 days, and the volume of the last 30', () => {
    expect(s.total).toBe(3)
    expect(s.last7).toBe(2)
    expect(s.last30).toBe(2)
    expect(s.volume30).toBe(5000)
    expect(s.lastDay).toBe('2026-11-02')
  })

  it('puts sessions into weeks ending today, oldest first', () => {
    expect(s.perWeek).toEqual([
      { from: '2026-10-21', to: '2026-10-27', n: 0 },
      { from: '2026-10-28', to: '2026-11-03', n: 2 },
    ])
  })

  it('keeps the best estimate per exercise, highest first', () => {
    expect(s.bestLifts.map(b => [b.id, b.est, b.d])).toEqual([['squat', 120, '2026-10-28'], ['bench', 90, '2026-10-28']])
  })
})

describe('toggleDay', () => {
  it('switches a routine on and off a day, and drops a day left empty', () => {
    expect(toggleDay({ 1: ['a'] }, 1, 'b')).toEqual({ 1: ['a', 'b'] })
    expect(toggleDay({ 1: ['a'] }, 1, 'a')).toEqual({})
    expect(toggleDay(null, 3, 'a')).toEqual({ 3: ['a'] })
  })
})
