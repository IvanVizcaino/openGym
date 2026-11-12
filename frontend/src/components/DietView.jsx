// Renders a coach diet: HTML from the rich editor, or legacy Markdown via lib/md.js.
import { looksLikeHtml, sanitizeHtml, isEmptyHtml } from '../lib/safe-html.js'
import { mdHtml } from '../lib/md.js'

export default function DietView({ source, className }) {
  const raw = String(source || '')
  if (!raw.trim()) return null
  const html = looksLikeHtml(raw) ? sanitizeHtml(raw) : mdHtml(raw)
  if (isEmptyHtml(html)) return null
  return <div className={className || 'md'} dangerouslySetInnerHTML={{ __html: html }} />
}
