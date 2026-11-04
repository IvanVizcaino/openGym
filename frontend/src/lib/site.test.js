import { describe, it, expect } from 'vitest'
import { siteOf } from './site.js'

describe('siteOf', () => {
  it('falls back to openGym and no logo', () => {
    expect(siteOf(null, { base: '' })).toEqual({ name: 'openGym', logo: null })
    expect(siteOf({ site: { name: '  ', logo: null } }, { base: '' })).toEqual({ name: 'openGym', logo: null })
  })
  it('puts the server in front of the logo path, and takes nothing but that path', () => {
    expect(siteOf({ site: { name: 'Box', logo: '/api/site/logo?v=ab12' } }, { base: 'https://gym.example' }))
      .toEqual({ name: 'Box', logo: 'https://gym.example/api/site/logo?v=ab12' })
    expect(siteOf({ site: { logo: 'https://evil.example/x.png' } }, { base: '' }).logo).toBe(null)
  })
})
