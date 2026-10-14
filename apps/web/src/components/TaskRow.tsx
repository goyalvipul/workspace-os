import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as Dialog from '@radix-ui/react-dialog';
import { AlignLeft, Bell, CalendarClock, GripVertical, Repeat, Hash } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { formatDateLabel, formatTime, isOverdue, localTimeOf, sortByPosition, type TaskDTO } from '@wos/shared';
import { actions, useStore } from '../lib/store';
import { useHour12, useToday, useTz } from '../lib/hooks';
import { Button, clsx } from './ui';

export const PRIORITY_COLOR: Record<number, string> = { 1: '#e5484d', 2: '#f5a623', 3: '#4c8dff', 4: 'var(--muted)' };
export const PRIORITY_LABEL: Record<number, string> = { 1: 'Priority 1', 2: 'Priority 2', 3: 'Priority 3', 4: 'Priority 4' };

export function TaskCheckbox({ task, onToggle }: { task: TaskDTO; onToggle: () => void }) {
  const done = task.status === 'completed';
  const color = PRIORITY_COLOR[task.priority] ?? 'var(--muted)';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${done ? 'Reopen' : 'Complete'} ${task.title}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <span className={clsx('flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-colors', done && 'anim-pop')} style={{ borderColor: color, background: done ? color : `color-mix(in srgb, ${color} 12%, transparent)` }}>
        {done && (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

export function useToggleTask() {
  const subtasks = useStore((s) => s.tasks);
  const prompt = useStore((s) => s.prefs['tasks.completeParentPrompt'] as boolean);
  const [asking, setAsking] = useState<TaskDTO | null>(null);
  const toggle = (task: TaskDTO) => {
    if (task.status === 'completed') return actions.reopenTask(task.id);
    const openSubs = Object.values(subtasks).filter((t) => t.parentTaskId === task.id && t.status === 'open');
    if (openSubs.length && prompt) return setAsking(task);
    actions.completeTask(task.id);
  };
  const dialog = (
    <Dialog.Root open={!!asking} onOpenChange={(o) => !o && setAsking(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content aria-describedby="cp-body" className="anim-sheet fixed left-1/2 top-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-bg p-5 shadow-2xl outline-none">
          <Dialog.Title className="text-lg font-semibold">This task has open subtasks</Dialog.Title>
          <p id="cp-body" className="mt-2 text-sm text-muted">
            Do you want to complete the subtasks too?
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button
              variant="primary"
              onClick={() => {
                if (asking) actions.completeTask(asking.id, { completeSubtasks: true });
                setAsking(null);
              }}
            >
              Complete task and subtasks
            </Button>
            <Button
              onClick={() => {
                if (asking) actions.completeTask(asking.id);
                setAsking(null);
              }}
            >
              Complete only this task
            </Button>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
  return { toggle, dialog };
}

interface RowProps {
  task: TaskDTO;
  showProject?: boolean;
  showDate?: boolean;
  depth?: number;
  onToggle: (t: TaskDTO) => void;
  dragging?: boolean;
  handle?: React.HTMLAttributes<HTMLElement> & Record<string, unknown>;
  subtaskCount?: { done: number; total: number };
}

export const TaskRow = memo(function TaskRow({ task, showProject, showDate = true, depth = 0, onToggle, handle, subtaskCount, dragging }: RowProps) {
  const today = useToday();
  const tz = useTz();
  const hour12 = useHour12();
  const project = useStore((s) => (task.projectId ? s.projects[task.projectId] : null));
  const labels = useStore((s) => s.labels);
  const overdue = isOverdue(task, today);
  const done = task.status === 'completed';
  const date = task.dueDate ?? task.scheduledDate;
  const time = task.dueAtUtc ? formatTime(localTimeOf(task.dueAtUtc, task.dueTimezone ?? tz), hour12) : task.scheduledAtUtc ? formatTime(localTimeOf(task.scheduledAtUtc, tz), hour12) : null;
  const dateColor = overdue ? 'text-danger' : date === today ? 'text-ok' : 'text-muted';
  const taskLabels = task.labelIds.map((id) => labels[id]).filter(Boolean);
  return (
    <div
      className={clsx('group flex items-start gap-0 border-b border-line/70 pr-2 outline-none', dragging && 'rounded-lg bg-surface shadow-lg')}
      style={{ paddingLeft: depth * 28 }}
    >
      <TaskCheckbox task={task} onToggle={() => onToggle(task)} />
      <button type="button" onClick={() => actions.openTask(task.id)} className="min-w-0 flex-1 py-2.5 pr-1 text-left" aria-label={`Open ${task.title}`}>
        <span className={clsx('block break-words text-[15px] leading-snug', done && 'text-muted line-through')}>{task.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {showDate && date && (
            <span className={clsx('inline-flex items-center gap-1', dateColor)}>
              <CalendarClock size={12} aria-hidden />
              {formatDateLabel(date, today)}
              {time ? ` ${time}` : ''}
              {task.recurrence && <Repeat size={12} aria-label="Repeats" />}
            </span>
          )}
          {!date && task.recurrence && <Repeat size={12} aria-label="Repeats" />}
          {subtaskCount && subtaskCount.total > 0 && (
            <span>
              {subtaskCount.done}/{subtaskCount.total}
            </span>
          )}
          {task.description && <AlignLeft size={12} aria-label="Has description" />}
          {task.reminders.length > 0 && <Bell size={12} aria-label="Has reminder" />}
          {taskLabels.map((l) => (
            <span key={l.id} style={{ color: l.color }}>
              @{l.name}
            </span>
          ))}
          {showProject && project && (
            <span className="ml-auto inline-flex items-center gap-1">
              {project.name}
              <Hash size={12} style={{ color: project.color }} aria-hidden />
            </span>
          )}
        </span>
      </button>
      {handle && (
        <button type="button" aria-label={`Reorder ${task.title}`} className="mt-2 hidden h-8 w-6 touch-none items-center justify-center text-muted hover:text-fg md:flex md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100" {...handle}>
          <GripVertical size={16} />
        </button>
      )}
    </div>
  );
});

function SortableRow(props: Omit<RowProps, 'handle' | 'dragging'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, position: 'relative', zIndex: isDragging ? 5 : undefined }}>
      <TaskRow {...props} dragging={isDragging} handle={{ ...attributes, ...listeners } as never} />
    </div>
  );
}

interface ListProps {
  tasks: TaskDTO[];
  showProject?: boolean;
  showDate?: boolean;
  /** enables drag reorder; the destination list identity for the server */
  sortable?: { projectId: string | null; sectionId: string | null; parentTaskId?: string | null };
  /** render open subtasks (from the store) nested under their parent */
  nested?: boolean;
  /** include completed subtasks in nested rendering */
  includeCompletedChildren?: boolean;
}

export function TaskList({ tasks, showProject, showDate, sortable, nested, includeCompletedChildren }: ListProps) {
  const all = useStore((s) => s.tasks);
  const { toggle, dialog } = useToggleTask();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const childrenOf = useMemo(() => {
    const m = new Map<string, TaskDTO[]>();
    for (const t of Object.values(all)) {
      if (!t.parentTaskId || t.deletedAt) continue;
      if (t.status !== 'open' && !includeCompletedChildren) continue;
      const arr = m.get(t.parentTaskId) ?? [];
      arr.push(t);
      m.set(t.parentTaskId, arr);
    }
    for (const [k, v] of m) m.set(k, sortByPosition(v));
    return m;
  }, [all, includeCompletedChildren]);

  const counts = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const t of Object.values(all)) {
      if (!t.parentTaskId || t.deletedAt) continue;
      const c = m.get(t.parentTaskId) ?? { done: 0, total: 0 };
      c.total++;
      if (t.status === 'completed') c.done++;
      m.set(t.parentTaskId, c);
    }
    return m;
  }, [all]);

  const ids = tasks.map((t) => t.id);
  const onDragEnd = (e: DragEndEvent) => {
    if (!sortable || !e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    actions.reorderTask(String(e.active.id), { projectId: sortable.projectId, sectionId: sortable.sectionId, parentTaskId: sortable.parentTaskId ?? null }, next);
  };

  const renderChildren = (parentId: string, depth: number): React.ReactNode =>
    (childrenOf.get(parentId) ?? []).map((c) => (
      <div key={c.id}>
        <TaskRow task={c} onToggle={toggle} depth={depth} showDate={showDate} subtaskCount={counts.get(c.id)} />
        {depth < 4 && renderChildren(c.id, depth + 1)}
      </div>
    ));

  const rows = tasks.map((t) =>
    sortable ? (
      <div key={t.id}>
        <SortableRow task={t} showProject={showProject} showDate={showDate} onToggle={toggle} subtaskCount={counts.get(t.id)} />
        {nested && renderChildren(t.id, 1)}
      </div>
    ) : (
      <div key={t.id}>
        <TaskRow task={t} showProject={showProject} showDate={showDate} onToggle={toggle} subtaskCount={counts.get(t.id)} />
        {nested && renderChildren(t.id, 1)}
      </div>
    ),
  );

  return (
    <div>
      {sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        </DndContext>
      ) : (
        rows
      )}
      {dialog}
    </div>
  );
}
