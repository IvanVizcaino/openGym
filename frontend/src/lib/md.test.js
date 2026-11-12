import { describe, it, expect } from 'vitest'
import { blocksOf, inlineOf, mdHtml } from './md.js'

describe('md', () => {
  it('parses headings, lists, bold, italic and links', () => {
    const src = `# Diet
## Breakfast
- **Oats** with *milk*
- [Recipe](https://example.com/oats)

Chicken and rice.`
    expect(blocksOf(src).map(b => b.t)).toEqual(['h1', 'h2', 'ul', 'p'])
    expect(inlineOf('**Oats** with *milk*')).toEqual([
      { t: 'b', v: 'Oats' }, { t: 'text', v: ' with ' }, { t: 'i', v: 'milk' }
    ])
    const html = mdHtml(src)
    expect(html).toContain('<h1>Diet</h1>')
    expect(html).toContain('<strong>Oats</strong>')
    expect(html).toContain('<em>milk</em>')
    expect(html).toContain('href="https://example.com/oats"')
    expect(html).not.toContain('<script')
  })

  it('escapes raw HTML in the source', () => {
    expect(mdHtml('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })
})
