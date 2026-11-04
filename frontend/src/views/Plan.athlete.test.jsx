// @vitest-environment happy-dom
// An athlete's plan is their coach's (lib/team.js): Plan shows it, with nothing to change it by.
// A coach (or a profile with no role) keeps every control, and gets the way to the Athletes screen.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from './Plan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, nav: [] }
  state.snapshot = () => ({ S: state.S, user: state.user, update: () => { throw new Error('an athlete changed the plan') } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.nav.push(to) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({ starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), planHasRoutines: () => true, printWholePlan: vi.fn() }))

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: { 1: ['r1'] }, dayPlan: {},
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }],
  }
  mocks.nav = []
  try { localStorage.removeItem('gym_plan_view') } catch { /* none */ }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Plan />))
const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent.trim() || b.getAttribute('aria-label'))

describe('Plan for an athlete', () => {
  it('shows the week the coach set, says whose it is, and offers nothing to change it', () => {
    mocks.user = { id: 'a', role: 'athlete' }
    mount()
    expect(host.textContent).toContain('Set by your coach')
    expect(host.querySelector('.plan-day[aria-label="Monday"] .tt').textContent).toBe('Push')
    expect(buttons()).not.toContain('Fixed Week')
    expect(buttons()).not.toContain('Plan options')
    expect(buttons()).not.toContain('Athletes')
    // A tap on the day opens the routine to look at, never the day's planner.
    act(() => host.querySelector('.plan-day[aria-label="Monday"]').click())
    expect(mocks.nav).toEqual(['/plan/r/r1'])
  })

  it('lists the routines without New routine or Edit', () => {
    mocks.user = { id: 'a', role: 'athlete' }
    localStorage.setItem('gym_plan_view', 'routines')
    mount()
    expect(host.textContent).toContain('Push')
    expect(buttons()).not.toContain('New routine')
    expect(buttons()).not.toContain('Edit')
  })
})

describe('Plan for a coach', () => {
  it('keeps the controls and adds the way to the athletes', () => {
    mocks.user = { id: 'c', role: 'coach' }
    mount()
    expect(buttons()).toContain('Athletes')
    expect(buttons()).toContain('Plan options')
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Athletes').click())
    expect(mocks.nav).toEqual(['/team'])
  })
})
