import { useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { Archive, Copy, Flag, MoreHorizontal, Plus, Send, Trash2, X, Clock, Target, CalendarClock } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';
import { buildDue, formatDateLabel, localTimeOf, sortByPosition, type CommentDTO, type TaskDTO } from '@wos/shared';
import { api, errorMessage } from '../lib/api';
import { CREATOROS_KEY, useCreatoros } from '../lib/creatoros';
import { actions, toast, useStore } from '../lib/store';
import { useToday, useTz } from '../lib/hooks';
import { DatePicker, LabelPicker, PriorityPicker, ProjectPicker, RecurrencePicker, ReminderEditor } from './pickers';
import { TaskCheckbox, TaskList, useToggleTask } from './TaskRow';
import { Button, Chip, Confirm, IconButton, Input, MenuContent, MenuItem, MenuRoot, MenuSep, MenuTrigger, Sheet, Textarea, clsx } from './ui';

let hooked = false;
function renderMarkdown(md: string): string {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  const html = marked.parse(md, { async: false, breaks: true, gfm: true }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

export function TaskSheet() {
  const id = useStore((s) => s.openTaskId);
  const exists = useStore((s) => (id ? !!s.tasks[id] : false));
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && actions.openTask(null)} title="Task details" side wide={false}>
      {id && exists ? <TaskDetail key={id} id={id} /> : id ? <div className="p-6 text-sm text-muted">This task is no longer available.</div> : null}
    </Sheet>
  );
}

function TaskDetail({ id }: { id: string }) {
  const task = useStore((s) => s.tasks[id]) as TaskDTO;
  const all = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const online = useStore((s) => s.online);
  const tz = useTz();
  const today = useToday();
  const { toggle, dialog } = useToggleTask();
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description);
  const [editDesc, setEditDesc] = useState(false);
  const [subTitle, setSubTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => {
    if (!editDesc) setDesc(task.description);
  }, [task.description, editDesc]);

  const subtasks = useMemo(() => sortByPosition(Object.values(all).filter((t) => t.parentTaskId === id)), [all, id]);
  const parent = task.parentTaskId ? all[task.parentTaskId] : null;
  const project = task.projectId ? projects[task.projectId] : null;
  const dueTime = task.dueAtUtc ? localTimeOf(task.dueAtUtc, task.dueTimezone ?? tz) : null;
  const html = useMemo(() => (task.description ? renderMarkdown(task.description) : ''), [task.description]);

  const qc = useQueryClient();
  const co = useCreatoros();
  const link = co.byTask.get(id);
  const setPublished = async (on: boolean) => {
    if (!online) return toast('Publishing needs a connection. Try again when you are online.', 'error');
    try {
      await api('POST', `/integrations/creatoros/${on ? 'publish' : 'unpublish'}`, { taskIds: [id] });
      void qc.invalidateQueries({ queryKey: CREATOROS_KEY });
      toast(on ? 'Publishing to CreatorOS' : 'Stopped publishing to CreatorOS', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(task.title);
    if (t !== task.title) actions.updateTask(id, { title: t });
  };
  const setDue = (v: { date: string | null; time: string | null }) => {
    if (!v.date) return actions.updateTask(id, { dueDate: null, dueAtUtc: null, dueTimezone: null, recurrence: null });
    const d = buildDue({ date: v.date, time: v.time, timezone: tz });
    actions.updateTask(id, { dueDate: d.dueDate, dueAtUtc: d.dueAtUtc, dueTimezone: d.dueTimezone });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-sm text-muted">
          {parent ? (
            <button className="hover:text-fg" onClick={() => actions.openTask(parent.id)}>
              {parent.title} /
            </button>
          ) : null}{' '}
          {project ? project.name : 'Inbox'}
          {link && (
            <span className="ml-2 rounded bg-surface2 px-1.5 py-0.5 text-xs" title="Published to CreatorOS">
              CreatorOS: {link.state === 'synced' ? 'up to date' : link.state === 'pending' ? 'sending' : 'failed'}
            </span>
          )}
        </div>
        <MenuRoot>
          <MenuTrigger asChild>
            <IconButton label="More actions">
              <MoreHorizontal size={20} />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuItem
              icon={<Copy size={16} />}
              onSelect={() => {
                actions.createTask({ title: `${task.title} (copy)`, description: task.description, priority: task.priority, projectId: task.projectId, sectionId: task.sectionId, labelIds: task.labelIds, dueDate: task.dueDate, dueAtUtc: task.dueAtUtc, dueTimezone: task.dueTimezone, recurrence: task.recurrence ? { rule: task.recurrence.rule, mode: task.recurrence.mode } : null });
                toast('Task duplicated', 'success');
              }}
            >
              Duplicate
            </MenuItem>
            {co.status?.enabled && (
              <MenuItem icon={<Send size={16} />} onSelect={() => void setPublished(!link)}>
                {link ? 'Stop publishing to CreatorOS' : 'Publish to CreatorOS'}
              </MenuItem>
            )}
            <MenuItem
              icon={<Archive size={16} />}
              onSelect={() => {
                actions.openTask(null);
                actions.archiveTask(id);
              }}
            >
              Archive
            </MenuItem>
            <MenuSep />
            <MenuItem danger icon={<Trash2 size={16} />} onSelect={() => setConfirmDelete(true)}>
              Delete
            </MenuItem>
          </MenuContent>
        </MenuRoot>
        <IconButton label="Close" onClick={() => actions.openTask(null)}>
          <X size={20} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4 scroll-thin">
        <div className="flex items-start gap-1">
          <TaskCheckbox task={task} onToggle={() => toggle(task)} />
          <Textarea
            aria-label="Task title"
            rows={1}
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className={clsx('min-h-11 resize-none border-transparent bg-transparent text-lg font-semibold', task.status === 'completed' && 'text-muted line-through')}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <DatePicker value={{ date: task.dueDate, time: dueTime }} onChange={setDue} label="Due date" />
          <PriorityPicker value={task.priority} onChange={(p) => actions.updateTask(id, { priority: p })} />
          <ProjectPicker projectId={task.projectId} sectionId={task.sectionId} onChange={(p, s) => actions.updateTask(id, { projectId: p, sectionId: s })} />
          <LabelPicker value={task.labelIds} onChange={(ids) => actions.updateTask(id, { labelIds: ids })} />
          <RecurrencePicker
            value={task.recurrence ? { rule: task.recurrence.rule, mode: task.recurrence.mode } : null}
            onChange={(v) => {
              if (v && !task.dueDate) {
                const d = buildDue({ date: today, time: null, timezone: tz });
                actions.updateTask(id, { dueDate: d.dueDate, dueAtUtc: d.dueAtUtc, dueTimezone: d.dueTimezone, recurrence: v });
              } else actions.updateTask(id, { recurrence: v });
            }}
          />
        </div>

        <section aria-label="Planning" className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-lg bg-surface p-2.5">
            <CalendarClock size={16} className="text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">Planned (scheduled) date</p>
              <p className="truncate text-sm">{task.scheduledDate ? formatDateLabel(task.scheduledDate, today) : 'Not planned'}</p>
            </div>
            <DatePicker
              allowTime={false}
              label="Plan"
              value={{ date: task.scheduledDate, time: null }}
              onChange={(v) => actions.updateTask(id, { scheduledDate: v.date, scheduledAtUtc: null })}
              trigger={
                <Button size="sm" variant="ghost">
                  {task.scheduledDate ? 'Change' : 'Set'}
                </Button>
              }
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface p-2.5">
            <Target size={16} className="text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">Hard deadline</p>
              <p className="truncate text-sm">{task.deadlineDate ? formatDateLabel(task.deadlineDate, today) : 'No deadline'}</p>
            </div>
            <DatePicker
              allowTime={false}
              label="Deadline"
              value={{ date: task.deadlineDate, time: null }}
              onChange={(v) => actions.updateTask(id, { deadlineDate: v.date })}
              trigger={
                <Button size="sm" variant="ghost">
                  {task.deadlineDate ? 'Change' : 'Set'}
                </Button>
              }
            />
          </div>
        </section>

        <section aria-label="Description">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Description</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (editDesc && desc !== task.description) actions.updateTask(id, { description: desc });
                setEditDesc(!editDesc);
              }}
            >
              {editDesc ? 'Done' : 'Edit'}
            </Button>
          </div>
          {editDesc ? (
            <Textarea aria-label="Description" rows={6} value={desc} maxLength={20000} onChange={(e) => setDesc(e.target.value)} placeholder="Markdown: **bold**, - lists, [links](https://...)" />
          ) : html ? (
            <div className="prose-md rounded-lg bg-surface p-3 text-sm" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <button className="w-full rounded-lg bg-surface p-3 text-left text-sm text-muted" onClick={() => setEditDesc(true)}>
              Add a description...
            </button>
          )}
        </section>

        <section aria-label="Reminders">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Clock size={14} aria-hidden /> Reminders
          </h3>
          <ReminderEditor
            hasTime={!!task.dueAtUtc}
            value={task.reminders.map((r) => ({ id: r.id, kind: r.kind, offsetMinutes: r.offsetMinutes, atUtc: r.atUtc, channel: r.channel, enabled: r.enabled }))}
            onChange={(r) => actions.updateTask(id, { reminders: r })}
          />
        </section>

        <section aria-label="Subtasks">
          <h3 className="mb-1 text-sm font-semibold">
            Subtasks {subtasks.length > 0 && <span className="font-normal text-muted">({subtasks.filter((s) => s.status === 'completed').length}/{subtasks.length})</span>}
          </h3>
          <TaskList tasks={subtasks} showDate nested sortable={{ projectId: task.projectId, sectionId: task.sectionId, parentTaskId: id }} />
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!subTitle.trim()) return;
              actions.createTask({ title: subTitle, parentTaskId: id });
              setSubTitle('');
            }}
          >
            <Input aria-label="Add subtask" placeholder="Add subtask" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
            <Button type="submit" disabled={!subTitle.trim()}>
              <Plus size={16} aria-hidden /> Add
            </Button>
          </form>
        </section>

        <Comments taskId={id} online={online} />
        {task.recurrence && <CompletionHistory taskId={id} />}

        <p className="pb-2 text-xs text-muted">
          Created {new Date(task.createdAt).toLocaleString()} &middot; Updated {new Date(task.updatedAt).toLocaleString()}
          {task.status === 'completed' && task.completedAt ? ` · Completed ${new Date(task.completedAt).toLocaleString()}` : ''}
        </p>
      </div>
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        danger
        confirmLabel="Delete"
        body={subtasks.length ? `This also deletes its ${subtasks.length} subtask(s). You can undo right after.` : 'You can undo right after.'}
        onConfirm={() => {
          actions.openTask(null);
          actions.deleteTask(id);
        }}
      />
      {dialog}
    </div>
  );
}

function Comments({ taskId, online }: { taskId: string; online: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const q = useQuery<{ items: CommentDTO[] }>({ queryKey: ['comments', taskId], queryFn: () => api('GET', `/tasks/${taskId}/comments`), enabled: online });
  const add = async () => {
    if (!body.trim()) return;
    try {
      await api('POST', `/tasks/${taskId}/comments`, { body });
      setBody('');
      void qc.invalidateQueries({ queryKey: ['comments', taskId] });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <section aria-label="Comments">
      <h3 className="mb-1 text-sm font-semibold">Comments</h3>
      {!online && <p className="text-sm text-muted">Comments need a connection.</p>}
      <ul className="space-y-2">
        {(q.data?.items ?? []).map((c) => (
          <li key={c.id} className="rounded-lg bg-surface p-2.5 text-sm">
            <p className="whitespace-pre-wrap break-words">{c.body}</p>
            <div className="mt-1 flex items-center justify-between text-xs text-muted">
              <span>{new Date(c.createdAt).toLocaleString()}</span>
              <button
                className="hover:text-danger"
                onClick={async () => {
                  try {
                    await api('DELETE', `/tasks/${taskId}/comments/${c.id}`);
                    void qc.invalidateQueries({ queryKey: ['comments', taskId] });
                  } catch (e) {
                    toast(errorMessage(e), 'error');
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Textarea aria-label="Add a comment" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" disabled={!online} />
        <Button onClick={add} disabled={!online || !body.trim()}>
          Post
        </Button>
      </div>
    </section>
  );
}

function CompletionHistory({ taskId }: { taskId: string }) {
  const online = useStore((s) => s.online);
  const q = useQuery<{ items: { id: string; occurrenceKey: string; completedAt: string; undoneAt: string | null }[] }>({ queryKey: ['completions', taskId], queryFn: () => api('GET', `/tasks/${taskId}/completions`), enabled: online });
  const items = (q.data?.items ?? []).filter((i) => !i.undoneAt).slice(0, 10);
  if (!items.length) return null;
  return (
    <section aria-label="Completion history">
      <h3 className="mb-1 text-sm font-semibold">Completion history</h3>
      <ul className="space-y-1 text-sm text-muted">
        {items.map((i) => (
          <li key={i.id}>
            {i.occurrenceKey} &middot; done {new Date(i.completedAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </section>
  );
}

export { Flag, Chip };
