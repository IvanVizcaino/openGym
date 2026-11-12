// Small Markdown subset for the athlete diet (coach-written). No HTML passthrough: every token
// becomes a React node (or plain string). Covers paragraphs, # / ## headings, **bold**, *italic*,
// unordered lists, and http(s) links. Enough for a meal plan without a dependency.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeText = s => String(s).replace(/[&<>"]/g, c => ESC[c])

/** Inline pieces of one line → array of { t:'text'|'b'|'i'|'a', v, href? }. */
export function inlineOf(line) {
  const out = []
  const src = String(line)
  // **bold**, *italic*, [label](http…). Left-to-right, no nesting of the same marker.
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
  let i = 0, m
  while ((m = re.exec(src))) {
    if (m.index > i) out.push({ t: 'text', v: src.slice(i, m.index) })
    if (m[1] != null) out.push({ t: 'b', v: m[1] })
    else if (m[2] != null) out.push({ t: 'i', v: m[2] })
    else out.push({ t: 'a', v: m[3], href: m[4] })
    i = m.index + m[0].length
  }
  if (i < src.length) out.push({ t: 'text', v: src.slice(i) })
  return out.length ? out : [{ t: 'text', v: '' }]
}

/**
 * Block list from Markdown source: { t:'h1'|'h2'|'p'|'ul', items?: string[], v?: string }[].
 * Blank lines separate paragraphs; consecutive `- ` / `* ` lines are one list.
 */
export function blocksOf(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (/^##\s+/.test(line)) { out.push({ t: 'h2', v: line.replace(/^##\s+/, '') }); i++; continue }
    if (/^#\s+/.test(line)) { out.push({ t: 'h1', v: line.replace(/^#\s+/, '') }); i++; continue }
    if (/^[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++ }
      out.push({ t: 'ul', items })
      continue
    }
    const parts = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^#{1,2}\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i])) {
      parts.push(lines[i]); i++
    }
    out.push({ t: 'p', v: parts.join(' ') })
  }
  return out
}

/** Escape + turn inline tokens into a safe HTML string (for tests / non-React). */
export function inlineHtml(line) {
  return inlineOf(line).map(p => {
    if (p.t === 'b') return '<strong>' + escapeText(p.v) + '</strong>'
    if (p.t === 'i') return '<em>' + escapeText(p.v) + '</em>'
    if (p.t === 'a') return '<a href="' + escapeText(p.href) + '" rel="noopener noreferrer" target="_blank">' + escapeText(p.v) + '</a>'
    return escapeText(p.v)
  }).join('')
}

/** Full document → safe HTML string (tests). */
export function mdHtml(src) {
  return blocksOf(src).map(b => {
    if (b.t === 'h1') return '<h1>' + inlineHtml(b.v) + '</h1>'
    if (b.t === 'h2') return '<h2>' + inlineHtml(b.v) + '</h2>'
    if (b.t === 'ul') return '<ul>' + b.items.map(it => '<li>' + inlineHtml(it) + '</li>').join('') + '</ul>'
    return '<p>' + inlineHtml(b.v) + '</p>'
  }).join('')
}
