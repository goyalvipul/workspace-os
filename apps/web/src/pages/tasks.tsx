import { ChevronDown, FolderOpen, ListTodo, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addDays, compareTasks, type TaskDTO } from '@wos/shared';
import { PageHeader } from '../components/PageHeader';
import { TaskList } from '../components/TaskRow';
import { Button, Input, Select, clsx } from '../components/ui';
import { useToday } from '../lib/hooks';
import { useAllTasks } from '../lib/selectors';
import { actions, useStore } from '../lib/store';

type Filter = 'all' | 'scheduled' | 'anytime';
type Grouping = 'schedule' | 'project';
type Sort = 'due' | 'priority' | 'name';
type TaskGroup = { id: string; label: string; tasks: TaskDTO[] };

const scheduleGroups = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
  { id: 'anytime', label: 'Anytime' },
];

/** All tasks: grouped, collapsible and fully backed by the existing task store. */
export function AllTasksPage() {
  const all = useAllTasks();
  const today = useToday();
  const projects = useStore((s) => s.projects);
  const grouping = useStore((s) => (s.prefs['display.allTasksGrouping'] as Grouping) || 'schedule');
  const sort = useStore((s) => (s.prefs['display.allTasksSort'] as Sort) || 'due');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const tasks = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return all.filter((t) => t.status === 'open' && !t.deletedAt)
      .filter((t) => filter === 'all' || (filter === 'scheduled' ? !!(t.dueDate || t.scheduledDate) : !(t.dueDate || t.scheduledDate)))
      .filter((t) => !term || t.title.toLocaleLowerCase().includes(term) || t.description.toLocaleLowerCase().includes(term))
      .sort(sort === 'name' ? (a, b) => a.title.localeCompare(b.title) : compareTasks(sort));
  }, [all, filter, search, sort]);

  const groups = useMemo<TaskGroup[]>(() => {
    const map = new Map<string, TaskDTO[]>();
    const push = (id: string, task: TaskDTO) => {
      const items = map.get(id);
      if (items) items.push(task);
      else map.set(id, [task]);
    };
    if (grouping === 'project') {
      for (const t of tasks) push(t.projectId ?? 'inbox', t);
      return [...map.entries()].map(([id, items]) => ({ id, label: id === 'inbox' ? 'Inbox / no project' : projects[id]?.name ?? 'Unknown project', tasks: items }))
        .sort((a, b) => (a.id === 'inbox' ? -1 : b.id === 'inbox' ? 1 : a.label.localeCompare(b.label)));
    }
    const endOfWeek = addDays(today, 7);
    for (const t of tasks) {
      const date = t.dueDate ?? t.scheduledDate;
      const id = !date ? 'anytime' : date < today ? 'overdue' : date === today ? 'today' : date <= endOfWeek ? 'week' : 'later';
      push(id, t);
    }
    return scheduleGroups.map(({ id, label }) => ({ id, label, tasks: map.get(id) ?? [] })).filter((g) => g.tasks.length > 0);
  }, [tasks, today, grouping, projects]);

  const toggle = (id: string) => setCollapsed((before) => before.includes(id) ? before.filter((key) => key !== id) : [...before, id]);

  return (
    <div className="wos-tasks space-y-4">
      <PageHeader title="Tasks" subtitle="Everything you need to do, together." right={<Button variant="primary" size="sm" onClick={() => actions.openQuickAdd()}><Plus size={16} aria-hidden /> Add</Button>} />
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label="Filter tasks by name" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a task..." className="wos-search-input pl-11" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Task schedule filter" className="flex flex-wrap gap-2">
          {([['all', 'All tasks'], ['scheduled', 'Scheduled'], ['anytime', 'Anytime']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} className={clsx('wos-filter-pill', filter === value && 'wos-filter-active')} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <span className="text-sm text-muted" role="status">{tasks.length} open</span>
      </div>
      <div className="wos-task-toolbar flex flex-wrap items-center gap-3 rounded-2xl p-3">
        <SlidersHorizontal size={17} className="text-muted" aria-hidden />
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted">Group</span>
          <Select aria-label="Group tasks by" value={grouping} onChange={(e) => void actions.setPref('display.allTasksGrouping', e.target.value)} className="min-h-9 w-32">
            <option value="schedule">Schedule</option><option value="project">Project</option>
          </Select>
        </label>
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-muted">Sort</span>
          <Select aria-label="Sort all tasks by" value={sort} onChange={(e) => void actions.setPref('display.allTasksSort', e.target.value)} className="min-h-9 w-28">
            <option value="due">Due date</option><option value="priority">Priority</option><option value="name">Name</option>
          </Select>
        </label>
        <button type="button" className="ml-auto min-h-9 text-xs font-semibold text-accent-text" onClick={() => setCollapsed(collapsed.length ? [] : groups.map((g) => g.id))}>
          {collapsed.length ? 'Expand all' : 'Collapse all'}
        </button>
      </div>

      {groups.length ? groups.map((group) => {
        const hidden = collapsed.includes(group.id);
        return (
          <section key={group.id} className="wos-group wos-panel overflow-hidden" aria-label={group.label}>
            <button type="button" aria-expanded={!hidden} onClick={() => toggle(group.id)} className="wos-group-heading flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
              <span className="wos-group-symbol"><FolderOpen size={18} aria-hidden /></span>
              <span className="min-w-0 flex-1 truncate text-base font-bold">{group.label}</span>
              <span className="rounded-full bg-surface2 px-2.5 py-1 text-xs font-semibold text-muted">{group.tasks.length}</span>
              <ChevronDown size={18} className={clsx('text-muted transition-transform', hidden && '-rotate-90')} aria-hidden />
            </button>
            {!hidden && <div className="px-3 pb-3"><TaskList tasks={group.tasks} showProject showDate /></div>}
          </section>
        );
      }) : (
        <div className="wos-panel flex flex-col items-center px-5 py-10 text-center">
          <span className="wos-empty-icon"><ListTodo size={26} aria-hidden /></span>
          <p className="mt-3 font-semibold">{search ? 'No matching tasks' : 'No tasks in this view'}</p>
          <p className="mt-1 text-sm text-muted">{search ? 'Try another search.' : 'You can create one right here.'}</p>
          <button type="button" className="wos-soft-button mt-4" onClick={() => actions.openQuickAdd()}><Plus size={16} aria-hidden /> Add a task</button>
        </div>
      )}
    </div>
  );
}
