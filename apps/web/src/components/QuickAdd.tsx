import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDue, describeRule, formatDateLabel, formatTime, parseQuickAdd, stripTokens, type QuickAddToken, type ReminderInput } from '@wos/shared';
import { actions, toast, useStore } from '../lib/store';
import { useHour12, useToday, useTz } from '../lib/hooks';
import { DatePicker, LabelPicker, PriorityPicker, ProjectPicker, RecurrencePicker, ReminderPicker, type DateValue, type RecurrenceValue } from './pickers';
import { Button, IconButton, Input, Sheet, Textarea, clsx } from './ui';

const KIND_STYLE: Record<QuickAddToken['kind'], string> = {
  date: 'text-ok',
  time: 'text-ok',
  priority: 'text-warn',
  project: 'text-accent-text',
  label: 'text-accent-text',
  recurrence: 'text-ok',
};

export function QuickAdd() {
  const open = useStore((s) => s.quickAddOpen);
  const defaults = useStore((s) => s.quickAddDefaults);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && actions.closeQuickAdd()} title="Quick add task">
      {open && <QuickAddForm defaults={defaults} />}
    </Sheet>
  );
}

function QuickAddForm({ defaults }: { defaults: ReturnType<typeof useStore.getState>['quickAddDefaults'] }) {
  const today = useToday();
  const tz = useTz();
  const hour12 = useHour12();
  const projects = useStore((s) => s.projects);
  const labels = useStore((s) => s.labels);
  const prefs = useStore((s) => s.prefs);
  const [text, setText] = useState('');
  const [desc, setDesc] = useState('');
  const [ignored, setIgnored] = useState<string[]>([]);
  const [manualDate, setManualDate] = useState<DateValue | null>(defaults?.date ? { date: defaults.date, time: null } : null);
  const [manualPriority, setManualPriority] = useState<number | null>(null);
  const [manualProject, setManualProject] = useState<{ p: string | null; s: string | null } | null>(
    defaults?.projectId !== undefined ? { p: defaults.projectId ?? null, s: defaults.sectionId ?? null } : prefs['tasks.rememberLastProject'] && prefs['tasks.lastProjectId'] ? { p: prefs['tasks.lastProjectId'] as string, s: null } : null,
  );
  const [manualLabels, setManualLabels] = useState<string[] | null>(null);
  const [manualRec, setManualRec] = useState<{ v: RecurrenceValue | null } | null>(null);
  const [showDesc, setShowDesc] = useState(false);
  const [reminders, setReminders] = useState<ReminderInput[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const parsed = useMemo(
    () => parseQuickAdd(text, { today, projects: Object.values(projects).filter((p) => !p.archivedAt).map((p) => ({ id: p.id, name: p.name })), labels: Object.values(labels).map((l) => ({ id: l.id, name: l.name })) }),
    [text, today, projects, labels],
  );
  const tokens = parsed.tokens.filter((t) => !ignored.includes(`${t.kind}:${t.text}`));
  const has = (k: QuickAddToken['kind']) => tokens.some((t) => t.kind === k);

  const date: DateValue = manualDate ?? { date: has('date') || has('recurrence') ? parsed.dueDate : null, time: has('time') ? parsed.dueTime : null };
  const priority = manualPriority ?? (has('priority') ? (parsed.priority ?? 4) : ((prefs['tasks.defaultPriority'] as number) || 4));
  const project = manualProject ?? { p: has('project') ? parsed.projectId : null, s: null };
  const labelNames = has('label') ? parsed.labelNames : [];
  const recurrence: RecurrenceValue | null = manualRec ? manualRec.v : has('recurrence') && parsed.recurrenceRule ? { rule: parsed.recurrenceRule, mode: 'fixed' } : null;
  const manualLabelIds = manualLabels ?? [];

  const title = (stripTokens(text, tokens).trim() || text.trim()).slice(0, 500);
  // A repeat or a relative reminder needs a date to anchor to; fall back to today instead of silently dropping it.
  const needsDate = !!recurrence || reminders.some((r) => r.kind === 'relative');
  // Tasks that go into a project default to Today so they show up in Today / Upcoming / Calendar; choosing "No date" in the picker opts out.
  const explicitNoDate = manualDate !== null && !manualDate.date;
  const effectiveDate = date.date ?? (needsDate || (project.p && !explicitNoDate) ? today : null);

  const submit = (stay: boolean) => {
    if (!title) return;
    const ids = new Set(manualLabelIds);
    for (const n of labelNames) ids.add(actions.createLabel(n).id);
    const due = effectiveDate ? buildDue({ date: effectiveDate, time: date.date ? date.time : null, timezone: tz }) : null;
    actions.createTask({
      title,
      description: desc.trim() || undefined,
      priority,
      projectId: project.p,
      sectionId: project.s,
      labelIds: [...ids],
      dueDate: due?.dueDate ?? null,
      dueAtUtc: due?.dueAtUtc ?? null,
      dueTimezone: due?.dueTimezone ?? null,
      recurrence: recurrence && due ? recurrence : null,
      reminders,
    });
    const where = project.p ? (projects[project.p]?.name ?? 'project') : 'Inbox';
    toast(`Added to ${where}`, 'success');
    if (stay) {
      setText('');
      setDesc('');
      setIgnored([]);
      setReminders([]);
      setManualDate(date.date ? date : null);
      inputRef.current?.focus();
    } else actions.closeQuickAdd();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Quick add</h2>
        <IconButton label="Close" type="button" onClick={() => actions.closeQuickAdd()}>
          <X size={20} />
        </IconButton>
      </div>
      <Input
        ref={inputRef}
        aria-label="Task name"
        placeholder='e.g. "Pay rent every month on the 1st p1 #Home @bills"'
        value={text}
        maxLength={600}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit(true);
          }
        }}
        className="min-h-12 text-base"
      />
      {tokens.length > 0 && !manualDate && (
        <div className="flex flex-wrap gap-2" aria-label="Recognised from your text">
          {tokens.map((t) => (
            <span key={`${t.kind}:${t.start}`} className={clsx('inline-flex min-h-7 items-center gap-1 rounded-full border border-line px-2.5 text-xs', KIND_STYLE[t.kind])}>
              {t.label}
              <button type="button" aria-label={`Don't use "${t.text}" as ${t.kind}`} onClick={() => setIgnored([...ignored, `${t.kind}:${t.text}`])}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {tokens.length > 0 && manualDate && (
        <div className="flex flex-wrap gap-2">
          {tokens.map((t) => (
            <span key={`${t.kind}:${t.start}`} className={clsx('inline-flex min-h-7 items-center gap-1 rounded-full border border-line px-2.5 text-xs', KIND_STYLE[t.kind])}>
              {t.label}
              <button type="button" aria-label={`Don't use "${t.text}" as ${t.kind}`} onClick={() => setIgnored([...ignored, `${t.kind}:${t.text}`])}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {showDesc ? (
        <Textarea aria-label="Description" rows={3} placeholder="Description (Markdown supported)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      ) : (
        <button type="button" className="self-start text-sm text-muted hover:text-fg" onClick={() => setShowDesc(true)}>
          + Add description
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        <DatePicker value={{ date: effectiveDate, time: effectiveDate ? date.time : null }} onChange={(v) => setManualDate(v)} />
        <PriorityPicker value={priority} onChange={setManualPriority} compact />
        <ProjectPicker projectId={project.p} sectionId={project.s} onChange={(p, s) => setManualProject({ p, s })} />
        <LabelPicker value={[...new Set([...manualLabelIds, ...labelNames.map((n) => Object.values(labels).find((l) => l.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x)])]} onChange={setManualLabels} />
        <RecurrencePicker value={recurrence} onChange={(v) => setManualRec({ v })} disabledReason={explicitNoDate && recurrence ? 'A repeating task needs a date; Today is used if you leave it empty.' : undefined} />
        <ReminderPicker value={reminders} onChange={setReminders} hasTime={!!date.time} />
      </div>
      {(effectiveDate || recurrence) && (
        <p className="text-xs text-muted">
          {effectiveDate ? `Due ${formatDateLabel(effectiveDate, today)}${date.date && date.time ? ` at ${formatTime(date.time, hour12)}` : ''}` : ''}
          {recurrence ? `${effectiveDate ? ' \u00b7 ' : ''}${describeRule(recurrence.rule)}${recurrence.mode === 'after_completion' ? ' (after completion)' : ''}` : ''}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="hidden text-xs text-muted md:inline">Enter to add &middot; Ctrl+Enter to add another</span>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={() => actions.closeQuickAdd()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!title}>
            <Plus size={16} aria-hidden /> Add task
          </Button>
        </div>
      </div>
    </form>
  );
}
