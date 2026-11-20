import { ListTodo, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { compareTasks } from '@wos/shared';
import { PageHeader } from '../components/PageHeader';
import { TaskList } from '../components/TaskRow';
import { Button, Input, clsx } from '../components/ui';
import { useAllTasks } from '../lib/selectors';
import { actions } from '../lib/store';

type Filter = 'all' | 'scheduled' | 'anytime';

/** A consolidated view; Inbox, Today, projects, recurring tasks and subtasks still work as before. */
export function AllTasksPage() {
  const all = useAllTasks();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const tasks = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return all
      .filter((t) => t.status === 'open' && !t.deletedAt)
      .filter((t) => filter === 'all' || (filter === 'scheduled' ? !!(t.dueDate || t.scheduledDate) : !(t.dueDate || t.scheduledDate)))
      .filter((t) => !term || t.title.toLocaleLowerCase().includes(term) || t.description.toLocaleLowerCase().includes(term))
      .sort(compareTasks('due'));
  }, [all, filter, search]);

  return (
    <div className="wos-tasks">
      <PageHeader title="Tasks" subtitle="Everything you need to do, together." right={<Button variant="primary" size="sm" onClick={() => actions.openQuickAdd()}><Plus size={16} aria-hidden /> Add</Button>} />
      <div className="relative mb-4">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label="Filter tasks by name" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a task..." className="wos-search-input pl-11" />
      </div>
      <div role="group" aria-label="Task schedule filter" className="mb-5 flex flex-wrap gap-2">
        {([['all', 'All tasks'], ['scheduled', 'Scheduled'], ['anytime', 'Anytime']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={filter === value} className={clsx('wos-filter-pill', filter === value && 'wos-filter-active')} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="wos-section-label wos-section-yellow">Your tasks</h2>
        <span className="text-sm text-muted">{tasks.length} open</span>
      </div>
      <div className="wos-panel p-3">
        {tasks.length ? <TaskList tasks={tasks} showProject showDate /> : (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <span className="wos-empty-icon"><ListTodo size={26} aria-hidden /></span>
            <p className="mt-3 font-semibold">{search ? 'No matching tasks' : 'No tasks in this view'}</p>
            <p className="mt-1 text-sm text-muted">{search ? 'Try searching for a different name.' : 'You can create one right here.'}</p>
            <button type="button" className="wos-soft-button mt-4" onClick={() => actions.openQuickAdd()}><Plus size={16} aria-hidden /> Add a task</button>
          </div>
        )}
      </div>
    </div>
  );
}
