import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { formatDateLabel, type TaskDTO } from '@wos/shared';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, IconButton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useToday } from '../lib/hooks';
import { actions, useStore } from '../lib/store';

/** Tasks hidden with the "archive" swipe (or menu). They keep all their data and can be restored. */
export function ArchivedPage() {
  const today = useToday();
  const qc = useQueryClient();
  const projects = useStore((s) => s.projects);
  const q = useQuery<{ items: TaskDTO[] }>({ queryKey: ['archived-tasks'], queryFn: () => api('GET', '/tasks?status=archived&limit=200') });
  const items = q.data?.items.filter((t) => !t.parentTaskId) ?? [];
  const done = () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['archived-tasks'] }), 700);
  return (
    <>
      <PageHeader title="Archived" back="/browse" />
      {q.isLoading && <Spinner />}
      {q.isError && <EmptyState title="Archive needs a connection" body="Reconnect and try again." art={false} />}
      {!q.isLoading && !q.isError && !items.length && <EmptyState title="Nothing archived" body="Swipe a task left (or use the task menu) to archive it. Archived tasks disappear from every view but are kept here." art={false} />}
      <ul>
        {items.map((t) => (
          <li key={t.id} className="flex items-center gap-2 border-b border-line/70 py-2">
            <div className="min-w-0 flex-1">
              <p className="break-words text-[15px]">{t.title}</p>
              <p className="text-xs text-muted">
                {t.projectId ? (projects[t.projectId]?.name ?? 'Project') : 'Inbox'}
                {t.dueDate ? ` · ${formatDateLabel(t.dueDate, today)}` : ''}
              </p>
            </div>
            <IconButton label={`Restore ${t.title}`} onClick={() => { actions.unarchiveTask(t.id); done(); }}>
              <ArchiveRestore size={18} />
            </IconButton>
            <IconButton
              label={`Delete ${t.title}`}
              onClick={async () => {
                await api('DELETE', `/tasks/${t.id}`);
                void qc.invalidateQueries({ queryKey: ['archived-tasks'] });
              }}
            >
              <Trash2 size={18} />
            </IconButton>
          </li>
        ))}
      </ul>
    </>
  );
}
