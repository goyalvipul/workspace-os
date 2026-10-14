import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, localDateOf, localTimeOf, todayLocal, formatTime, type CalendarEventDTO, type ExternalCalendarDTO } from '@wos/shared';
import { api, NetworkError } from './api';
import { kvGet, kvSet } from './db';
import { useStore } from './store';

export const useTz = () => useStore((s) => s.user?.timezone ?? 'America/Vancouver');
export const useHour12 = () => useStore((s) => (s.user?.timeFormat ?? '12h') === '12h');
export const useWeekStart = () => useStore((s) => (s.user?.weekStartsOn ?? 1) as 0 | 1);

/** Today's date in the owner's timezone; re-evaluates every 30 s so views roll over at midnight. */
export function useToday(): string {
  const tz = useTz();
  const [today, setToday] = useState(() => todayLocal(tz));
  useEffect(() => {
    setToday(todayLocal(tz));
    const t = setInterval(() => setToday(todayLocal(tz)), 30_000);
    return () => clearInterval(t);
  }, [tz]);
  return today;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');

/**
 * On-screen keyboard tracking. iOS (Safari and installed PWAs) does not resize the layout viewport when the keyboard opens, so a
 * `fixed bottom-0` sheet ends up hidden behind it. The visual viewport does shrink, so we measure how much of the layout viewport
 * is covered at the bottom (`bottom`) and how tall the visible area is (`height`). Both update as the keyboard opens and closes.
 */
export function useKeyboardInset(active: boolean): { bottom: number; height: number | null } {
  const [state, setState] = useState<{ bottom: number; height: number | null }>({ bottom: 0, height: null });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) {
      setState({ bottom: 0, height: null });
      return;
    }
    const update = () => {
      const bottom = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      // Ignore small differences (browser toolbars); a keyboard is well over 100 px.
      setState((prev) => {
        const next = { bottom: bottom > 100 ? bottom : 0, height: bottom > 100 ? Math.round(vv.height) : null };
        return prev.bottom === next.bottom && prev.height === next.height ? prev : next;
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return state;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface EventsResult {
  items: CalendarEventDTO[];
  offlineCache?: boolean;
}

/** Read-only calendar events for [start,end]; falls back to the last cached response when offline. */
export function useCalendarEvents(start: string, end: string, enabled = true) {
  const q = useQuery<EventsResult>({
    queryKey: ['calendar', 'events', start, end],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const key = `events:${start}:${end}`;
      try {
        const r = await api<{ items: CalendarEventDTO[] }>('GET', `/calendar/events?start=${start}&end=${end}`);
        void kvSet(key, r.items);
        return { items: r.items };
      } catch (e) {
        if (e instanceof NetworkError) {
          const cached = await kvGet<CalendarEventDTO[]>(key);
          return { items: cached ?? [], offlineCache: true };
        }
        throw e;
      }
    },
  });
  const hidden = useStore((s) => s.prefs['calendar.hiddenSources'] as string[]);
  const events = useMemo(() => (q.data?.items ?? []).filter((e) => !hidden.includes(e.calendarId) && !e.isCancelled), [q.data, hidden]);
  return { ...q, events, offlineCache: q.data?.offlineCache ?? false, anyStale: events.some((e) => e.isStale) };
}

export function useExternalCalendars() {
  return useQuery<{ items: ExternalCalendarDTO[] }>({
    queryKey: ['calendar', 'calendars'],
    queryFn: () => api('GET', '/calendar/calendars'),
    staleTime: 20_000,
  });
}

/** Local dates an event covers, clipped to [start,end]. */
export function eventDays(e: CalendarEventDTO, tz: string, start: string, end: string): string[] {
  let first: string;
  let last: string;
  if (e.isAllDay) {
    first = e.startDate ?? start;
    last = e.endDateExclusive ? addDays(e.endDateExclusive, -1) : first;
  } else {
    first = e.startUtc ? localDateOf(e.startUtc, tz) : start;
    const endLocal = e.endUtc ? localDateOf(new Date(Date.parse(e.endUtc) - 1000), tz) : first;
    last = endLocal < first ? first : endLocal;
  }
  const days: string[] = [];
  for (let d = first < start ? start : first; d <= (last > end ? end : last) && days.length < 62; d = addDays(d, 1)) days.push(d);
  return days;
}

export function eventTimeLabel(e: CalendarEventDTO, tz: string, hour12: boolean): string {
  if (e.isAllDay || !e.startUtc) return 'All day';
  const s = formatTime(localTimeOf(e.startUtc, tz), hour12);
  const en = e.endUtc ? formatTime(localTimeOf(e.endUtc, tz), hour12) : '';
  return en ? `${s}-${en}` : s;
}
