// Что и кому отправить ботом. Чистая функция: на вход данные, на выход список сообщений. Отправка отдельно.
// Напоминания только о сроке замера и датах созвонов, плюс приветствие при первом входе. Больше ничего

export type Prof = { id: string; telegram_id: number | null; display_name: string; status: string; prefs: Record<string, unknown> | null };
export type Cp = { id: string; user_id: string; idx: number; due_date: string; submitted_at: string | null };
export type Call = { id: string; user_id: string; kind: string; scheduled_at: string | null };
export type Msg = { user_id: string; chat_id: number; kind: string; ref_id: string | null; text: string };

const CALL_KIND: Record<string, string> = { call: 'Созвон', strategy: 'Стратегическая сессия', city_strategy: 'Стратегия под город', bonus: 'Дополнительный созвон' };

export function localDay(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); // YYYY-MM-DD
}
const dayNum = (s: string) => Math.round(Date.parse(s + 'T00:00:00Z') / 86400000);
const fmtDay = (iso: string, tz: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' }).format(new Date(iso));
const fmtDate = (ymd: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(ymd + 'T00:00:00Z'));
const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export function canMessage(p: Prof): boolean {
  if (!p.telegram_id || p.status !== 'active') return false;
  const prefs = p.prefs || {};
  return prefs.notifications !== false && prefs.admin_mute !== true;
}

export function plan(opts: {
  mode: 'daily' | 'calls' | 'all'; now: Date; tz: string; profiles: Prof[]; checkpoints: Cp[]; calls: Call[]; sent: Set<string>;
  daysBefore?: number; retryAfterDays?: number;
}): Msg[] {
  const { mode, now, tz, profiles, checkpoints, calls, sent } = opts;
  const before = opts.daysBefore ?? 2, retry = opts.retryAfterDays ?? 2;
  const today = dayNum(localDay(now, tz));
  const out: Msg[] = [];
  const seen = new Set<string>();
  const add = (p: Prof, kind: string, ref: string | null, text: string) => {
    const key = `${p.id}|${kind}|${ref ?? ''}`;
    if (sent.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ user_id: p.id, chat_id: p.telegram_id as number, kind, ref_id: ref, text });
  };

  for (const p of profiles.filter(canMessage)) {
    add(p, 'welcome', null, `Привет, ${p.display_name}! Трекер Barbermaxxing готов. Отмечай уроки и видео, а раз в 2 недели вноси цифры`);
  }
  if (mode === 'daily' || mode === 'all') {
    for (const c of checkpoints.filter((x) => !x.submitted_at && x.idx > 0)) {
      const p = profiles.find((x) => x.id === c.user_id); if (!p || !canMessage(p)) continue;
      const left = dayNum(c.due_date) - today;
      if (left === before) add(p, 'checkpoint_2d', c.id, `Замер через ${before} дня, до ${fmtDate(c.due_date)}. Цифры и скриншоты, минут на 10`);
      else if (left === 0) add(p, 'checkpoint_due', c.id, 'Сегодня срок замера. Цифры и скриншоты, минут на 10');
      else if (left === -retry) add(p, 'checkpoint_retry', c.id, 'Замер ждёт тебя. Заполни, когда будет время, штрафов нет');
    }
  }
  if (mode === 'calls' || mode === 'all') {
    for (const c of calls.filter((x) => x.scheduled_at)) {
      const p = profiles.find((x) => x.id === c.user_id); if (!p || !canMessage(p)) continue;
      const mins = (Date.parse(c.scheduled_at as string) - now.getTime()) / 60000;
      const label = CALL_KIND[c.kind] || 'Созвон';
      if (mins > 0 && mins <= 60) add(p, 'call_1h', c.id, `${label} через час, в ${fmtTime(c.scheduled_at as string, tz)}`);
      else if (mins > 60 && mins <= 24 * 60) add(p, 'call_1d', c.id, `${label} завтра: ${fmtDay(c.scheduled_at as string, tz)}, ${fmtTime(c.scheduled_at as string, tz)}`);
    }
  }
  return out;
}
