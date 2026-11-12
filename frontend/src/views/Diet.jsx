// The athlete's recommended diet (coach-owned HTML in S.diet). Read-only here; the coach
// edits it from Plan → Diet or Team → athlete → Plan.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { isAthlete } from '../lib/team.js'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DietView from '../components/DietView.jsx'

export default function Diet() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const diet = typeof S.diet === 'string' ? S.diet.trim() : ''
  const back = isAthlete(user) ? '/plan' : '/home'
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>{t('Diet')}</h1>
        <div className="sub">{isAthlete(user) ? t('Set by your coach') : t('Recommended diet')}</div></div>
    </div>
    {!diet
      ? <EmptyState icon="note" title={t('No diet yet')} text={isAthlete(user)
        ? t('Your coach has not set a diet yet.')
        : t('Your coach can set a recommended diet for you.')} />
      : <div className="card" style={{ marginTop: 8 }}><DietView source={diet} /></div>}
  </div>
}
