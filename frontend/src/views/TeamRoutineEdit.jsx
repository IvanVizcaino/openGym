import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { exOr } from '../lib/exercises.js'
import { uid, exerciseNameText } from '../lib/format.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { supersetUnits, moveRoutineEntry, cleanupSg, exLine, pickedExerciseConfig } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet, supersetSheet } from '../sheets.jsx'
import { supersetMeta, setSupersetMeta } from '../lib/superset-meta.js'
import { fmtRest } from '../lib/duration.js'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, Row, SelectRow, Switch } from '../components/ui.jsx'
import { replaceSlotExercise } from '../lib/routines.js'
import { speedUnitOf } from '../lib/speed.js'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC, profileRule } from '../lib/progression.js'
import { viewTarget, exUnitOf } from '../lib/ex-unit.js'
import { isCoach } from '../lib/team.js'

/** Strip sync/coach bookkeeping before PUT — the server keeps id and coach itself. */
function payloadOf(r) {
  if (!r) return null
  const { _ts, _f, _u, coach, ...body } = r
  return { ...body, id: r.id, ex: Array.isArray(r.ex) ? r.ex.map(e => ({ ...e })) : [] }
}

/**
 * Opens the athlete's assigned routine on top of the athlete page (viewer). Edits go to
 * PUT /api/team/routine — the coach's own Plan routines are not touched.
 */
export function editAthleteRoutineSheet({ athleteId, athleteName, routine, onDone }) {
  if (!athleteId || !routine?.id) return
  useUI.getState().openSheet(close => (
    <div className="team-r-edit" role="dialog" aria-modal="true" aria-label={routine.name || t('Routine')}>
      <AthleteRoutineEditor
        athleteId={athleteId}
        athleteName={athleteName || ''}
        initial={routine}
        onClose={() => { close(); onDone?.() }}
      />
    </div>
  ), { kind: 'viewer' })
}

function AthleteRoutineEditor({ athleteId, athleteName, initial, onClose }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [r, setR] = useState(() => structuredClone(initial))
  const seq = useRef(0)
  const draft = useRef(structuredClone(initial))
  const nameTimer = useRef(null)
  const rid = initial.id

  useEffect(() => () => { clearTimeout(nameTimer.current) }, [])

  const persist = routine => {
    const n = ++seq.current
    draft.current = routine
    return api('/api/team/routine', { method: 'PUT', body: JSON.stringify({ athlete: athleteId, routine: payloadOf(routine) }) })
      .then(res => {
        if (n !== seq.current) return
        const next = (res.plan?.routines || []).find(x => String(x.id) === String(rid))
        if (next) { draft.current = structuredClone(next); setR(draft.current) }
      })
      .catch(e => { if (n === seq.current) toast(e.message) })
  }

  const commit = fn => {
    const cur = structuredClone(draft.current || r)
    if (!cur) return
    fn(cur)
    if (Array.isArray(cur.ex)) cleanupSg(cur.ex)
    draft.current = cur
    setR(cur)
    persist(cur)
  }

  const editEx = fn => commit(routine => { if (!Array.isArray(routine.ex)) routine.ex = []; fn(routine.ex) })
  const move = (i, dir) => {
    if (!moveRoutineEntry(r.ex || [], i, dir)) return
    editEx(ex => {
      const next = moveRoutineEntry(ex, i, dir)
      if (!next) return
      ex.splice(0, ex.length, ...next)
    })
  }
  const replace = i => {
    const openedOn = r.ex[i]?.id
    const picker = exercisePicker((ex, quick) => {
      const slot = draft.current?.ex?.[i]
      if (!slot || slot.id !== openedOn) { picker.close(); return }
      if (quick && ex.id === openedOn) { picker.close(); return }
      const apply = fn => {
        picker.close()
        editEx(list => { if (list[i] && list[i].id === openedOn) list[i] = fn(list[i]) })
        toast(t('Replaced with “{0}”', exerciseNameText(ex)))
      }
      if (quick) { apply(current => replaceSlotExercise(current, ex.id, S, r.id)); return }
      const next = replaceSlotExercise(slot, ex.id, S, r.id)
      exConfigSheet(ex, next, cfg => apply(current => ({ id: ex.id, sg: current.sg, ...cfg })), null, r, null, null, t('Replace'), { backups: true })
    }, { title: t('Replace exercise'), like: openedOn, backups: r.ex[i]?.subs })
  }
  const toggleLink = i => editEx(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
  })
  const addExercise = () => exercisePicker((ex, quick) => {
    if (quick) {
      editEx(x => x.push({ id: ex.id, ...pickedExerciseConfig(ex.id) }))
      toast(t('“{0}” added to {1}', exerciseNameText(ex), r.name))
    } else {
      exConfigSheet(ex, null, cfg => editEx(x => { x.push({ id: ex.id, ...cfg }) }), null, r, null, null, undefined, { backups: true })
    }
  })
  const removeAt = i => {
    const name = exerciseNameText(exOr(r.ex[i]?.id))
    editEx(ex => { ex.splice(i, 1) })
    toast(t('“{0}” left the routine.', name))
  }
  const removeFromPlan = () => confirmSheet({
    title: t('Take “{0}” out of their plan?', r.name),
    message: t('It comes off every day of their week. Their workouts stay.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => api('/api/team/unassign', { method: 'POST', body: JSON.stringify({ athlete: athleteId, routine: r.id }) })
      .then(() => { toast(t('Removed from their plan.')); onClose() })
      .catch(e => toast(e.message)),
  })

  const units = supersetUnits(r.ex || [])
  const ssPos = new Map()
  units.filter(u => u.length > 1).forEach((u, k) => u.forEach((idx, n) => ssPos.set(idx, String.fromCharCode(65 + (k % 26)) + (n + 1))))
  const unitOf = new Map(units.flatMap(u => u.map(idx => [idx, u])))
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())
  const editSuperset = i => {
    const sg = r.ex[i]?.sg
    if (!sg) return
    supersetSheet(supersetMeta(r.ex, unitOf.get(i)), meta => editEx(ex => { setSupersetMeta(ex, sg, meta) }))
  }

  return <div className="narrow">
    <div className="hdr">
      <button type="button" className="iconbtn" onClick={onClose} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" aria-label={t('Routine name')} defaultValue={r.name || ''} key={r.id}
          style={{ fontWeight: 600, fontSize: 'var(--fs-title3)', letterSpacing: '-.021em' }}
          onChange={e => {
            const name = e.target.value.trim() || t('Routine')
            if (draft.current) draft.current.name = name
            clearTimeout(nameTimer.current)
            nameTimer.current = setTimeout(() => commit(routine => { routine.name = name }), 400)
          }} />
        <div className="sub">{athleteName ? t('Editing {0}’s routine', athleteName) : t('Athlete’s assigned routine')}</div>
      </div>
      <button type="button" className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => commit(routine => { routine.emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || profileRule(S)} onChange={v => commit(routine => { routine.prog = v })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
      <Row icon="chartLineSlash" iconTint="var(--orange)" title={t('Deload routine')}
        subtitle={t('Its workouts do not count toward progression. They still show in history and statistics.')}>
        <Switch checked={r.excludeFromProgression === true} onChange={v => commit(routine => {
          if (v) routine.excludeFromProgression = true
          else delete routine.excludeFromProgression
        })} />
      </Row>
    </div>

    <div className="row between plan-sec-h routine-ex-h">
      <h4 className="sec">{t('Exercises')}</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addExercise}>{t('Add exercise')}</Button>
    </div>
    {(r.ex || []).length ? <div className="list routine-list">{(r.ex || []).map((e, i) => {
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const leavesUp = inSS.has(i) && !linkedPrev
      const leavesDown = inSS.has(i) && r.ex[i + 1]?.sg !== e.sg
      const openEx = () => exConfigSheet(ex, e, cfg => editEx(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...(x[i].sg ? { sgName: x[i].sgName, sgRest: x[i].sgRest } : {}), ...cfg } }),
        () => removeAt(i), r, null, () => replace(i), undefined, { backups: true })
      return <div key={i} className="routine-drag-row">
        {unitFirst.has(i) && (() => {
          const meta = supersetMeta(r.ex, unitOf.get(i))
          return <button type="button" className="ss-label ss-label-btn" onClick={() => editSuperset(i)} title={t('Name and rest of this superset')}>
            <Icon name="link" /><span className="ss-label-name">{meta.name || t('Superset')}</span>
            {meta.rest > 0 && <span className="dim">· {t('{0} rest after each round', fmtRest(meta.rest))}</span>}
            <Icon name="pencil" />
          </button>
        })()}
        <div className={'item tap-host' + (inSS.has(i) ? ' in-ss' : '')}>
          {ssPos.has(i) && <span className="ss-pos" aria-label={t('Superset position {0}', ssPos.get(i))}>{ssPos.get(i)}</span>}
          <Thumb ex={ex} />
          <button type="button" className="grow item-open tap-main" aria-haspopup="dialog" onClick={openEx}>
            <span className={`tt ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</span>
            <span className="ss">{exLine(viewTarget(S, e.id, e), exUnitOf(S, e.id), speedUnitOf(S))}</span>
            {e.note && <span className="small dim" style={{ marginTop: 2 }}>{e.note}</span>}
          </button>
          <div className="re-rail">
            {i > 0 ? <button type="button" className={'iconbtn re-link' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} aria-label={t('Superset with exercise above')} aria-pressed={!!linkedPrev} onClick={() => toggleLink(i)}><Icon name="link" /></button>
              : <span className="re-link" aria-hidden="true" />}
            <button type="button" className="iconbtn re-up" aria-label={t('Move up')} title={leavesUp ? t('Move out of the superset') : t('Move up')} disabled={!moveRoutineEntry(r.ex, i, -1)} onClick={() => move(i, -1)}><Icon name="chevronUp" /></button>
            <button type="button" className="iconbtn re-down" aria-label={t('Move down')} title={leavesDown ? t('Move out of the superset') : t('Move down')} disabled={!moveRoutineEntry(r.ex, i, 1)} onClick={() => move(i, 1)}><Icon name="chevronDown" /></button>
          </div>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet. Add your first one!')}</div>}

    <p className="sect-f">{t('Changes save to their plan right away.')}</p>
    <div className="sect-b re-acts re-danger" style={{ marginTop: 12 }}>
      <button type="button" className="lrow tap danger" onClick={removeFromPlan}>
        <Icon name="trash" className="re-act-i" />
        <span className="lrow-m"><span className="lrow-t">{t('Remove from their plan')}</span>
          <span className="lrow-s">{t('It comes off every day of their week. Their workouts stay.')}</span></span>
      </button>
    </div>
  </div>
}

/** Route entry (`/team/:id/r/:rid`): loads the athlete, then the same editor. */
export default function TeamRoutineEdit() {
  const nav = useNavigate()
  const { id: athleteId, rid } = useParams()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [pack, setPack] = useState(null)

  useEffect(() => {
    if (!isCoach(user) || !athleteId || !rid) return
    let alive = true
    api('/api/team/athlete?id=' + encodeURIComponent(athleteId))
      .then(d => {
        if (!alive) return
        const found = (d.plan?.routines || []).find(x => String(x.id) === String(rid))
        if (!found) { toast(t('That routine is no longer in their plan.')); nav('/team/' + athleteId); return }
        setPack({ athleteName: d.athlete?.name || '', routine: found })
      })
      .catch(e => { if (alive) { toast(e.message); nav('/team/' + athleteId) } })
    return () => { alive = false }
  }, [athleteId, rid, user])

  if (!isCoach(user)) return null
  if (!pack) return <div className="narrow"><div className="hdr">
    <button type="button" className="iconbtn" onClick={() => nav('/team/' + athleteId)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div className="sub" style={{ marginInlineStart: 12 }}>{t('Loading…')}</div>
  </div></div>

  return <AthleteRoutineEditor
    athleteId={athleteId}
    athleteName={pack.athleteName}
    initial={pack.routine}
    onClose={() => nav('/team/' + athleteId)}
  />
}
