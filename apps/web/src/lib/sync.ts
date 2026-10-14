import type { QueryClient } from '@tanstack/react-query';
import { actions, flush, refresh, useStore } from './store';

let es: EventSource | null = null;
let started = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

/** Starts live updates: SSE stream, online/offline tracking, periodic safety refresh. */
export function startSync(qc: QueryClient): () => void {
  if (started) return () => undefined;
  started = true;

  const scheduleRefresh = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void refresh(), 250);
  };

  const connect = () => {
    if (es || useStore.getState().status !== 'authed') return;
    actions.setStream('connecting');
    es = new EventSource(`/api/v1/stream/events?after=${useStore.getState().lastEventSeq}`);
    es.addEventListener('ready', () => actions.setStream('live'));
    es.addEventListener('server.resync_required', () => void refresh(true));
    es.onerror = () => {
      actions.setStream(navigator.onLine ? 'connecting' : 'offline');
      // EventSource reconnects by itself using Last-Event-ID; if the server said no, rebuild it
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        setTimeout(connect, 3000);
      }
    };
    const generic = (e: MessageEvent) => {
      const type = (e as MessageEvent & { type: string }).type;
      if (type.startsWith('calendar.')) void qc.invalidateQueries({ queryKey: ['calendar'] });
      else scheduleRefresh();
    };
    for (const t of ['task.changed', 'project.changed', 'section.changed', 'label.changed', 'filter.changed', 'template.changed', 'preferences.changed', 'calendar.changed', 'calendar.synced', 'notification.created']) {
      es.addEventListener(t, generic);
    }
    es.addEventListener('notification.created', () => void qc.invalidateQueries({ queryKey: ['notifications'] }));
  };

  const onOnline = () => {
    actions.setOnline(true);
    es?.close();
    es = null;
    connect();
    void qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const onOffline = () => {
    actions.setOnline(false);
    actions.setStream('offline');
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && useStore.getState().status === 'authed') {
      void refresh().then(() => flush());
      void qc.invalidateQueries({ queryKey: ['calendar'] });
      if (!es) connect();
    }
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);

  const unsub = useStore.subscribe((s, prev) => {
    if (s.status === 'authed' && prev.status !== 'authed') connect();
    if (s.status !== 'authed' && es) {
      es.close();
      es = null;
    }
  });
  connect();
  const timer = setInterval(() => {
    if (useStore.getState().status === 'authed' && navigator.onLine) void refresh().then(() => flush());
  }, 5 * 60_000);

  return () => {
    started = false;
    es?.close();
    es = null;
    unsub();
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
