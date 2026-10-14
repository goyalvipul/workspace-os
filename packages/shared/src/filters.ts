import { addDays } from './dates.js';
import type { FilterNode, TaskDTO } from './schemas.js';

// Filter AST evaluator. Filters are JSON data, never SQL; evaluated in JS on both client and server.

export interface FilterContext {
  today: string;
  /** project id -> ids of itself and all descendants */
  projectDescendants?: (projectId: string) => string[];
  labelNameToId?: (name: string) => string | undefined;
}

function resolveDate(v: unknown, today: string): string | null {
  if (typeof v === 'string') {
    if (v === 'today') return today;
    if (v === 'tomorrow') return addDays(today, 1);
    if (v === 'yesterday') return addDays(today, -1);
    const rel = /^([+-])(\d{1,4})d$/.exec(v);
    if (rel) return addDays(today, (rel[1] === '-' ? -1 : 1) * Number(rel[2]));
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  }
  return null;
}

function cmpDate(actual: string | null, cmp: string, value: unknown, today: string): boolean {
  if (cmp === 'exists') return (actual !== null) === (value !== false);
  if (actual === null) return false;
  if (cmp === 'between') {
    const arr = Array.isArray(value) ? value : [];
    const a = resolveDate(arr[0], today);
    const b = resolveDate(arr[1], today);
    return a !== null && b !== null && actual >= a && actual <= b;
  }
  const target = resolveDate(value, today);
  if (target === null) return false;
  switch (cmp) {
    case 'is': return actual === target;
    case 'isNot': return actual !== target;
    case 'lt': return actual < target;
    case 'lte': return actual <= target;
    case 'gt': return actual > target;
    case 'gte': return actual >= target;
    default: return false;
  }
}

export function isOverdue(t: Pick<TaskDTO, 'status' | 'dueDate' | 'scheduledDate'>, today: string): boolean {
  if (t.status !== 'open') return false;
  if (t.dueDate) return t.dueDate < today;
  return !!t.scheduledDate && t.scheduledDate < today;
}

export function evalFilter(node: FilterNode, task: TaskDTO, ctx: FilterContext): boolean {
  if ('op' in node) {
    if (node.op === 'and') return node.children.every((c) => evalFilter(c, task, ctx));
    if (node.op === 'or') return node.children.some((c) => evalFilter(c, task, ctx));
    return !evalFilter(node.child, task, ctx);
  }
  const { field, cmp, value } = node;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
  switch (field) {
    case 'project': {
      const ids = list(value).flatMap((id) => (ctx.projectDescendants ? ctx.projectDescendants(id) : [id]));
      const hit = task.projectId ? ids.includes(task.projectId) : list(value).includes('inbox');
      return cmp === 'isNot' ? !hit : hit;
    }
    case 'priority': {
      const n = Number(Array.isArray(value) ? value[0] : value);
      if (cmp === 'in') return list(value).map(Number).includes(task.priority);
      if (cmp === 'lt') return task.priority < n;
      if (cmp === 'lte') return task.priority <= n;
      if (cmp === 'gt') return task.priority > n;
      if (cmp === 'gte') return task.priority >= n;
      if (cmp === 'isNot') return task.priority !== n;
      return task.priority === n;
    }
    case 'label': {
      if (cmp === 'exists') return (task.labelIds.length > 0) === (value !== false);
      const ids = list(value).map((v) => ctx.labelNameToId?.(v) ?? v);
      const hit = ids.some((id) => task.labelIds.includes(id));
      return cmp === 'isNot' ? !hit : hit;
    }
    case 'status': {
      const hit = list(value).includes(task.status);
      return cmp === 'isNot' ? !hit : hit;
    }
    case 'due': return cmpDate(task.dueDate, cmp, value, ctx.today);
    case 'scheduled': return cmpDate(task.scheduledDate, cmp, value, ctx.today);
    case 'deadline': return cmpDate(task.deadlineDate, cmp, value, ctx.today);
    case 'text': {
      const q = String(value ?? '').toLowerCase();
      if (!q) return true;
      const hit = task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q);
      return cmp === 'isNot' ? !hit : hit;
    }
    case 'overdue': return isOverdue(task, ctx.today) === (value !== false);
    case 'plannedToday': return (task.scheduledDate === ctx.today) === (value !== false);
    case 'noDate': return (!task.dueDate && !task.scheduledDate) === (value !== false);
    case 'hasRecurrence': return (task.recurrence !== null) === (value !== false);
    default: return false;
  }
}

export function describeFilter(node: FilterNode): string {
  if ('op' in node) {
    if (node.op === 'not') return `NOT (${describeFilter(node.child)})`;
    return node.children.map((c) => ('op' in c && c.op !== 'not' ? `(${describeFilter(c)})` : describeFilter(c))).join(node.op === 'and' ? ' AND ' : ' OR ');
  }
  const v = node.value === undefined ? '' : ` ${JSON.stringify(node.value)}`;
  return `${node.field} ${node.cmp}${v}`;
}
