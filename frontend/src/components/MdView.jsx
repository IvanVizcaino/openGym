// Renders the Markdown subset from lib/md.js as React nodes (no dangerouslySetInnerHTML).
import { createElement, Fragment } from 'react'
import { blocksOf, inlineOf } from '../lib/md.js'

function Inline({ text }) {
  return inlineOf(text).map((p, i) => {
    if (p.t === 'b') return <strong key={i}>{p.v}</strong>
    if (p.t === 'i') return <em key={i}>{p.v}</em>
    if (p.t === 'a') return <a key={i} href={p.href} rel="noopener noreferrer" target="_blank">{p.v}</a>
    return <Fragment key={i}>{p.v}</Fragment>
  })
}

export default function MdView({ source, className }) {
  const blocks = blocksOf(source)
  if (!blocks.length) return null
  return <div className={className || 'md'}>{blocks.map((b, i) => {
    if (b.t === 'h1') return createElement('h3', { key: i, className: 'md-h1' }, <Inline text={b.v} />)
    if (b.t === 'h2') return createElement('h4', { key: i, className: 'md-h2' }, <Inline text={b.v} />)
    if (b.t === 'ul') return <ul key={i} className="md-ul">{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>
    return <p key={i} className="md-p"><Inline text={b.v} /></p>
  })}</div>
}
