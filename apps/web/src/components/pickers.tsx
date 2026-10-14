import { ChevronLeft, ChevronRight, Flag, Hash, Inbox, Plus, Repeat, Sun, Sunrise, CalendarDays, Ban, Tag, Check, Bell, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  addDays,
  describeRule,
  endOfMonth,
  formatDateLabel,
  formatTime,
  monthName,
  parseDate,
  RULE_PRESETS,
  startOfMonth,
  startOfWeek,
  validateRule,
  weekdayOf,
  weeklyRule,
  addMonthsClamped,
  rangeDays,
  type ReminderInput,
} from '@wos/shared';
import { actions, useStore } from '../lib/store';
import { useHour12, useToday, useWeekStart } from '../lib/hooks';
import { Button, Chip, Input, PopoverClose, PopoverContent, PopoverRoot, PopoverTrigger, Select, Switch, clsx } from './ui';
import { PRIORITY_COLOR } from './TaskRow';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function MiniCalendar({ value, onSelect, marks, today, weekStart }: { value: string | null; onSelect: (d: string) => void; marks?: Set<string>; today: string; weekStart: 0 | 1 }) {
  const [cursor, setCursor] = useState(() => startOfMonth(value ?? today));
  const { y, m } = parseDate(cursor);
  const days = useMemo(() => {
    const first = startOfWeek(cursor, weekStart);
    const last = addDays(startOfWeek(endOfMonth(cursor), weekStart), 6);
    return rangeDays(first, last);
  }, [cursor, weekStart]);
  const heads = weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="w-[280px] select-none">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-semibold">
          {monthName(m)} {y}
        </span>
        <span className="flex">
          <button type="button" aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface2" onClick={() => setCursor(addMonthsClamped(cursor, -1))}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface2" onClick={() => setCursor(addMonthsClamped(cursor, 1))}>
            <ChevronRight size={18} />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-muted">
        {heads.map((d) => (
          <span key={d} className="py-1">
            {WD[d]}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === cursor.slice(0, 7);
          const sel = d === value;
          return (
            <button
              key={d}
              type="button"
              aria-label={d}
              aria-pressed={sel}
              onClick={() => onSelect(d)}
              className={clsx('relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm', !inMonth && 'text-muted/60', sel ? 'bg-accent text-accent-fg' : d === today ? 'font-bold text-accent-text hover:bg-surface2' : 'hover:bg-surface2')}
            >
              {parseDate(d).d}
              {marks?.has(d) && !sel && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-muted" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface DateValue {
  date: string | null;
  time: string | null;
}

export function DatePicker({ value, onChange, label = 'Date', allowTime = true, trigger }: { value: DateValue; onChange: (v: DateValue) => void; label?: string; allowTime?: boolean; trigger?: ReactNode }) {
  const today = useToday();
  const weekStart = useWeekStart();
  const hour12 = useHour12();
  const [open, setOpen] = useState(false);
  const set = (v: DateValue) => {
    onChange(v);
  };
  const nextMonday = addDays(today, ((8 - weekdayOf(today)) % 7) || 7);
  const weekend = addDays(today, (6 - weekdayOf(today) + 7) % 7 || 7);
  const quick: { label: string; date: string; icon: ReactNode }[] = [
    { label: 'Today', date: today, icon: <CalendarDays size={16} className="text-ok" /> },
    { label: 'Tomorrow', date: addDays(today, 1), icon: <Sun size={16} className="text-warn" /> },
    { label: 'This weekend', date: weekend, icon: <Sunrise size={16} className="text-accent-text" /> },
    { label: 'Next week', date: nextMonday, icon: <Repeat size={16} className="text-muted" /> },
  ];
  const text = value.date ? `${formatDateLabel(value.date, today)}${value.time ? ` ${formatTime(value.time, hour12)}` : ''}` : label;
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Chip active={!!value.date}>
            <CalendarDays size={14} aria-hidden />
            {text}
          </Chip>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[300px]">
        <div className="space-y-0.5 pb-2">
          {quick.map((q) => (
            <button key={q.label} type="button" className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface2" onClick={() => set({ ...value, date: q.date })}>
              {q.icon}
              <span className="flex-1 text-left">{q.label}</span>
              <span className="text-xs text-muted">{formatDateLabel(q.date, today)}</span>
            </button>
          ))}
          <button type="button" className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface2" onClick={() => set({ date: null, time: null })}>
            <Ban size={16} className="text-muted" />
            No date
          </button>
        </div>
        <div className="border-t border-line pt-2">
          <MiniCalendar value={value.date} onSelect={(d) => set({ ...value, date: d })} today={today} weekStart={weekStart} />
        </div>
        {allowTime && (
          <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
            <label htmlFor="due-time" className="text-sm">
              Time
            </label>
            <Input id="due-time" type="time" value={value.time ?? ''} disabled={!value.date} onChange={(e) => set({ date: value.date, time: e.target.value || null })} className="max-w-[140px]" />
            {value.time && (
              <Button size="sm" variant="ghost" onClick={() => set({ ...value, time: null })}>
                Clear
              </Button>
            )}
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <PopoverClose asChild>
            <Button size="sm" variant="primary">
              Done
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

export function PriorityPicker({ value, onChange, compact }: { value: number; onChange: (p: number) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip active={value < 4}>
          <Flag size={14} style={{ color: PRIORITY_COLOR[value] }} aria-hidden />
          {compact ? `P${value}` : value < 4 ? `Priority ${value}` : 'Priority'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[200px]">
        {[1, 2, 3, 4].map((p) => (
          <button
            key={p}
            type="button"
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface2"
            onClick={() => {
              onChange(p);
              setOpen(false);
            }}
          >
            <Flag size={16} style={{ color: PRIORITY_COLOR[p] }} fill={p < 4 ? PRIORITY_COLOR[p] : 'none'} aria-hidden />
            <span className="flex-1 text-left">Priority {p}</span>
            {value === p && <Check size={16} />}
          </button>
        ))}
      </PopoverContent>
    </PopoverRoot>
  );
}

export function ProjectPicker({ projectId, sectionId, onChange, withSections = true }: { projectId: string | null; sectionId: string | null; onChange: (p: string | null, s: string | null) => void; withSections?: boolean }) {
  const projects = useStore((s) => s.projects);
  const sections = useStore((s) => s.sections);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = Object.values(projects)
    .filter((p) => !p.archivedAt && p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const cur = projectId ? projects[projectId] : null;
  const sec = sectionId ? sections[sectionId] : null;
  const pick = (p: string | null, s: string | null) => {
    onChange(p, s);
    setOpen(false);
    setQ('');
  };
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip active={!!cur} aria-label={`Project: ${cur ? cur.name : 'Inbox'}${sec ? ` / ${sec.name}` : ''}. Change project`}>
          {cur ? <Hash size={14} style={{ color: cur.color }} aria-hidden /> : <Inbox size={14} aria-hidden />}
          {cur ? cur.name : 'Inbox'}
          {sec ? ` / ${sec.name}` : ''}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[260px]">
        <Input placeholder="Search projects" aria-label="Search projects" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
        <button type="button" className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface2" onClick={() => pick(null, null)}>
          <Inbox size={16} /> Inbox {!projectId && <Check size={16} className="ml-auto" />}
        </button>
        {list.map((p) => (
          <div key={p.id}>
            <button type="button" className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface2" onClick={() => pick(p.id, null)}>
              <Hash size={16} style={{ color: p.color }} /> <span className="truncate">{p.name}</span> {projectId === p.id && !sectionId && <Check size={16} className="ml-auto" />}
            </button>
            {withSections &&
              Object.values(sections)
                .filter((s) => s.projectId === p.id && !s.archivedAt)
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((s) => (
                  <button key={s.id} type="button" className="flex min-h-9 w-full items-center gap-3 rounded-lg pl-9 pr-2 text-sm text-muted hover:bg-surface2" onClick={() => pick(p.id, s.id)}>
                    <span className="truncate">{s.name}</span>
                    {sectionId === s.id && <Check size={16} className="ml-auto" />}
                  </button>
                ))}
          </div>
        ))}
      </PopoverContent>
    </PopoverRoot>
  );
}

export function LabelPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const labels = useStore((s) => s.labels);
  const [q, setQ] = useState('');
  const list = Object.values(labels).filter((l) => l.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const canCreate = q.trim() && !Object.values(labels).some((l) => l.name.toLowerCase() === q.trim().toLowerCase()) && /^[^\s@#]+(?: [^\s@#]+)*$/.test(q.trim());
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Chip active={value.length > 0}>
          <Tag size={14} aria-hidden />
          {value.length ? value.map((id) => labels[id]?.name).filter(Boolean).join(', ') : 'Labels'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[240px]">
        <Input placeholder="Search or create label" aria-label="Search or create label" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
        {list.map((l) => (
          <button key={l.id} type="button" role="checkbox" aria-checked={value.includes(l.id)} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface2" onClick={() => toggle(l.id)}>
            <Tag size={16} style={{ color: l.color }} />
            <span className="flex-1 truncate text-left">{l.name}</span>
            {value.includes(l.id) && <Check size={16} />}
          </button>
        ))}
        {canCreate && (
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm text-accent-text hover:bg-surface2"
            onClick={() => {
              const l = actions.createLabel(q.trim());
              onChange([...value, l.id]);
              setQ('');
            }}
          >
            <Plus size={16} /> Create "{q.trim()}"
          </button>
        )}
        {!list.length && !canCreate && <p className="p-2 text-sm text-muted">No labels yet. Type a name to create one.</p>}
      </PopoverContent>
    </PopoverRoot>
  );
}

export interface RecurrenceValue {
  rule: string;
  mode: 'fixed' | 'after_completion';
}

export function RecurrencePicker({ value, onChange, disabledReason }: { value: RecurrenceValue | null; onChange: (v: RecurrenceValue | null) => void; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const mode = value?.mode ?? 'fixed';
  const [every, setEvery] = useState(1);
  const [unit, setUnit] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'>('WEEKLY');
  const customOk = custom.trim() ? validateRule(custom) : null;
  const builtRule = unit === 'WEEKLY' && days.length ? `${weeklyRule(days)}${every > 1 ? `;INTERVAL=${every}` : ''}` : `FREQ=${unit}${every > 1 ? `;INTERVAL=${every}` : ''}`;
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip active={!!value} title={disabledReason}>
          <Repeat size={14} aria-hidden />
          {value ? describeRule(value.rule) : 'Repeat'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[300px]">
        {disabledReason && <p className="mb-2 rounded-lg bg-surface2 p-2 text-xs text-muted">{disabledReason}</p>}
        {RULE_PRESETS.map((p) => (
          <button key={p.rule} type="button" className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface2" onClick={() => {
              onChange({ rule: p.rule, mode });
              setOpen(false);
            }}>
            <span className="flex-1 text-left">{p.label}</span>
            {value?.rule === p.rule && <Check size={16} />}
          </button>
        ))}
        <div className="mt-1 border-t border-line pt-2">
          <p className="mb-1 text-xs font-medium text-muted">Custom: repeat every</p>
          <div className="flex items-center gap-2">
            <Input aria-label="Repeat every (number)" type="number" min={1} max={99} value={every} onChange={(e) => setEvery(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} className="w-20" />
            <Select aria-label="Repeat unit" value={unit} onChange={(e) => setUnit(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY')} className="flex-1">
              <option value="DAILY">{every === 1 ? 'day' : 'days'}</option>
              <option value="WEEKLY">{every === 1 ? 'week' : 'weeks'}</option>
              <option value="MONTHLY">{every === 1 ? 'month' : 'months'}</option>
              <option value="YEARLY">{every === 1 ? 'year' : 'years'}</option>
            </Select>
          </div>
          {unit === 'WEEKLY' && (
            <>
              <p className="mb-1 mt-2 text-xs font-medium text-muted">On these weekdays (optional)</p>
              <div className="flex gap-1">
                {WD.map((d, i) => (
                  <button key={i} type="button" aria-pressed={days.includes(i)} aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} className={clsx('h-8 w-8 rounded-full text-xs', days.includes(i) ? 'bg-accent text-accent-fg' : 'bg-surface2')}>
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="mt-2 text-xs text-muted">{describeRule(builtRule)}</p>
          <Button size="sm" className="mt-2" onClick={() => onChange({ rule: builtRule, mode })}>
            Use this repeat
          </Button>
        </div>
        <details className="mt-2 border-t border-line pt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted">Advanced: custom rule (RRULE)</summary>
          <label htmlFor="rrule" className="mb-1 mt-2 block text-xs text-muted">
            e.g. FREQ=MONTHLY;BYMONTHDAY=15
          </label>
          <Input id="rrule" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="FREQ=WEEKLY;INTERVAL=3" />
          {customOk && !customOk.ok && <p className="mt-1 text-xs text-danger">{customOk.error}</p>}
          <Button size="sm" className="mt-2" disabled={!customOk || !customOk.ok} onClick={() => onChange({ rule: custom.trim(), mode })}>
            Use custom rule
          </Button>
        </details>
        {value && (
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2 text-sm">
            <span id="after-completion">Repeat after completion</span>
            <Switch label="Repeat after completion" checked={mode === 'after_completion'} onChange={(v) => onChange({ rule: value.rule, mode: v ? 'after_completion' : 'fixed' })} />
          </div>
        )}
        {value && (
          <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => onChange(null)}>
            Remove repeat
          </Button>
        )}
      </PopoverContent>
    </PopoverRoot>
  );
}

const REL_PRESETS = [
  { label: 'At time of task', offset: 0 },
  { label: '10 minutes before', offset: 10 },
  { label: '30 minutes before', offset: 30 },
  { label: '1 hour before', offset: 60 },
  { label: '1 day before', offset: 1440 },
];

/** Chip + popover wrapper around ReminderEditor, for compact forms such as Quick Add. */
export function ReminderPicker({ value, onChange, hasTime }: { value: ReminderInput[]; onChange: (r: ReminderInput[]) => void; hasTime: boolean }) {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Chip active={value.length > 0}>
          <Bell size={14} aria-hidden />
          {value.length ? `${value.length} reminder${value.length > 1 ? 's' : ''}` : 'Reminders'}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[320px]">
        <ReminderEditor value={value} onChange={onChange} hasTime={hasTime} />
        <div className="mt-2 flex justify-end">
          <PopoverClose asChild>
            <Button size="sm" variant="primary">
              Done
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

export function ReminderEditor({ value, onChange, hasTime }: { value: ReminderInput[]; onChange: (r: ReminderInput[]) => void; hasTime: boolean }) {
  const [abs, setAbs] = useState('');
  const label = (r: ReminderInput) => (r.kind === 'relative' ? (REL_PRESETS.find((p) => p.offset === r.offsetMinutes)?.label ?? `${r.offsetMinutes} min before`) : new Date(r.atUtc as string).toLocaleString());
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((r, i) => (
          <Chip key={r.id ?? i} active>
            <Bell size={14} aria-hidden />
            {label(r)}
            <button type="button" aria-label="Remove reminder" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X size={14} />
            </button>
          </Chip>
        ))}
        {!value.length && <span className="text-sm text-muted">No reminders</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Add a reminder" value="" onChange={(e) => e.target.value !== '' && onChange([...value, { kind: 'relative', offsetMinutes: Number(e.target.value), channel: 'inapp', enabled: true }])} className="max-w-[220px]">
          <option value="">Add relative reminder...</option>
          {REL_PRESETS.map((p) => (
            <option key={p.offset} value={p.offset}>
              {p.label}
            </option>
          ))}
        </Select>
        <Input aria-label="Absolute reminder time" type="datetime-local" value={abs} onChange={(e) => setAbs(e.target.value)} className="max-w-[220px]" />
        <Button
          size="sm"
          disabled={!abs}
          onClick={() => {
            onChange([...value, { kind: 'absolute', atUtc: new Date(abs).toISOString(), channel: 'inapp', enabled: true }]);
            setAbs('');
          }}
        >
          Add
        </Button>
      </div>
      {!hasTime && <p className="text-xs text-muted">Relative reminders on a date-only task fire at your default reminder time (Settings, Task defaults).</p>}
    </div>
  );
}
