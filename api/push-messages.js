import { NUDGE_COPY } from './nudge-copy.js';
import { lineIndex } from './nudge.js';

const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ This is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan. Let's go 💪",
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ É assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano. Bora treinar 💪',
  },
};

const copyFor = lang => COPY[lang] || COPY.en;

// A routine's `emoji` field held a literal emoji until the glyph redesign; since then it holds
// an icon key ('dumbbell', 'figureRun') that the app renders as an SVG. A push notification has
// no SVG to render, so an unmapped key reaches the phone as its own name — "dumbbell Push
// today". Keys are ASCII and emoji are not, so anything ASCII is looked up here (falling back
// rather than printing a word), and anything else is already an emoji and passes through.
// Mirrors frontend/src/lib/glyphs.js: GLYPHS is the full set the picker offers.
const DEFAULT_EMOJI = '🏋️';
const GLYPH_EMOJI = {
  figureStrength: '🏋️', arm: '💪', abs: '💥', legs: '🦵', pullup: '🧗',
  dumbbell: '🏋️', barbell: '🏋️', kettlebell: '🏋️', plate: '🏋️', machine: '🏋️',
  figureRun: '🏃', bike: '🚴', swim: '🏊', boxing: '🥊', timer: '⏱️',
  stretch: '🤸', moon: '🌙', heart: '❤️', flame: '🔥', bolt: '⚡',
};

export function routineEmoji(value) {
  if (!value) return DEFAULT_EMOJI;
  if (!/^[A-Za-z]+$/.test(value)) return value;
  return GLYPH_EMOJI[value] || DEFAULT_EMOJI;
}

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

export function testPush(lang) {
  return { title: 'openGym', body: copyFor(lang).testBody, tag: 'test' };
}

export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine
      ? `${routineEmoji(routine.emoji)} ${routine.name} ${copy.dayRoutineSuffix}`
      : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
  };
}

// The missed-workout nudge (nudge.js). Its copy is translated in the frontend packs and generated
// into nudge-copy.js, so every language the app speaks has it — unlike the strings above, which
// predate that and fall back to English. de-CH is de with ß written ss, as in the frontend
// (lib/i18n-core.js DERIVED_LOCALES).
const nudgeCopyFor = lang => {
  if (lang === 'de-CH') {
    const ch = s => s.replace(/ß/g, 'ss');
    return Object.fromEntries(Object.entries(NUDGE_COPY.de).map(([k, c]) => [k, { title: ch(c.title), lines: c.lines.map(ch) }]));
  }
  return NUDGE_COPY[lang] || NUDGE_COPY.en;
};
export function nudgePush(lang, tone, routine, iso) {
  const copy = nudgeCopyFor(lang)[NUDGE_COPY.en[tone] ? tone : 'friendly'];
  const line = copy.lines[lineIndex(iso, copy.lines.length)];
  const name = routine?.name || 'openGym';
  return { title: copy.title, body: line.replace('{0}', () => name), tag: 'nudge' };
}

const WORKOUT_COPY = {
  en: {
    finishedTitle: '{0} finished {1}',
    sessionFallback: 'a workout',
    min: '{0} min',
    sets: '{0} sets',
  },
  es: {
    finishedTitle: '{0} ha terminado {1}',
    sessionFallback: 'un entrenamiento',
    min: '{0} min',
    sets: '{0} series',
  },
  'pt-BR': {
    finishedTitle: '{0} terminou {1}',
    sessionFallback: 'um treino',
    min: '{0} min',
    sets: '{0} séries',
  },
};

const workoutCopyFor = lang => {
  if (WORKOUT_COPY[lang]) return WORKOUT_COPY[lang];
  const base = typeof lang === 'string' ? lang.split('-')[0] : '';
  if (base === 'pt') return WORKOUT_COPY['pt-BR'];
  return WORKOUT_COPY[base] || WORKOUT_COPY.en;
};

const fmtVol = (volume, unit) => {
  const n = typeof volume === 'number' && Number.isFinite(volume) ? Math.round(volume * 10) / 10 : null;
  if (n == null) return null;
  return `${n} ${unit === 'lb' ? 'lb' : 'kg'}`;
};

/** Push when an athlete finishes a session. `tag` and `url` are filled in by the caller. */
export function workoutFinishedPush(lang, { athlete, routine, durationMin, sets, volume, unit } = {}, { tag, url } = {}) {
  const copy = workoutCopyFor(lang);
  const who = (typeof athlete === 'string' && athlete.trim()) ? athlete.trim().slice(0, 80) : 'openGym';
  const what = (typeof routine === 'string' && routine.trim()) ? routine.trim().slice(0, 80) : copy.sessionFallback;
  const parts = [];
  if (typeof durationMin === 'number' && Number.isFinite(durationMin) && durationMin >= 0) {
    parts.push(copy.min.replace('{0}', String(Math.round(durationMin))));
  }
  if (typeof sets === 'number' && Number.isFinite(sets)) {
    parts.push(copy.sets.replace('{0}', String(Math.round(sets))));
  }
  const vol = fmtVol(volume, unit);
  if (vol) parts.push(vol);
  const out = {
    title: copy.finishedTitle.replace('{0}', () => who).replace('{1}', () => what),
    body: parts.join(' · '),
    tag: tag || 'workout-finished',
  };
  if (typeof url === 'string' && url) out.url = url;
  return out;
}

const PHOTO_COPY = {
  en: {
    oneTitle: '{0} uploaded a progress photo',
    manyTitle: '{0} uploaded {1} progress photos',
  },
  es: {
    oneTitle: '{0} ha subido una foto de progreso',
    manyTitle: '{0} ha subido {1} fotos de progreso',
  },
  'pt-BR': {
    oneTitle: '{0} enviou uma foto de progresso',
    manyTitle: '{0} enviou {1} fotos de progresso',
  },
};

const photoCopyFor = lang => {
  if (PHOTO_COPY[lang]) return PHOTO_COPY[lang];
  const base = typeof lang === 'string' ? lang.split('-')[0] : '';
  if (base === 'pt') return PHOTO_COPY['pt-BR'];
  return PHOTO_COPY[base] || PHOTO_COPY.en;
};

/** Push when an athlete uploads one or more progress photos. `tag` and `url` come from the caller. */
export function bodyPhotoPush(lang, { athlete, count = 1, date } = {}, { tag, url } = {}) {
  const copy = photoCopyFor(lang);
  const who = (typeof athlete === 'string' && athlete.trim()) ? athlete.trim().slice(0, 80) : 'openGym';
  const n = (typeof count === 'number' && Number.isFinite(count) && count > 0) ? Math.round(count) : 1;
  const title = (n === 1 ? copy.oneTitle : copy.manyTitle).replace('{0}', () => who).replace('{1}', () => String(n));
  const body = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) ? date.slice(0, 10) : '';
  const out = { title, body, tag: tag || 'body-photo' };
  if (typeof url === 'string' && url) out.url = url;
  return out;
}
