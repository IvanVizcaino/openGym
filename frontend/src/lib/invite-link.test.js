import { describe, it, expect } from 'vitest'
import { inviteIn, pendingInvite, clearInvite, inviteLink } from './invite-link.js'

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }

describe('inviteIn', () => {
  it('reads the code from the query or from behind the hash', () => {
    expect(inviteIn({ search: '?invite=ab12cd34', hash: '' })).toBe('AB12CD34')
    expect(inviteIn({ search: '', hash: '#/home?invite=AB12CD34' })).toBe('AB12CD34')
  })
  it('takes nothing that is not a code', () => {
    expect(inviteIn({ search: '', hash: '#/home' })).toBe(null)
    expect(inviteIn({ search: '?invite=<script>', hash: '' })).toBe(null)
    expect(inviteIn(null)).toBe(null)
  })
})

describe('pendingInvite', () => {
  it('remembers the code for the tab and hands it back without the link', () => {
    const store = mem()
    expect(pendingInvite({ search: '?invite=AB12CD34', hash: '', href: 'https://gym.example/?invite=AB12CD34' }, store)).toBe('AB12CD34')
    expect(pendingInvite({ search: '', hash: '#/home', href: 'https://gym.example/#/home' }, store)).toBe('AB12CD34')
    clearInvite(store)
    expect(pendingInvite({ search: '', hash: '', href: 'https://gym.example/' }, store)).toBe(null)
  })
})

describe('inviteLink', () => {
  it('points at this instance, or at the paired server', () => {
    expect(inviteLink('AB12', { loc: { origin: 'https://gym.example', pathname: '/box/' } })).toBe('https://gym.example/box/?invite=AB12')
    expect(inviteLink('AB12', { server: 'https://gym.example/' })).toBe('https://gym.example/?invite=AB12')
  })
})
