import { closestCorners, DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ArrowUpToLine, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Columns3, Heart, ListIcon, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { COLORS, sortByPosition, type ProjectDTO, type SectionDTO, type TaskDTO } from '@wos/shared';
import { PageHeader } from '../components/PageHeader';
import { TaskList, TaskRow, useToggleTask } from '../components/TaskRow';
import { Button, Confirm, EmptyState, Field, IconButton, Input, MenuContent, MenuItem, MenuRoot, MenuSep, MenuTrigger, Segmented, Select, Sheet, SheetHeader, Switch, Textarea, clsx } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useAllTasks, flattenTree, useProjectTree } from '../lib/selectors';
import { actions, toast, useStore } from '../lib/store';
import { AddInline } from './views';

function useProjectData(projectId: string) {
  const all = useAllTasks();
  const sections = useStore((s) => s.sections);
  return useMemo(() => {
    const secs = Object.values(sections).filter((s) => s.projectId === projectId && !s.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
    const top = all.filter((t) => t.projectId === projectId && !t.parentTaskId);
    const open = top.filter((t) => t.status === 'open');
    const done = top.filter((t) => t.status === 'completed').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    const bySection = (sid: string | null) => sortByPosition(open.filter((t) => t.sectionId === sid));
    const doneSection = secs.find((s) => s.isDone) ?? null;
    /** Board column contents: open tasks, except the Done column which also shows completed tasks. */
    const boardTasks = (sec: SectionDTO | null) => sortByPosition(top.filter((t) => t.sectionId === (sec?.id ?? null) && (sec?.isDone ? t.status !== 'archived' : t.status === 'open')));
    return { secs, top, open, done, bySection, doneSection, boardTasks };
  }, [all, sections, projectId]);
}

export function ProjectPage() {
  const { id = '' } = useParams();
  const project = useStore((s) => s.projects[id]);
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const data = useProjectData(id);
  const view = project?.defaultView ?? 'list';
  // On a board, tasks that live in the Done column are already visible there.
  const doneList = view === 'board' && data.doneSection ? data.done.filter((t) => t.sectionId !== data.doneSection?.id) : data.done;
  if (!project) return <EmptyState title="Project not found" body="It may have been deleted on another device." art={false}>
    <Button onClick={() => nav('/browse')}>Back to Browse</Button>
  </EmptyState>;
  return (
    <>
      <PageHeader
        title={project.name}
        color={project.color}
        back="/browse"
        right={
          <>
            <Segmented
              label="Project layout"
              value={view}
              onChange={(v) => {
                actions.updateProject(id, { defaultView: v });
                // First time on a board: start with the usual To Do / In Progress / Done columns (To Do = tasks without a section).
                if (v === 'board' && data.secs.length === 0) setupBoardColumns(id);
              }}
              options={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} />
            <MenuRoot>
              <MenuTrigger asChild>
                <IconButton label="Project options">
                  <MoreHorizontal size={20} />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Pencil size={16} />} onSelect={() => setEditing(true)}>Edit project</MenuItem>
                <MenuItem icon={<Plus size={16} />} onSelect={() => setAddingSection(true)}>Add section</MenuItem>
                <MenuItem icon={<Heart size={16} />} onSelect={() => actions.updateProject(id, { favorite: !project.favorite })}>{project.favorite ? 'Remove from favorites' : 'Add to favorites'}</MenuItem>
                <MenuItem icon={<ArrowUpToLine size={16} />} onSelect={() => actions.moveProjectToTop(id)}>Move to top</MenuItem>
                <MenuItem icon={<Archive size={16} />} onSelect={() => { actions.updateProject(id, { archived: !project.archivedAt }); if (!project.archivedAt) nav('/browse'); }}>
                  {project.archivedAt ? 'Unarchive' : 'Archive'}
                </MenuItem>
                <MenuSep />
                <MenuItem danger icon={<Trash2 size={16} />} onSelect={() => setDeleting(true)}>Delete project</MenuItem>
              </MenuContent>
            </MenuRoot>
          </>
        }
      />
      {project.archivedAt && <p className="mb-2 rounded-lg bg-surface p-3 text-sm text-muted">This project is archived. Unarchive it from the menu to bring it back to your sidebar.</p>}
      {(project.outcome || project.description) && (
        <div className="mb-3 rounded-lg bg-surface p-3 text-sm">
          {project.outcome && <p><span className="font-semibold">Outcome:</span> {project.outcome}</p>}
          {project.description && <p className="mt-1 whitespace-pre-wrap text-muted">{project.description}</p>}
        </div>
      )}

      {view === 'list' ? <ListLayout project={project} data={data} /> : <BoardLayout project={project} data={data} />}

      {addingSection && <SectionAdder projectId={id} onClose={() => setAddingSection(false)} />}
      {view === 'list' && !addingSection && (
        <button className="mt-3 flex min-h-10 items-center gap-2 px-3 text-sm text-muted hover:text-accent-text" onClick={() => setAddingSection(true)}>
          <Plus size={16} aria-hidden /> Add section
        </button>
      )}

      {doneList.length > 0 && (
        <section className="mt-6" aria-label="Completed tasks">
          <button className="flex min-h-10 items-center gap-1 text-sm font-semibold text-muted" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <ChevronDown size={16} className={clsx('transition-transform', !showDone && '-rotate-90')} aria-hidden /> Completed ({doneList.length})
          </button>
          {showDone && <TaskList tasks={doneList} showDate={false} />}
        </section>
      )}

      <ProjectEditor project={project} open={editing} onClose={() => setEditing(false)} />
      <DeleteProject project={project} open={deleting} onClose={() => setDeleting(false)} taskCount={data.open.length} />
    </>
  );
}

function SectionAdder({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) actions.createSection(projectId, name);
        onClose();
      }}
    >
      <Input autoFocus aria-label="Section name" placeholder="Section name" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" variant="primary" disabled={!name.trim()}>Add</Button>
      <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
    </form>
  );
}

type Data = ReturnType<typeof useProjectData>;

/** Creates the standard board columns. "To Do" is the unsectioned column, so only the other two are real sections. */
function setupBoardColumns(projectId: string): void {
  actions.createSection(projectId, 'In Progress');
  actions.createSection(projectId, 'Done', { isDone: true });
}

function SectionHeader({ section, count, onMove }: { section: SectionDTO; count: number; onMove?: { left: (() => void) | null; right: (() => void) | null } }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(section.name);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex min-h-10 items-center justify-between border-b border-line py-1">
      {renaming ? (
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name !== section.name) actions.updateSection(section.id, { name }); setRenaming(false); }}>
          <Input autoFocus aria-label="Section name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} />
        </form>
      ) : (
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold">
          {section.isDone && <CheckCircle2 size={15} className="text-ok" aria-label="Done column" />}
          {section.name} <span className="ml-1 text-xs font-normal text-muted">{count}</span>
        </h2>
      )}
      <MenuRoot>
        <MenuTrigger asChild>
          <IconButton label={`Section options for ${section.name}`}><MoreHorizontal size={18} /></IconButton>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<Pencil size={16} />} onSelect={() => setRenaming(true)}>Rename</MenuItem>
          {onMove?.left && <MenuItem icon={<ChevronLeft size={16} />} onSelect={onMove.left}>Move left</MenuItem>}
          {onMove?.right && <MenuItem icon={<ChevronRight size={16} />} onSelect={onMove.right}>Move right</MenuItem>}
          <MenuItem icon={<CheckCircle2 size={16} />} onSelect={() => actions.updateSection(section.id, { isDone: !section.isDone })}>
            {section.isDone ? 'Stop using as Done column' : 'Use as Done column'}
          </MenuItem>
          <MenuItem icon={<Archive size={16} />} onSelect={() => actions.updateSection(section.id, { archived: true })}>Archive</MenuItem>
          <MenuItem danger icon={<Trash2 size={16} />} onSelect={() => setConfirm(true)}>Delete</MenuItem>
        </MenuContent>
      </MenuRoot>
      <Confirm open={confirm} onOpenChange={setConfirm} danger title={`Delete section "${section.name}"?`} body="Its tasks stay in the project, without a section." confirmLabel="Delete section" onConfirm={() => actions.deleteSection(section.id)} />
    </div>
  );
}

function ListLayout({ project, data }: { project: ProjectDTO; data: Data }) {
  const none = data.bySection(null);
  return (
    <div>
      {none.length > 0 && <TaskList tasks={none} nested sortable={{ projectId: project.id, sectionId: null }} />}
      <AddInline onClick={() => actions.openQuickAdd({ projectId: project.id, sectionId: null })} />
      {data.secs.map((s) => {
        const list = data.bySection(s.id);
        return (
          <section key={s.id} className="mt-6" aria-label={s.name}>
            <SectionHeader section={s} count={list.length} />
            <TaskList tasks={list} nested sortable={{ projectId: project.id, sectionId: s.id }} />
            <AddInline onClick={() => actions.openQuickAdd({ projectId: project.id, sectionId: s.id })} />
          </section>
        );
      })}
      {!data.open.length && !data.secs.length && <EmptyState title="No tasks in this project yet" body="Add the first task, or add sections to organise a bigger project." art={false} />}
    </div>
  );
}

function BoardCard({ task, onToggle }: { task: TaskDTO; onToggle: (t: TaskDTO) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: 'task' } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} {...attributes} {...listeners} className="touch-none rounded-lg border border-line bg-surface">
      <TaskRow task={task} onToggle={onToggle} showProject={false} />
    </div>
  );
}

function BoardColumn({ id, title, tasks, onAdd, onToggle, header, done }: { id: string; title: string; tasks: TaskDTO[]; onAdd?: () => void; onToggle: (t: TaskDTO) => void; header?: React.ReactNode; done?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${id}`, data: { type: 'column', sectionId: id === 'none' ? null : id } });
  return (
    <section aria-label={title} className={clsx('flex w-[290px] shrink-0 flex-col rounded-xl border border-line bg-surface/40 px-3 py-2', isOver && 'ring-2 ring-accent-text')}>
      {header ?? (
        <div className="flex min-h-10 items-center justify-between border-b border-line py-1">
          <h2 className="text-[15px] font-bold">{title} <span className="ml-1 text-xs font-normal text-muted">{tasks.length}</span></h2>
        </div>
      )}
      <div ref={setNodeRef} className="flex min-h-[60px] flex-1 flex-col gap-2 py-1">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => <BoardCard key={t.id} task={t} onToggle={onToggle} />)}
        </SortableContext>
        {!tasks.length && <p className="px-2 py-3 text-center text-xs text-muted">{done ? 'Drop a card here to complete it' : 'Drop cards here'}</p>}
      </div>
      {onAdd && (
        <button className="flex min-h-10 items-center gap-2 px-2 text-sm text-muted hover:text-accent-text" onClick={onAdd}>
          <Plus size={16} aria-hidden /> Add task
        </button>
      )}
    </section>
  );
}

function AddColumn({ projectId, hasColumns }: { projectId: string; hasColumns: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const close = () => {
    setOpen(false);
    setName('');
  };
  return (
    <div className="flex w-[290px] shrink-0 flex-col gap-2 self-start rounded-xl border border-dashed border-line px-3 py-2">
      {open ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) actions.createSection(projectId, name);
            close();
          }}
        >
          <Input autoFocus aria-label="Column name" placeholder="Column name, e.g. Review" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={!name.trim()}>Add column</Button>
            <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
          </div>
        </form>
      ) : (
        <button className="flex min-h-10 items-center gap-2 px-2 text-sm text-muted hover:text-accent-text" onClick={() => setOpen(true)}>
          <Plus size={16} aria-hidden /> Add column
        </button>
      )}
      {!hasColumns && !open && (
        <button className="px-2 pb-1 text-left text-xs text-muted underline hover:text-accent-text" onClick={() => setupBoardColumns(projectId)}>
          Add In Progress and Done columns
        </button>
      )}
    </div>
  );
}

function BoardLayout({ project, data }: { project: ProjectDTO; data: Data }) {
  const { toggle, dialog } = useToggleTask();
  const [active, setActive] = useState<TaskDTO | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // The first column ("To Do") holds tasks that have no section; every other column is a section.
  const columns = [{ id: 'none', title: 'To Do', tasks: data.boardTasks(null), section: null as SectionDTO | null }, ...data.secs.map((s) => ({ id: s.id, title: s.name, tasks: data.boardTasks(s), section: s }))];
  const colOf = (taskId: string) => columns.find((c) => c.tasks.some((t) => t.id === taskId));

  const onStart = (e: DragStartEvent) => setActive(data.top.find((t) => t.id === e.active.id) ?? null);
  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    const { active: a, over } = e;
    if (!over) return;
    const taskId = String(a.id);
    const from = colOf(taskId);
    let toCol = columns.find((c) => `col:${c.id}` === String(over.id));
    let index: number;
    if (toCol) index = toCol.tasks.filter((t) => t.id !== taskId).length;
    else {
      toCol = colOf(String(over.id));
      if (!toCol) return;
      const without = toCol.tasks.filter((t) => t.id !== taskId);
      const overIdx = without.findIndex((t) => t.id === String(over.id));
      index = overIdx < 0 ? without.length : overIdx + (from?.id === toCol.id && from.tasks.findIndex((t) => t.id === taskId) < toCol.tasks.findIndex((t) => t.id === String(over.id)) ? 1 : 0);
    }
    const ids = toCol.tasks.filter((t) => t.id !== taskId).map((t) => t.id);
    ids.splice(Math.min(index, ids.length), 0, taskId);
    if (from?.id === toCol.id && ids.join() === toCol.tasks.map((t) => t.id).join()) return;
    const task = data.top.find((t) => t.id === taskId);
    const target = { projectId: project.id, sectionId: toCol.section?.id ?? null };
    // Moving into the Done column completes the task; moving out of it reopens it.
    if (task && toCol.section?.isDone && task.status === 'open') {
      if (task.recurrence) actions.completeTask(taskId); // a repeating task advances to its next date and stays where it was
      else {
        actions.reorderTask(taskId, target, ids);
        actions.completeTask(taskId);
      }
      return;
    }
    if (task && task.status === 'completed' && !toCol.section?.isDone) actions.reopenTask(taskId);
    actions.reorderTask(taskId, target, ids);
  };

  // Ticking a card's checkbox also moves it to the Done column (and back to To Do when unticked there).
  const onToggle = (t: TaskDTO) => {
    const wasOpen = t.status === 'open';
    const doneSec = data.doneSection;
    toggle(t);
    const after = useStore.getState().tasks[t.id];
    if (!after) return;
    if (wasOpen && after.status === 'completed' && doneSec && !t.recurrence && t.sectionId !== doneSec.id) {
      actions.reorderTask(t.id, { projectId: project.id, sectionId: doneSec.id }, [...data.boardTasks(doneSec).map((x) => x.id), t.id]);
    } else if (!wasOpen && after.status === 'open' && t.sectionId && data.secs.find((s) => s.id === t.sectionId)?.isDone) {
      actions.reorderTask(t.id, { projectId: project.id, sectionId: null }, [...data.boardTasks(null).map((x) => x.id), t.id]);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const order = data.secs.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j] as string, order[i] as string];
    actions.reorderSections(project.id, order);
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 scroll-thin">
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
        <div className="flex items-stretch gap-3">
          {columns.map((c, ci) => (
            <BoardColumn
              key={c.id}
              id={c.id}
              title={c.title}
              tasks={c.tasks}
              done={!!c.section?.isDone}
              onToggle={onToggle}
              onAdd={c.section?.isDone ? undefined : () => actions.openQuickAdd({ projectId: project.id, sectionId: c.section?.id ?? null })}
              header={c.section ? <SectionHeader section={c.section} count={c.tasks.length} onMove={{ left: ci > 1 ? () => move(ci - 1, -1) : null, right: ci - 1 < data.secs.length - 1 ? () => move(ci - 1, 1) : null }} /> : undefined}
            />
          ))}
          <AddColumn projectId={project.id} hasColumns={data.secs.length > 0} />
        </div>
        <DragOverlay>{active ? <div className="rounded-lg border border-accent-text bg-surface shadow-xl"><TaskRow task={active} onToggle={() => undefined} /></div> : null}</DragOverlay>
      </DndContext>
      {dialog}
    </div>
  );
}
function ProjectEditor({ project, open, onClose }: { project: ProjectDTO; open: boolean; onClose: () => void }) {
  const tree = useProjectTree();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [outcome, setOutcome] = useState(project.outcome);
  const [color, setColor] = useState(project.color);
  const [favorite, setFavorite] = useState(project.favorite);
  const [parent, setParent] = useState(project.parentProjectId ?? '');
  const parents = flattenTree(tree).filter((n) => n.project.id !== project.id);
  const save = () => {
    if (!name.trim()) return;
    actions.updateProject(project.id, { name: name.trim(), description, outcome, color, favorite, parentProjectId: parent || null });
    onClose();
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Edit project">
      <SheetHeader title="Edit project" onClose={onClose} right={<Button size="sm" variant="primary" onClick={save} disabled={!name.trim()}>Save</Button>} />
      <div className="space-y-4 overflow-auto p-4">
        <Field label="Name" htmlFor="pname"><Input id="pname" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Outcome" hint="What does 'done' look like for this project?" htmlFor="pout"><Input id="pout" value={outcome} maxLength={1000} onChange={(e) => setOutcome(e.target.value)} /></Field>
        <Field label="Description" htmlFor="pdesc"><Textarea id="pdesc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Parent project" htmlFor="pparent">
          <Select id="pparent" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">None (top level)</option>
            {parents.map((n) => <option key={n.project.id} value={n.project.id}>{'\u00a0\u00a0'.repeat(n.depth)}{n.project.name}</option>)}
          </Select>
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium">Color</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Project color">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={clsx('h-8 w-8 rounded-full border-2', color === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between"><span className="text-sm">Favorite</span><Switch label="Favorite" checked={favorite} onChange={setFavorite} /></div>
      </div>
    </Sheet>
  );
}

function DeleteProject({ project, open, onClose, taskCount }: { project: ProjectDTO; open: boolean; onClose: () => void; taskCount: number }) {
  const nav = useNavigate();
  const online = useStore((s) => s.online);
  const [policy, setPolicy] = useState<'move_to_inbox' | 'archive' | 'delete'>('move_to_inbox');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const needTyped = policy === 'delete' && taskCount > 0;
  const ok = online && (!needTyped || typed === project.name);
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Delete project">
      <SheetHeader title="Delete project" onClose={onClose} />
      <div className="space-y-4 overflow-auto p-4">
        <p className="text-sm">"{project.name}" has <strong>{taskCount}</strong> open task{taskCount === 1 ? '' : 's'}. What should happen to them?</p>
        <div role="radiogroup" aria-label="What happens to the tasks" className="space-y-2">
          {([['move_to_inbox', 'Move them to the Inbox', 'Nothing is lost.'], ['archive', 'Archive them', 'Hidden from lists but kept.'], ['delete', 'Delete them too', 'They can be restored only from a backup.']] as const).map(([v, t, d]) => (
            <label key={v} className={clsx('flex cursor-pointer items-start gap-3 rounded-lg border p-3', policy === v ? 'border-accent-text' : 'border-line')}>
              <input type="radio" name="policy" checked={policy === v} onChange={() => setPolicy(v)} className="mt-1" />
              <span><span className="block text-sm font-medium">{t}</span><span className="text-xs text-muted">{d}</span></span>
            </label>
          ))}
        </div>
        {needTyped && <Field label={`Type "${project.name}" to confirm`} htmlFor="confirm-name"><Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>}
        {!online && <p className="text-sm text-warn">Deleting a project needs a connection.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!ok || busy} onClick={async () => {
            setBusy(true);
            try { await actions.deleteProject(project.id, policy); toast('Project deleted', 'success'); onClose(); nav('/browse'); }
            catch (e) { toast(errorMessage(e), 'error'); }
            finally { setBusy(false); }
          }}>Delete project</Button>
        </div>
      </div>
    </Sheet>
  );
}

export { Columns3, ListIcon };
