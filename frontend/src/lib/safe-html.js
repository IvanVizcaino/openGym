// Tiny HTML allowlist for the coach diet (editor + athlete view). No dependency: in the
// browser we walk a DOMParser tree; in Node (tests) we fall back to a tag stripper that
// keeps the same tags. Scripts, handlers and javascript: URLs never survive.

const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'A', 'DIV'])

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const escapeText = s => String(s).replace(/[&<>"]/g, c => ESC[c])

/** True when the string already looks like HTML (has a tag), not plain / Markdown. */
export function looksLikeHtml(s) {
  return /<[a-z][\s\S]*>/i.test(String(s || ''))
}

/** Empty for the diet field: only whitespace / breaks after tags are gone. */
export function isEmptyHtml(html) {
  return !String(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim()
}

function cleanHref(href) {
  const h = String(href || '').trim()
  if (/^https?:\/\//i.test(h)) return h
  return ''
}

function serialize(node, out) {
  if (node.nodeType === 3) { out.push(escapeText(node.nodeValue || '')); return }
  if (node.nodeType !== 1) return
  const tag = node.tagName
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME') return
  if (!ALLOWED.has(tag)) {
    for (const c of node.childNodes) serialize(c, out)
    return
  }
  if (tag === 'BR') { out.push('<br>'); return }
  if (tag === 'A') {
    const href = cleanHref(node.getAttribute('href'))
    out.push(href ? '<a href="' + escapeText(href) + '" rel="noopener noreferrer" target="_blank">' : '')
    for (const c of node.childNodes) serialize(c, out)
    if (href) out.push('</a>')
    return
  }
  const open = tag.toLowerCase()
  out.push('<' + open + '>')
  for (const c of node.childNodes) serialize(c, out)
  out.push('</' + open + '>')
}

/** Browser path: parse → allowlist → HTML string. */
function sanitizeDom(html) {
  const doc = new DOMParser().parseFromString('<div id="r">' + String(html || '') + '</div>', 'text/html')
  const root = doc.getElementById('r')
  const out = []
  for (const c of root.childNodes) serialize(c, out)
  return out.join('')
}

/**
 * Node / no-DOM path: drop disallowed tags and attributes, keep allowlisted structure.
 * Not a full HTML parser; good enough for the capped diet blob the coach saves.
 */
function sanitizeRegex(html) {
  let s = String(html || '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<(script|style)(\s[^>]*)?>[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|svg|math)(\s[^>]*)?\/?>/gi, '')
  s = s.replace(/\s(on\w+|formaction|style|class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = s.replace(/<\/?([a-z0-9]+)(\s[^>]*)?\/?>/gi, (m, name, attrs = '') => {
    const tag = name.toUpperCase()
    if (!ALLOWED.has(tag)) return ''
    if (tag === 'BR') return '<br>'
    const close = /^<\//.test(m)
    if (close) return '</' + name.toLowerCase() + '>'
    if (tag === 'A') {
      const hm = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attrs) || /\bhref\s*=\s*([^\s>]+)/i.exec(attrs)
      const href = cleanHref(hm ? hm[2] || hm[1] : '')
      return href ? '<a href="' + escapeText(href) + '" rel="noopener noreferrer" target="_blank">' : '<a>'
    }
    return '<' + name.toLowerCase() + '>'
  })
  // Anchors that lost a bad href become bare <a>…</a> — unwrap them.
  s = s.replace(/<a>([\s\S]*?)<\/a>/gi, '$1')
  return s
}

/** Allowlisted HTML only. Safe to put into contentEditable or dangerouslySetInnerHTML. */
export function sanitizeHtml(html) {
  if (typeof DOMParser !== 'undefined') {
    try { return sanitizeDom(html) } catch { /* fall through */ }
  }
  return sanitizeRegex(html)
}

/** Server-side strip used by api/team.js cleanDiet (kept in sync by tests). */
export function scrubDietHtml(html) {
  return sanitizeRegex(html).slice(0, 50000)
}
