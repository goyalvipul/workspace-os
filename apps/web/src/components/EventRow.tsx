import { ExternalLink, Lock, MapPin, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { formatLongDate, localDateOf, type CalendarEventDTO } from '@wos/shared';
import { eventTimeLabel, useHour12, useTz } from '../lib/hooks';
import { Sheet, SheetHeader } from './ui';

export function EventRow({ event }: { event: CalendarEventDTO }) {
  const tz = useTz();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-surface2" aria-label={`Calendar event: ${event.subject}, ${eventTimeLabel(event, tz, hour12)}`}>
        <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: event.color }} aria-hidden />
        <span className="shrink-0 text-muted tabular-nums">{eventTimeLabel(event, tz, hour12)}</span>
        <span className="min-w-0 flex-1 truncate">{event.subject}</span>
        {event.isStale && <RefreshCw size={12} className="shrink-0 text-warn" aria-label="Might be out of date" />}
        {event.isPrivate && <Lock size={12} className="shrink-0 text-muted" aria-label="Private" />}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={event.subject}>
        <SheetHeader title="Calendar event" onClose={() => setOpen(false)} />
        <div className="space-y-3 overflow-auto p-5">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: event.color }} aria-hidden />
            <div>
              <h3 className="text-lg font-semibold">{event.subject}</h3>
              <p className="text-sm text-muted">
                {event.isAllDay ? `${event.startDate ? formatLongDate(event.startDate) : ''} \u00b7 All day` : `${event.startUtc ? formatLongDate(localDateOf(event.startUtc, tz)) : ''} \u00b7 ${eventTimeLabel(event, tz, hour12)}`}
              </p>
            </div>
          </div>
          {event.location && (
            <p className="flex items-center gap-2 text-sm">
              <MapPin size={16} className="text-muted" aria-hidden /> {event.location}
            </p>
          )}
          {event.description && <p className="whitespace-pre-wrap break-words rounded-lg bg-surface p-3 text-sm">{event.description}</p>}
          <p className="text-xs text-muted">
            {event.calendarName} &middot; {event.accountLabel} &middot; {event.provider === 'google' ? 'Google Calendar' : 'Microsoft Outlook'}
          </p>
          {event.isStale && <p className="rounded-lg bg-surface p-3 text-xs text-warn">This calendar has not synced recently, so the event might be out of date.</p>}
          <p className="rounded-lg bg-surface p-3 text-xs text-muted">Read-only. Workspace OS never changes your external calendars - edit this event in {event.provider === 'google' ? 'Google Calendar' : 'Outlook'}.</p>
          {event.url && (
            <a href={event.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-accent-text underline">
              Open in {event.provider === 'google' ? 'Google Calendar' : 'Outlook'} <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      </Sheet>
    </>
  );
}

export function EventBlock({ events }: { events: CalendarEventDTO[] }) {
  if (!events.length) return null;
  const sorted = [...events].sort((a, b) => Number(b.isAllDay) - Number(a.isAllDay) || (a.startUtc ?? '').localeCompare(b.startUtc ?? ''));
  return (
    <div className="rounded-lg bg-surface px-2 py-1.5" aria-label="Calendar events">
      {sorted.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </div>
  );
}
