// Invite links: on an invite-only instance the sign-in screen offers "Create new profile" only to
// someone who came with one (`?invite=CODE`, or `#/...?invite=CODE` behind the hash). The code is
// kept for this tab (sessionStorage), so a reload or a passkey prompt that went wrong does not
// lose it, and taken out of the address bar so it is not bookmarked or shared by accident.
import { appBase } from './app-base.js'

const KEY = 'gym_invite'
const CODE = /^[A-Za-z0-9-]{4,40}$/

const fromQuery = q => {
  const v = new URLSearchParams(q || '').get('invite')
  return v && CODE.test(v.trim()) ? v.trim().toUpperCase() : null
}

/** The invite code a location carries, in its query or behind its hash; null without one. */
export function inviteIn(loc) {
  if (!loc) return null
  const hash = String(loc.hash || '')
  const at = hash.indexOf('?')
  return fromQuery(loc.search) || (at >= 0 ? fromQuery(hash.slice(at)) : null)
}

/** The code this tab arrived with (now or earlier in this tab), and the address cleaned of it. */
export function pendingInvite(loc = typeof location !== 'undefined' ? location : null, store = safeSession()) {
  const code = inviteIn(loc)
  if (code) {
    try { store?.setItem(KEY, code) } catch { /* private mode: it lives as long as this page */ }
    try {
      const url = new URL(loc.href)
      url.searchParams.delete('invite')
      const [h, q] = url.hash.split('?')
      if (q != null) { const p = new URLSearchParams(q); p.delete('invite'); url.hash = h + (p.toString() ? '?' + p : '') }
      history.replaceState(history.state, '', url.toString())
    } catch { /* an address that cannot be rewritten keeps its code; harmless */ }
    return code
  }
  try { return store?.getItem(KEY) || null } catch { return null }
}

/** Once the profile is made the code is spent. */
export function clearInvite(store = safeSession()) {
  try { store?.removeItem(KEY) } catch { /* nothing to clear */ }
}

/** The link to hand out for `code`: this instance's address (`server` for a paired phone). */
export function inviteLink(code, { server, loc = typeof location !== 'undefined' ? location : null } = {}) {
  const base = server ? server.replace(/\/+$/, '') + '/' : (loc ? loc.origin : '') + appBase(loc)
  return base + '?invite=' + encodeURIComponent(code)
}

function safeSession() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null }
}
