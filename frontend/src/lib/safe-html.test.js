import { describe, it, expect } from 'vitest'
import { sanitizeHtml, looksLikeHtml, isEmptyHtml, scrubDietHtml, escapeText } from './safe-html.js'

describe('safe-html', () => {
  it('keeps simple formatting', () => {
    const html = sanitizeHtml('<p>Hi <strong>there</strong></p><ul><li>one</li></ul>')
    expect(html).toContain('<strong>there</strong>')
    expect(html).toContain('<li>one</li>')
  })

  it('strips scripts and handlers', () => {
    const html = sanitizeHtml('<p onclick="x()">x</p><script>alert(1)</script><img src=x onerror=alert(1)>')
    expect(html.toLowerCase()).not.toContain('script')
    expect(html.toLowerCase()).not.toContain('onclick')
    expect(html.toLowerCase()).not.toContain('onerror')
    expect(html).toContain('x')
  })

  it('only keeps http(s) links', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('x')
    expect(sanitizeHtml('<a href="https://ex.com">x</a>')).toContain('https://ex.com')
  })

  it('detects empty and html-looking strings', () => {
    expect(isEmptyHtml('<p><br></p>')).toBe(true)
    expect(isEmptyHtml('<p>a</p>')).toBe(false)
    expect(looksLikeHtml('## Lunch')).toBe(false)
    expect(looksLikeHtml('<p>Lunch</p>')).toBe(true)
  })

  it('scrubDietHtml matches the server strip', () => {
    expect(scrubDietHtml('<p>ok</p><script>bad</script>')).toBe('<p>ok</p>')
    expect(escapeText('<')).toBe('&lt;')
  })
})
