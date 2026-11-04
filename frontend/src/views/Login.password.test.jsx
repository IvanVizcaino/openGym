// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The sign-in screen with password sign-in (#118). Only an instance that advertises
   `password_login` shows any of it; there, a browser without passkey support finally has a way
   in instead of being told to stay local, and creating a profile can use a password. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, config: null, sheets: [] }
  state.snapshot = () => ({
    config: state.config, S: {},
    setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: vi.fn(), loadConfig: vi.fn(async () => state.config),
    pushState: vi.fn(), pullState: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => mocks.webauthn, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const buttons = host => [...host.querySelectorAll('button')].map(b => b.textContent)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)

beforeEach(() => { mocks.webauthn = true; mocks.config = null; mocks.sheets.length = 0 })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('Login with password sign-in', () => {
  it('an instance without it looks exactly as before', () => {
    const page = mount(<Login />)
    expect(buttons(page)).not.toContain('Sign in with password')
    expect(page.textContent).toContain('Passkeys use your fingerprint. No passwords to remember.')
    mocks.webauthn = false
    const noPasskeys = mount(<Login />)
    expect(noPasskeys.textContent).toContain("This browser doesn't do passkeys, but you can still use openGym locally on this device.")
    expect(buttons(noPasskeys)).not.toContain('Sign in with password')
  })

  it('next to passkeys it is a second button, and the footer no longer says "no passwords"', () => {
    mocks.config = { password_login: true, allow_guest: true, first_profile: true }
    const page = mount(<Login />)
    expect(buttons(page).slice(0, 3)).toEqual(['Sign in with passkey', 'Sign in with password', 'Create new profile'])
    expect(page.textContent).toContain('Passkeys use your fingerprint. A password works too, where passkeys do not.')
    act(() => button(page, 'Sign in with password').click())
    const sheet = mount(mocks.sheets[0](() => {}))
    expect(sheet.querySelector('h3').textContent).toBe('Sign in with password')
    expect(sheet.querySelector('input[autocomplete="current-password"]')).toBeTruthy()
  })

  it('a browser without passkeys gets a way in instead of "stay local"', () => {
    mocks.webauthn = false
    mocks.config = { password_login: true, allow_guest: false, first_profile: true }
    const page = mount(<Login />)
    expect(page.textContent).toContain("This browser doesn't support passkeys. Sign in with your name and password instead.")
    expect(page.textContent).not.toContain('Try a browser or device with passkey support.')
    expect(buttons(page)).toEqual(['Sign in with password', 'Create new profile', 'Lost access?'])
    // Creating a profile here can only mean a password: no passkey/password choice to make.
    act(() => button(page, 'Create new profile').click())
    const sheet = mount(mocks.sheets[0](() => {}))
    expect(sheet.querySelector('.seg')).toBeNull()
    expect(sheet.querySelector('input[placeholder="Repeat the password"]')).toBeTruthy()
    expect(buttons(sheet)).toContain('Create profile')
  })

  it('where both work, creating a profile starts on the passkey and switches to a password', () => {
    mocks.config = { password_login: true, invite_only: false, first_profile: true }
    const page = mount(<Login />)
    act(() => button(page, 'Create new profile').click())
    const sheet = mount(mocks.sheets[0](() => {}))
    expect(buttons(sheet)).toContain('Create passkey')
    act(() => button(sheet, 'Password').click())
    expect(buttons(sheet)).toContain('Create profile')
    expect(sheet.querySelector('input[autocomplete="new-password"]')).toBeTruthy()
  })

  // Invite-only (lib/invite-link.js): no way to make a profile without an invite link, and with
  // one the sheet opens by itself with the code filled in, never typed.
  it('open signup on an instance with profiles: still no new profile without a link', () => {
    mocks.config = { password_login: true, invite_only: false }
    const page = mount(<Login />)
    expect(buttons(page)).not.toContain('Create new profile')
  })

  it('invite-only: offers no new profile without a link', () => {
    mocks.config = { password_login: true, invite_only: true }
    const page = mount(<Login />)
    expect(buttons(page)).not.toContain('Create new profile')
    expect(mocks.sheets.length).toBe(0)
  })

  it('invite-only: an invite link opens the sheet with its code', () => {
    sessionStorage.clear()
    history.replaceState(null, '', '/?invite=ab12cd34ef56ab78')
    mocks.config = { password_login: true, invite_only: true }
    const page = mount(<Login />)
    expect(location.search).toBe('')
    expect(buttons(page)).toContain('Create new profile')
    const sheet = mount(mocks.sheets[0](() => {}))
    expect(sheet.textContent).toContain('Invitation AB12CD34EF56AB78')
    act(() => button(sheet, 'Password').click())
    expect(sheet.querySelector('input[placeholder="Invite code"]')).toBe(null)
    sessionStorage.clear()
  })
})
