import { closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, GripVertical, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDateLabel, type TaskDTO } from '@wos/shared';
import { TaskCheckbox, useToggleTask } from '../components/TaskRow';
import { useToday } from '../lib/hooks';
import { actions, useStore } from '../lib/store';
import { clsx } from '../components/ui';

type Lane = 'todo' | 'done';
const laneId = (lane: Lane) => `today:${lane}`;

function StatusUpdate({ task }: { task: TaskDTO }) {
  const [draft, setDraft] = useState(task.statusUpdate ?? '');
  const [editing, setEditing] = useState(false);
  const cancelRef = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(task.statusUpdate ?? '');
  }, [task.statusUpdate, editing, task.id]);
  const save = () => {
    setEditing(false);
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(task.statusUpdate ?? '');
      return;
    }
    const update = draft.trim();
    if (update !== (task.statusUpdate ?? '')) actions.updateTask(task.id, { statusUpdate: update });
  };
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-semibold text-muted">Status update</span>
      <textarea
        aria-label={`Status update for ${task.title}`}
        rows={2}
        maxLength={280}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => { cancelRef.current = false; setEditing(true); }}
        onBlur={save}
        onKeyDown={(e) => {
          // Enter commits, Shift+Enter adds a new line.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            cancelRef.current = true;
            e.currentTarget.blur();
          }
        }}
        placeholder="Add a brief update..."
        className="wos-today-update w-full resize-none rounded-xl border border-line bg-bg p-2 text-xs text-fg placeholder:text-muted focus:border-accent-text focus:outline-none"
      />
    </label>
  );
}

function CardContents({ task, onToggle, onMove, preview = false }: {
  task: TaskDTO;
  onToggle: (task: TaskDTO) => void;
  onMove?: (task: TaskDTO) => void;
  preview?: boolean;
}) {
  const today = useToday();
  const project = useStore((s) => tProject(s.projects, task.projectId));
  const date = task.dueDate ?? task.scheduledDate;
  const done = task.status === 'completed';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start gap-1">
        <TaskCheckbox task={task} onToggle={() => onToggle(task)} />
        <button type="button" className="min-w-0 flex-1 break-words pt-2 text-left text-sm font-bold leading-snug" onClick={() => actions.openTask(task.id)}>{task.title}</button>
      </div>
      <div className="flex flex-wrap gap-1.5 px-1 text-[11px] text-muted">
        {date && <span className="inline-flex items-center gap-1"><Clock3 size={12} aria-hidden />{formatDateLabel(date, today)}</span>}
        {project && <span className="min-w-0 truncate rounded-md bg-surface2 px-1.5 py-0.5">{project.name}</span>}
        {task.priority < 4 && <span className="rounded-md bg-surface2 px-1.5 py-0.5">P{task.priority}</span>}
      </div>
      {!preview && <StatusUpdate task={task} />}
      {preview && task.statusUpdate && <p className="line-clamp-2 text-xs text-muted">{task.statusUpdate}</p>}
      {!preview && onMove && (
        <button type="button" className="wos-today-move inline-flex min-h-9 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold" onClick={() => onMove(task)}>
          {done ? <><ArrowLeft size={14} aria-hidden /> Move to To Do</> : <><ArrowRight size={14} aria-hidden /> Move to Done</>}
        </button>
      )}
    </div>
  );
}
function tProject(projects: Record<string, { name: string }>, id: string | null) {
  return id ? projects[id] ?? null : null;
}

function TodayCard({ task, onToggle }: { task: TaskDTO; onToggle: (task: TaskDTO) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'today-task', lane: task.status === 'completed' ? 'done' : 'todo' } });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={clsx('wos-today-card min-w-0 rounded-2xl border border-line bg-surface p-2.5 shadow-sm', isDragging && 'ring-2 ring-accent-text')}
    >
      <div className="mb-1 flex justify-end">
        <button type="button" aria-label={`Drag ${task.title}`} className="wos-today-grip flex h-8 w-8 touch-none items-center justify-center rounded-lg text-muted hover:bg-surface2" {...attributes} {...listeners}>
          <GripVertical size={17} aria-hidden />
        </button>
      </div>
      <CardContents task={task} onToggle={onToggle} onMove={onToggle} />
    </article>
  );
}

function TodayLane({ lane, tasks, onToggle, onAdd }: { lane: Lane; tasks: TaskDTO[]; onToggle: (task: TaskDTO) => void; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId(lane), data: { type: 'today-lane', lane } });
  return (
    <section className={clsx('wos-today-lane min-w-0 rounded-[24px] border border-line bg-surface2/45 p-2 sm:p-3', isOver && 'ring-2 ring-accent-text')} aria-label={lane === 'todo' ? 'To Do column' : 'Done column'}>
      <div className="mb-3 flex min-h-12 items-center justify-between gap-1 border-b border-line pb-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-extrabold">
          {lane === 'todo' ? <Clock3 size={16} className="text-accent-text" aria-hidden /> : <CheckCircle2 size={16} className="text-ok" aria-hidden />}
          {lane === 'todo' ? 'To Do' : 'Done'}
        </h2>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="wos-today-lane-body flex min-h-36 flex-col gap-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <TodayCard key={t.id} task={t} onToggle={onToggle} />)}
        </SortableContext>
        {tasks.length === 0 && <p className="rounded-2xl border border-dashed border-line p-3 text-center text-xs leading-relaxed text-muted">
          {lane === 'todo' ? 'Nothing left to do. Add a task or move one back.' : 'Drop a task here when it is done.'}
        </p>}
        {lane === 'todo' && <button className="mt-auto flex min-h-11 items-center justify-center gap-1 rounded-xl border border-dashed border-line text-xs font-semibold text-muted hover:bg-surface" onClick={onAdd}><Plus size={16} aria-hidden /> Add task</button>}
      </div>
    </section>
  );
}

/** Two status lanes based on the existing open/completed workflow, not project sections. */
export function TodayBoard({ open, done, date }: { open: TaskDTO[]; done: TaskDTO[]; date: string }) {
  const { toggle, dialog } = useToggleTask();
  const [activeId, setActiveId] = useState<string | null>(null);
  const tasks = [...open, ...done];
  const activeTask = tasks.find((t) => t.id === activeId) ?? null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const item = tasks.find((t) => t.id === String(active.id));
    if (!item) return;
    const targetId = String(over.id);
    const target = targetId === laneId('done') ? 'done' :
      targetId === laneId('todo') ? 'todo' :
      done.some((t) => t.id === targetId) ? 'done' :
      open.some((t) => t.id === targetId) ? 'todo' : null;
    if (target === 'done' && item.status === 'open') toggle(item);
    if (target === 'todo' && item.status === 'completed') toggle(item);
  };
  return (
    <div className="wos-today-board">
      <p className="mb-3 text-xs text-muted">Drag cards by their handle, or use the Move button. Updates are saved automatically. Completed repeating tasks advance to their next occurrence.</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragEnd={onEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="wos-today-board-grid grid grid-cols-2 items-start gap-2 sm:gap-4">
          <TodayLane lane="todo" tasks={open} onToggle={toggle} onAdd={() => actions.openQuickAdd({ date })} />
          <TodayLane lane="done" tasks={done} onToggle={toggle} onAdd={() => undefined} />
        </div>
        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {activeTask && <div className="wos-today-card w-[min(270px,70vw)] rounded-2xl border-2 border-accent-text bg-surface p-3 shadow-2xl"><CardContents task={activeTask} onToggle={() => undefined} preview /></div>}
        </DragOverlay>
      </DndContext>
      {dialog}
    </div>
  );
}
