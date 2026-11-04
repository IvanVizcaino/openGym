// The site's name and logo (Admin → Site, GET /api/config `site`). The logo's address is the
// server's own path: a paired phone puts its server in front, a subpath deployment its base.
import { remoteAuth, appBase } from './api.js'

// A paired phone's server, else this app's own base. Read defensively: a test that mocks api.js
// with only the calls it needs leaves these two out, and the sign-in screen must still render.
function defaultBase() {
  try { return remoteAuth()?.base || appBase().replace(/\/$/, '') } catch { return '' }
}

export const DEFAULT_SITE_NAME = 'openGym'

export function siteOf(config, { base = defaultBase() } = {}) {
  const s = config?.site
  const name = typeof s?.name === 'string' && s.name.trim() ? s.name.trim() : DEFAULT_SITE_NAME
  const logo = typeof s?.logo === 'string' && /^\/api\/site\/logo(\?v=[0-9a-f]+)?$/.test(s.logo) ? base + s.logo : null
  return { name, logo }
}
