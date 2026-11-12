// Small Word-like editor for the coach diet: bold / italic / underline / heading / lists.
// contentEditable + document.execCommand (enough for this; no editor dependency).
import { useEffect, useRef } from 'react'
import { t } from '../lib/i18n.js'
import { sanitizeHtml, isEmptyHtml } from '../lib/safe-html.js'
import { Button } from './ui.jsx'

function run(cmd, val) {
  try { document.execCommand(cmd, false, val) } catch { /* older WebViews */ }
}

export default function RichText({ value, onChange, placeholder, minHeight = 180 }) {
  const ref = useRef(null)
  const primed = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || primed.current) return
    el.innerHTML = value ? sanitizeHtml(value) : ''
    primed.current = true
  }, [value])

  const emit = () => {
    const el = ref.current
    if (!el) return
    const html = sanitizeHtml(el.innerHTML)
    onChange?.(isEmptyHtml(html) ? '' : html)
  }

  const act = (cmd, val) => {
    ref.current?.focus()
    run(cmd, val)
    emit()
  }

  const onPaste = e => {
    e.preventDefault()
    const text = e.clipboardData?.getData('text/plain') || ''
    run('insertText', text)
    emit()
  }

  return <div className="rich">
    <div className="rich-bar" role="toolbar" aria-label={t('Edit diet')}>
      <Button type="button" size="sm" onMouseDown={e => e.preventDefault()} onClick={() => act('bold')}><b>{t('Bold')}</b></Button>
      <Button type="button" size="sm" onMouseDown={e => e.preventDefault()} onClick={() => act('italic')}><i>{t('Italic')}</i></Button>
      <Button type="button" size="sm" onMouseDown={e => e.preventDefault()} onClick={() => act('underline')}><u>{t('Underline')}</u></Button>
      <Button type="button" size="sm" onMouseDown={e => e.preventDefault()} onClick={() => {
        ref.current?.focus()
        run('formatBlock', 'h2')
        if (!ref.current?.querySelector('h2')) run('formatBlock', '<h2>')
        emit()
      }}>{t('Heading')}</Button>
      <Button type="button" size="sm" onMouseDown={e => e.preventDefault()} onClick={() => act('insertUnorderedList')}>{t('List')}</Button>
      <Button type="button" size="sm" onMouseDown={e => e.preventDefault()} onClick={() => act('insertOrderedList')}>{t('Numbered list')}</Button>
    </div>
    <div
      ref={ref}
      className="rich-ed md"
      contentEditable
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder || ''}
      style={{ minHeight }}
      onInput={emit}
      onBlur={emit}
      onPaste={onPaste}
    />
  </div>
}
