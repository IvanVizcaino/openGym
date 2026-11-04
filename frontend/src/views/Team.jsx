import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, remoteAuth } from '../lib/api.js'
import { inviteLink } from '../lib/invite-link.js'
import { t } from '../lib/i18n.js'
import { DAYS, DAYN, weekOrder, weekStartOf, fmtDate, fmtDur, fmtNum, fmtVol, exCount, todayISO, exerciseNameText } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { bestSetOf } from '../lib/onerm.js'
import { exOr } from '../lib/exercises.js'
import { glyphOf } from '../lib/glyphs.js'
import { athleteStats, isCoach, toggleDay } from '../lib/team.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Segmented } from '../components/ui.jsx'

// The coach's screen (api/team.js): every athlete, their plan and their training. The coach's own
// routines (Plan) are the library: "Assign" puts copies of them into the plans of the athletes
// picked, on the weekdays picked, and assigning one again replaces its copy.

// An athlete's own exercise is in their document, not in this device's library.
const nameIn = d => id => d.customEx?.find(x => String(x.id) === String(id))?.name || exerciseNameText(exOr(id))

// What an athlete gets is the link: the sign-in screen offers a new profile only to someone who
// comes with one (lib/invite-link.js). A paired phone's link points at its server.
const linkOf = code => inviteLink(code, { server: remoteAuth()?.base })
const copyLink = code => { navigator.clipboard?.writeText(linkOf(code)).catch(() => {}) }
const shareLink = (code, toast) => {
  if (navigator.share) navigator.share({ url: linkOf(code) }).catch(() => {})
  else { copyLink(code); toast(t('Invite link copied. It works once.')) }
}

// The routines, athletes and weekdays of one assignment. `athletes` preselects (an athlete's page).
function AssignSheet({ athletes, preselect = [], close, done }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const order = weekOrder(weekStartOf(S))
  const [picked, setPicked] = useState({})          // routine id → [days]
  const [who, setWho] = useState(() => new Set(preselect))
  const [busy, setBusy] = useState(false)
  const own = S.routines.filter(r => r.ex?.length)
  const flip = (set, v) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }
  const toggleRoutine = id => setPicked(p => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = []; return n })
  const toggleRoutineDay = (id, d) => setPicked(p => ({ ...p, [id]: p[id].includes(String(d)) ? p[id].filter(x => x !== String(d)) : [...p[id], String(d)] }))
  const ids = Object.keys(picked)
  const send = () => {
    setBusy(true)
    api('/api/team/assign', { method: 'POST', body: JSON.stringify({ routines: ids, athletes: [...who], days: picked }) })
      .then(() => { toast(t('Plan sent to {0}.', who.size === 1 ? athletes.find(a => who.has(a.id))?.name : tn2(who.size))); done?.(); close() })
      .catch(e => { setBusy(false); toast(e.message) })
  }
  return <>
    <h3>{t('Assign routines')}</h3>
    <div className="small dim" style={{ marginBottom: 10 }}>{t('Copies of your own routines go into each athlete’s plan. Assigning one again replaces its copy.')}</div>
    <h4 className="sec">{t('Your routines')}</h4>
    {own.length ? <div className="list">{own.map(r => <div key={r.id} className="item" style={{ flexWrap: 'wrap' }}>
      <label className="row grow" style={{ gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!picked[r.id]} onChange={() => toggleRoutine(r.id)} />
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <span className="grow"><span className="tt">{r.name}</span><span className="ss" style={{ display: 'block' }}>{exCount(r.ex.length)}</span></span>
      </label>
      {picked[r.id] && <div className="chips" style={{ width: '100%', marginTop: 8 }} aria-label={t('Days for {0}', r.name)}>
        {order.map(d => <button key={d} type="button" className={'chip' + (picked[r.id].includes(String(d)) ? ' on' : '')}
          aria-pressed={picked[r.id].includes(String(d))} aria-label={t(DAYN[d])} onClick={() => toggleRoutineDay(r.id, d)}>{t(DAYS[d])}</button>)}
      </div>}
    </div>)}</div> : <div className="empty">{t('Make a routine in Plan first. Your routines are what you assign.')}</div>}
    <h4 className="sec">{t('Athletes')}</h4>
    {athletes.length ? <div className="list">{athletes.map(a => <label key={a.id} className="item" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={who.has(a.id)} onChange={() => setWho(s => flip(s, a.id))} />
      <span className="grow" style={{ marginInlineStart: 10 }}><span className="tt">{a.name}</span></span>
    </label>)}</div> : <div className="empty">{t('No athletes yet.')}</div>}
    <p className="sect-f">{t('No day picked keeps the routine in their plan without a weekday.')}</p>
    <Button variant="primary" disabled={busy || !ids.length || !who.size} onClick={send}>{t('Assign')}</Button>
  </>
}
const tn2 = n => t('{0} athletes', n)

function InvitesCard() {
  const toast = useUI(s => s.toast)
  const [invites, setInvites] = useState(null)
  const load = () => api('/api/team/invites').then(d => setInvites(d.invites || [])).catch(() => setInvites([]))
  useEffect(() => { load() }, [])
  const make = () => api('/api/team/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { copyLink(invite.code); toast(t('Invite link copied. It works once.')); load() })
    .catch(e => toast(e.message))
  const revoke = code => confirmSheet({
    title: t('Revoke code {0}?', code), message: t('Nobody can sign up with it any more.'), confirmText: t('Revoke'), danger: true,
    onConfirm: () => api('/api/team/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) }).then(load).catch(e => toast(e.message)),
  })
  const open = (invites || []).filter(i => !i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite an athlete')}</h2>
      <Button size="sm" variant="primary" icon="plus" onClick={make}>{t('New code')}</Button></div>
    <div className="small dim" style={{ margin: '6px 0 8px' }}>{t('Send the link to your athlete. Opening it is the only way to create a profile here.')}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
      <button className="plan-textbtn" style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', letterSpacing: '.06em' }}
        onClick={() => { copyLink(i.code); toast(t('Invite link copied. It works once.')) }} aria-label={t('Copy {0}', i.code)}>{i.code}</button>
      <div className="row" style={{ gap: 4 }}>
      <button className="iconbtn" onClick={() => shareLink(i.code, toast)} aria-label={t('Share')}><Icon name="share" /></button>
      <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label={t('Revoke')}><Icon name="trash" /></button>
      </div>
    </div>)}
  </div>
}

export default function Team() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const openSheet = useUI(s => s.openSheet)
  const [athletes, setAthletes] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => api('/api/team/athletes').then(d => { setAthletes(d.athletes || []); setErr(null) }).catch(e => setErr(e.message))
  useEffect(() => { if (isCoach(user)) load() }, [])
  if (!isCoach(user)) return null
  const active = (athletes || []).filter(a => !a.disabled)
  const assign = () => openSheet(close => <AssignSheet athletes={active} close={close} done={load} />)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>{t('Athletes')}</h1>
        <div className="sub">{athletes ? t('{0} athletes', active.length) : err || t('Loading…')}</div></div>
      <Button size="sm" variant="tinted" icon="clipboard" disabled={!active.length} onClick={assign}>{t('Assign')}</Button>
    </div>
    {athletes && !active.length && <EmptyState icon="person" title={t('No athletes yet.')} text={t('Invite one below. Once they sign up you can plan their training here.')} />}
    {active.length > 0 && <div className="list">{active.map(a => <div key={a.id} className="item" {...tappable(() => nav('/team/' + a.id))}>
      <span className="lrow-i"><Icon name="person" /></span>
      <div className="grow"><div className="tt">{a.name}</div>
        <div className="ss">{[t('{0} this week', a.thisWeek), a.lastWorkout ? t('last {0}', fmtDate(a.lastWorkout)) : t('No workouts yet'), t('{0} routines', a.routines)].join(' · ')}</div></div>
      <Icon name="chevronRight" className="chev" />
    </div>)}</div>}
    <div style={{ height: 14 }} />
    <InvitesCard />
  </div>
}

/* ============================== one athlete ============================== */

export function TeamAthlete() {
  const nav = useNavigate()
  const { id } = useParams()
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [view, setView] = useState('plan')
  const load = () => api('/api/team/athlete?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { if (isCoach(user)) load() }, [id])
  if (!isCoach(user)) return null
  const back = <button className="iconbtn" data-back="/team" onClick={() => nav('/team')} aria-label={t('Athletes')}><Icon name="chevronLeft" /></button>
  if (!d) return <div className="narrow"><div className="hdr">{back}<div className="sub" style={{ marginInlineStart: 12 }}>{t('Loading…')}</div></div></div>

  const a = d.athlete
  const assign = () => openSheet(close => <AssignSheet athletes={[a]} preselect={[a.id]} close={close} done={load} />)
  return <div className="narrow">
    <div className="hdr">{back}
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>{a.name}</h1>
        <div className="sub">{a.lastWorkout ? t('Last workout {0}', fmtDate(a.lastWorkout)) : t('No workouts yet')}</div></div>
      <Button size="sm" variant="tinted" icon="plus" onClick={assign}>{t('Assign')}</Button>
    </div>
    <Segmented className="plan-views" value={view} onChange={setView}
      options={[{ value: 'plan', label: t('Plan') }, { value: 'stats', label: t('Stats') }, { value: 'history', label: t('History') }]} />
    {view === 'plan' ? <AthletePlan d={d} S={S} reload={load} />
      : view === 'stats' ? <AthleteStats d={d} />
        : <AthleteHistory d={d} />}
  </div>
}

function AthletePlan({ d, S, reload }) {
  const toast = useUI(s => s.toast)
  const { routines, week } = d.plan
  const order = weekOrder(weekStartOf(S))
  const todayDow = new Date().getDay()
  const byId = id => routines.find(r => String(r.id) === String(id))
  const saveWeek = next => api('/api/team/week', { method: 'PUT', body: JSON.stringify({ athlete: d.athlete.id, week: next }) })
    .then(reload).catch(e => toast(e.message))
  const editDay = day => menuSheet({
    title: t(DAYN[day]),
    subtitle: t('Tap a routine to put it on this day or take it off.'),
    items: routines.map(r => ({
      icon: [].concat(week[day] || []).includes(String(r.id)) ? 'checkCircle' : glyphOf(r.emoji),
      label: r.name, sub: exCount((r.ex || []).length),
      onClick: () => saveWeek(toggleDay(week, day, r.id)),
    })),
  })
  const remove = r => confirmSheet({
    title: t('Take “{0}” out of their plan?', r.name),
    message: t('It comes off every day of their week. Their workouts stay.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => api('/api/team/unassign', { method: 'POST', body: JSON.stringify({ athlete: d.athlete.id, routine: r.id }) })
      .then(reload).catch(e => toast(e.message)),
  })
  if (!routines.length) return <EmptyState icon="clipboard" title={t('No plan yet.')} text={t('“Assign” puts copies of your routines into their plan.')} />
  return <>
    <h4 className="sec">{t('Their week')}</h4>
    <div className="list plan-week">{order.map(day => {
      const rs = [].concat(week[day] || []).map(byId).filter(Boolean)
      return <div key={day} className="item plan-day" aria-label={t(DAYN[day])} {...tappable(() => editDay(day))}>
        <span className={'plan-day-n' + (day === todayDow ? ' today' : '')} aria-hidden="true">{t(DAYS[day])}</span>
        <span className={'lrow-i' + (rs.length ? '' : ' rest')}><Icon name={rs.length ? glyphOf(rs[0].emoji) : 'moon'} /></span>
        <div className="grow"><div className="tt">{rs.length ? rs.map(r => r.name).join(' + ') : t('Rest day')}</div>
          <div className="ss">{rs.length ? exCount(rs.reduce((n, r) => n + (r.ex || []).length, 0)) : t('Tap to plan something')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    })}</div>
    <h4 className="sec">{t('Their routines')}</h4>
    <div className="list">{routines.map(r => <div key={r.id} className="item">
      <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
      <div className="grow"><div className="tt">{r.name}</div>
        <div className="ss">{(r.ex || []).map(e => nameIn(d)(e.id)).join(', ') || exCount(0)}</div></div>
      <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => remove(r)} aria-label={t('Remove {0}', r.name)}><Icon name="minus" /></button>
    </div>)}</div>
    <p className="sect-f">{t('To change a routine, edit yours in Plan and assign it again.')}</p>
  </>
}

function AthleteStats({ d }) {
  const s = useMemo(() => athleteStats(d.workouts, { today: todayISO(), volumeOf: workoutVolume, bestOf: e => bestSetOf(e) }), [d])
  const bw = (d.bodyweight || []).filter(b => b && b.d && Number(b.w) > 0).slice(-60)
  const points = bw.map(b => ({ t: Date.parse(b.d + 'T12:00:00'), y: Number(b.w), d: b.d }))
  const maxWeek = Math.max(1, ...s.perWeek.map(w => w.n))
  return <>
    <div className="tiles" style={{ textAlign: 'start', marginTop: 12 }}>
      <div className="tile"><div className="l">{t('This week')}</div><div className="v">{s.last7}</div></div>
      <div className="tile"><div className="l">{t('Last 30 days')}</div><div className="v">{s.last30}</div></div>
      <div className="tile"><div className="l">{t('Volume, 30 days')}</div><div className="v v-sm">{fmtVol(Math.round(s.volume30), d.unit)}</div></div>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v">{s.total}</div></div>
    </div>
    <h4 className="sec">{t('Workouts per week')}</h4>
    <div className="card" role="img" aria-label={s.perWeek.map(w => fmtDate(w.from) + ': ' + w.n).join(', ')}>
      <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 90 }}>
        {s.perWeek.map(w => <div key={w.from} className="grow" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span className="small dim">{w.n || ''}</span>
          <div style={{ width: '100%', height: Math.max(3, (w.n / maxWeek) * 60), borderRadius: 4, background: w.n ? 'var(--acc)' : 'var(--fill-3)' }} />
        </div>)}
      </div>
    </div>
    {s.bestLifts.length > 0 && <>
      <h4 className="sec">{t('Best estimated 1RM')}</h4>
      <div className="list">{s.bestLifts.map(b => <div key={b.id} className="item">
        <div className="grow"><div className="tt">{nameIn(d)(b.id)}</div>
          <div className="ss">{fmtNum(b.w)} {d.unit} × {b.r} · {fmtDate(b.d)}</div></div>
        <span className="small" style={{ fontWeight: 600 }}>{fmtNum(Math.round(b.est))} {d.unit}</span>
      </div>)}</div>
    </>}
    {points.length > 1 && <>
      <h4 className="sec">{t('Body weight')}</h4>
      <div className="card"><div className="chart"><LineChart points={points} h={140} unit={d.unit} /></div></div>
    </>}
  </>
}

function AthleteHistory({ d }) {
  const ws = (d.workouts || []).filter(w => w && Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets))).slice().reverse()
  const [open, setOpen] = useState(null)
  if (!ws.length) return <EmptyState icon="history" title={t('No workouts yet')} text={t('Their workouts show up here once they train.')} />
  return <div className="list" style={{ marginTop: 12 }}>{ws.slice(0, 100).map((w, i) => {
    const key = w.id ?? i
    return <div key={key} className="item" style={{ display: 'block' }} {...tappable(() => setOpen(o => (o === key ? null : key)))}>
      <div className="row between">
        <div><div className="tt">{w.name || t('Workout')}</div>
          <div className="ss">{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {t('{0} sets', setsDone(w))}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(Math.round(w.vol ?? workoutVolume(w)), d.unit)}</span>
      </div>
      {open === key && <div style={{ marginTop: 8 }}>{w.entries.map((e, j) => <div key={j} className="small" style={{ padding: '3px 0' }}>
        <b>{nameIn(d)(e.id)}</b>
        <span className="dim"> · {e.sets.filter(x => x.done).map(x => (x.w ? fmtNum(x.w) + '×' : '') + (x.r ?? (x.sec ? x.sec + 's' : ''))).join(', ')}</span>
      </div>)}</div>}
    </div>
  })}</div>
}
