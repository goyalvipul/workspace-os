import { useMemo } from 'react';
import { localDateOf, selectInbox, selectToday, type ProjectDTO, type TaskDTO } from '@wos/shared';
import { useStore } from './store';
import { useToday, useTz } from './hooks';

export function useAllTasks(): TaskDTO[] {
  const tasks = useStore((s) => s.tasks);
  return useMemo(() => Object.values(tasks), [tasks]);
}

export function useInboxTasks(): TaskDTO[] {
  const all = useAllTasks();
  return useMemo(() => selectInbox(all), [all]);
}

export function useTodayView() {
  const all = useAllTasks();
  const today = useToday();
  const tz = useTz();
  return useMemo(() => selectToday(all, today, tz, localDateOf), [all, today, tz]);
}

export interface ProjectNode {
  project: ProjectDTO;
  children: ProjectNode[];
  depth: number;
}

export function useProjectTree(includeArchived = false): ProjectNode[] {
  const projects = useStore((s) => s.projects);
  return useMemo(() => {
    const list = Object.values(projects)
      .filter((p) => includeArchived || !p.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const ids = new Set(list.map((p) => p.id));
    const build = (parent: string | null, depth: number): ProjectNode[] =>
      list.filter((p) => (parent ? p.parentProjectId === parent : !p.parentProjectId || !ids.has(p.parentProjectId))).map((p) => ({ project: p, depth, children: depth < 4 ? build(p.id, depth + 1) : [] }));
    return build(null, 0);
  }, [projects, includeArchived]);
}

export function flattenTree(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

export function openCount(tasks: TaskDTO[], projectId: string): number {
  let n = 0;
  for (const t of tasks) if (t.projectId === projectId && t.status === 'open' && !t.parentTaskId) n++;
  return n;
}
