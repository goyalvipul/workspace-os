import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CalendarDays, ChevronRight, Filter, Hash, Inbox, LayoutTemplate, Pencil, Plus, Search as SearchIcon, Settings, Star, Tag, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { COLORS, compareTasks, descendantsOf, evalFilter, type FilterNode, type SavedFilterDTO, type TaskDTO, type TemplateBody, type TemplateDTO } from '@wos/shared';
import { PageHeader } from '../components/PageHeader';
import { TaskList } from '../components/TaskRow';
import { Button, Chip, Confirm, EmptyState, Field, IconButton, Input, Segmented, Select, Sheet, SheetHeader, Switch, Textarea, clsx } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useDebounced, useToday } from '../lib/hooks';
import { flattenTree, useAllTasks, useProjectTree } from '../lib/selectors';
import { actions, refresh, toast, useStore } from '../lib/store';

// ---------------------------------------------------------------- Search
export function SearchPage() {
  const [q, setQ] = useState('');
  const [done, setDone] = useState(false);
  const dq = useDebounced(q.trim(), 200);
  const all = useAllTasks();
  const projects = useStore((s) => s.projects);
  const labels = useStore((s) => s.labels);
  const online = useStore((s) => s.online);
  const server = useQuery<{ tasks: TaskDTO[] }>({ queryKey: ['search', dq, done], enabled: online && dq.length > 0, queryFn: () => api('GET', `/search?q=${encodeURIComponent(dq)}${done ? '&includeCompleted=true' : ''}`), staleTime: 10_000 });
  const results = useMemo(() => {
    if (!dq) return [];
    const needle = dq.toLowerCase();
    const local = all.filter((t) => (done || t.status === 'open') && t.status !== 'archived' && (t.title.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle)));
    const ids = new Set(local.map((t) => t.id));
    const extra = (server.data?.tasks ?? []).filter((t) => !ids.has(t.id)).map((t) => all.find((x) => x.id === t.id) ?? t);
    return [...local, ...extra].sort(compareTasks('priority')).slice(0, 100);
  }, [dq, all, done, server.data]);
  const projHits = Object.values(projects).filter((p) => dq && p.name.toLowerCase().includes(dq.toLowerCase()) && !p.archivedAt).slice(0, 6);
  const labelHits = Object.values(labels).filter((l) => dq && l.name.toLowerCase().includes(dq.toLowerCase())).slice(0, 6);
  return (
    <>
      <PageHeader title="Search" />
      <div className="relative">
        <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <Input autoFocus type="search" aria-label="Search tasks, projects and labels" placeholder="Search tasks, projects, labels" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-12 pl-10" />
      </div>
      <div className="my-3 flex items-center justify-between text-sm">
        <span className="text-muted">{dq ? `${results.length} task${results.length === 1 ? '' : 's'}` : 'Type to search'}{!online && ' (offline: searching this device)'}</span>
        <label className="flex items-center gap-2">Include completed <Switch label="Include completed" checked={done} onChange={setDone} /></label>
      </div>
      {projHits.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{projHits.map((p) => <Link key={p.id} to={`/project/${p.id}`}><Chip color={p.color}>{p.name}</Chip></Link>)}</div>}
      {labelHits.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{labelHits.map((l) => <Link key={l.id} to={`/label/${l.id}`}><Chip color={l.color}>@{l.name}</Chip></Link>)}</div>}
      {dq && !results.length && !server.isFetching && <EmptyState title="No matches" body="Try fewer words or include completed tasks." art={false} />}
      <TaskList tasks={results} showProject />
    </>
  );
}

// ---------------------------------------------------------------- Browse
export function BrowsePage() {
  const tree = useProjectTree();
  const archived = useProjectTree(true).flatMap((n) => flattenTree([n])).filter((n) => n.project.archivedAt);
  const all = useAllTasks();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const inbox = all.filter((t) => t.status === 'open' && !t.projectId && !t.parentTaskId).length;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of all) if (t.projectId && t.status === 'open' && !t.parentTaskId) m.set(t.projectId, (m.get(t.projectId) ?? 0) + 1);
    return m;
  }, [all]);
  const row = 'flex min-h-12 items-center gap-3 rounded-lg px-3 hover:bg-surface2';
  return (
    <>
      <PageHeader title="Browse" right={<Link to="/settings" aria-label="Settings" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface2"><Settings size={20} /></Link>} />
      <nav aria-label="Browse" className="space-y-0.5">
        <Link to="/search" className={row}><SearchIcon size={20} aria-hidden /> Search</Link>
        <Link to="/inbox" className={row}><Inbox size={20} aria-hidden /> Inbox <span className="ml-auto text-sm text-muted">{inbox || ''}</span></Link>
        <Link to="/calendar" className={row}><CalendarDays size={20} aria-hidden /> Calendar</Link>
        <Link to="/labels" className={row}><Filter size={20} aria-hidden /> Filters &amp; Labels</Link>
        <Link to="/templates" className={row}><LayoutTemplate size={20} aria-hidden /> Templates</Link>
        <Link to="/activity" className={row}><Activity size={20} aria-hidden /> Activity &amp; reporting</Link>
      </nav>
      <div className="mb-1 mt-5 flex items-center justify-between px-3">
        <h2 className="text-sm font-semibold">Projects</h2>
        <IconButton label="Add project" onClick={() => setAdding(true)}><Plus size={20} /></IconButton>
      </div>
      {adding && (
        <form className="mb-2 flex gap-2 px-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { const p = actions.createProject({ name }); nav(`/project/${p.id}`); } }}>
          <Input autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!name.trim()}>Add</Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </form>
      )}
      <ul className="space-y-0.5">
        {flattenTree(tree).map((n) => (
          <li key={n.project.id}>
            <Link to={`/project/${n.project.id}`} className={row} style={{ paddingLeft: 12 + n.depth * 18 }}>
              <Hash size={18} style={{ color: n.project.color }} aria-hidden /> <span className="truncate">{n.project.name}</span>
              {n.project.favorite && <Star size={12} className="text-warn" fill="currentColor" aria-label="Favorite" />}
              <span className="ml-auto text-sm text-muted">{counts.get(n.project.id) || ''}</span>
              <ChevronRight size={16} className="text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {!tree.length && <p className="px-3 py-4 text-sm text-muted">No projects yet. Add one with the + above, or start from a template.</p>}
      {archived.length > 0 && (
        <details className="mt-4 px-3">
          <summary className="cursor-pointer text-sm text-muted">Archived projects ({archived.length})</summary>
          <ul className="mt-1">{archived.map((n) => <li key={n.project.id}><Link to={`/project/${n.project.id}`} className="flex min-h-10 items-center gap-2 text-sm text-muted"><Hash size={16} style={{ color: n.project.color }} /> {n.project.name}</Link></li>)}</ul>
        </details>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Labels + saved filters
export function LabelsPage() {
  const labelMap = useStore((s) => s.labels);
  const labels = useMemo(() => Object.values(labelMap).sort((a, b) => a.name.localeCompare(b.name)), [labelMap]);
  const filterMap = useStore((s) => s.filters);
  const filters = useMemo(() => Object.values(filterMap), [filterMap]);
  const all = useAllTasks();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[5] as string);
  const [edit, setEdit] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [delLabel, setDelLabel] = useState<string | null>(null);
  const [editor, setEditor] = useState<SavedFilterDTO | 'new' | null>(null);
  const [delFilter, setDelFilter] = useState<SavedFilterDTO | null>(null);
  const valid = /^[^\s@#]+(?: [^\s@#]+)*$/.test(name.trim());
  return (
    <>
      <PageHeader title="Filters & Labels" back="/browse" />
      <section aria-label="Labels">
        <h2 className="mb-1 text-sm font-semibold">Labels</h2>
        <form className="mb-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) { actions.createLabel(name.trim(), color); setName(''); } }}>
          <Input aria-label="New label name" placeholder="New label (no @ or #)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <div className="flex gap-1" role="radiogroup" aria-label="Label color">{COLORS.slice(0, 8).map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={clsx('h-6 w-6 rounded-full border-2', color === c ? 'border-fg' : 'border-transparent')} style={{ background: c }} />)}</div>
          <Button type="submit" variant="primary" disabled={!valid}>Add label</Button>
        </form>
        <ul>
          {labels.map((l) => {
            const n = all.filter((t) => t.status === 'open' && t.labelIds.includes(l.id)).length;
            return (
              <li key={l.id} className="flex min-h-12 items-center gap-3 border-b border-line/60 px-1">
                <Tag size={18} style={{ color: l.color }} aria-hidden />
                {edit === l.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (editName.trim()) actions.updateLabel(l.id, { name: editName.trim() }); setEdit(null); }}>
                    <Input autoFocus aria-label="Label name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    <Button type="submit" size="sm" variant="primary">Save</Button>
                  </form>
                ) : (
                  <Link to={`/label/${l.id}`} className="flex-1 truncate">@{l.name} <span className="text-xs text-muted">{n || ''}</span></Link>
                )}
                <div className="flex gap-0.5" role="group" aria-label={`Colors for ${l.name}`}>{COLORS.slice(0, 5).map((c) => <button key={c} type="button" aria-label={`Set ${l.name} color ${c}`} onClick={() => actions.updateLabel(l.id, { color: c })} className="hidden h-4 w-4 rounded-full sm:block" style={{ background: c }} />)}</div>
                <IconButton label={`Rename ${l.name}`} onClick={() => { setEdit(l.id); setEditName(l.name); }}><Pencil size={16} /></IconButton>
                <IconButton label={`Delete ${l.name}`} onClick={() => setDelLabel(l.id)}><Trash2 size={16} /></IconButton>
              </li>
            );
          })}
          {!labels.length && <li className="py-3 text-sm text-muted">No labels yet.</li>}
        </ul>
      </section>
      <section aria-label="Saved filters" className="mt-8">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Saved filters</h2>
          <Button size="sm" onClick={() => setEditor('new')}><Plus size={14} aria-hidden /> New filter</Button>
        </div>
        <ul>
          {filters.map((f) => (
            <li key={f.id} className="flex min-h-12 items-center gap-3 border-b border-line/60 px-1">
              <Filter size={18} className="text-accent-text" aria-hidden />
              <Link to={`/filter/${f.id}`} className="flex-1 truncate">{f.name}</Link>
              <IconButton label={`Edit ${f.name}`} onClick={() => setEditor(f)}><Pencil size={16} /></IconButton>
              <IconButton label={`Delete ${f.name}`} onClick={() => setDelFilter(f)}><Trash2 size={16} /></IconButton>
            </li>
          ))}
          {!filters.length && <li className="py-3 text-sm text-muted">No saved filters yet. Try &ldquo;Priority 1 due this week&rdquo;.</li>}
        </ul>
      </section>
      <Confirm open={!!delLabel} onOpenChange={(o) => !o && setDelLabel(null)} danger title="Delete this label?" body="It is removed from every task that uses it." confirmLabel="Delete label" onConfirm={() => delLabel && actions.deleteLabel(delLabel)} />
      <Confirm open={!!delFilter} onOpenChange={(o) => !o && setDelFilter(null)} danger title={`Delete "${delFilter?.name}"?`} body="Tasks are not affected." confirmLabel="Delete filter" onConfirm={async () => { if (!delFilter) return; try { await api('DELETE', `/saved-filters/${delFilter.id}`); await refresh(true); } catch (e) { toast(errorMessage(e), 'error'); } }} />
      {editor && <FilterEditor filter={editor === 'new' ? null : editor} onClose={() => setEditor(null)} />}
    </>
  );
}

interface Row { kind: 'project' | 'priority' | 'label' | 'due' | 'text' | 'repeat' | 'status'; value: string; negate: boolean }

function rowToNode(r: Row): FilterNode {
  let n: FilterNode;
  switch (r.kind) {
    case 'project': n = { field: 'project', cmp: 'is', value: [r.value] }; break;
    case 'priority': n = { field: 'priority', cmp: 'is', value: Number(r.value) }; break;
    case 'label': n = { field: 'label', cmp: 'is', value: [r.value] }; break;
    case 'text': n = { field: 'text', cmp: 'contains', value: r.value }; break;
    case 'repeat': n = { field: 'hasRecurrence', cmp: 'is', value: true }; break;
    case 'status': n = { field: 'status', cmp: 'is', value: [r.value] }; break;
    default:
      n = r.value === 'overdue' ? { field: 'overdue', cmp: 'is', value: true }
        : r.value === 'none' ? { field: 'noDate', cmp: 'is', value: true }
        : r.value === 'week' ? { field: 'due', cmp: 'between', value: ['today', '+7d'] }
        : { field: 'due', cmp: 'is', value: r.value };
  }
  return r.negate ? { op: 'not', child: n } : n;
}

function nodeToRow(n: FilterNode): Row | null {
  let negate = false;
  let c = n;
  if ('op' in c && c.op === 'not') { negate = true; c = c.child; }
  if ('op' in c) return null;
  const v = c.value;
  const first = Array.isArray(v) ? String(v[0]) : String(v ?? '');
  switch (c.field) {
    case 'project': return { kind: 'project', value: first, negate };
    case 'priority': return { kind: 'priority', value: first, negate };
    case 'label': return { kind: 'label', value: first, negate };
    case 'text': return { kind: 'text', value: first, negate };
    case 'hasRecurrence': return { kind: 'repeat', value: '', negate };
    case 'status': return { kind: 'status', value: first, negate };
    case 'overdue': return { kind: 'due', value: 'overdue', negate };
    case 'noDate': return { kind: 'due', value: 'none', negate };
    case 'due': return c.cmp === 'between' ? { kind: 'due', value: 'week', negate } : { kind: 'due', value: first, negate };
    default: return null;
  }
}

function FilterEditor({ filter, onClose }: { filter: SavedFilterDTO | null; onClose: () => void }) {
  const projects = useStore((s) => s.projects);
  const labels = useStore((s) => s.labels);
  const qc = useQueryClient();
  const initial = useMemo<{ match: 'and' | 'or'; rows: Row[] } | null>(() => {
    if (!filter) return { match: 'and', rows: [{ kind: 'priority', value: '1', negate: false }] };
    const a = filter.ast;
    const kids = 'op' in a && a.op !== 'not' ? a.children : [a];
    const rows = kids.map(nodeToRow);
    if (rows.some((r) => r === null)) return null;
    return { match: 'op' in a && a.op === 'or' ? 'or' : 'and', rows: rows as Row[] };
  }, [filter]);
  const [name, setName] = useState(filter?.name ?? '');
  const [match, setMatch] = useState<'and' | 'or'>(initial?.match ?? 'and');
  const [rows, setRows] = useState<Row[]>(initial?.rows ?? []);
  const [busy, setBusy] = useState(false);
  const ast = useMemo<FilterNode | null>(() => (rows.length ? (rows.length === 1 ? rowToNode(rows[0] as Row) : { op: match, children: rows.map(rowToNode) }) : null), [rows, match]);
  const today = useToday();
  const all = useAllTasks();
  const preview = useMemo(() => {
    if (!ast) return [];
    const projList = Object.values(projects);
    return all.filter((t) => t.status !== 'archived' && (t.status === 'open' || JSON.stringify(ast).includes('"status"')) && evalFilter(ast, t, { today, projectDescendants: (id) => descendantsOf(id, projList), labelNameToId: (n) => Object.values(labels).find((l) => l.name.toLowerCase() === n.toLowerCase())?.id })).length;
  }, [ast, all, today, projects, labels]);
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    if (!ast || !name.trim()) return;
    setBusy(true);
    try {
      if (filter) await api('PATCH', `/saved-filters/${filter.id}`, { name: name.trim(), ast });
      else await api('POST', '/saved-filters', { name: name.trim(), ast });
      await refresh(true);
      void qc.invalidateQueries({ queryKey: ['filter'] });
      onClose();
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Filter editor">
      <SheetHeader title={filter ? 'Edit filter' : 'New filter'} onClose={onClose} right={<Button size="sm" variant="primary" disabled={!ast || !name.trim() || busy || !initial} onClick={save}>Save</Button>} />
      <div className="space-y-4 overflow-auto p-4">
        {!initial ? <p className="text-sm text-muted">This filter uses advanced conditions that the visual editor can't show. You can still rename or delete it.</p> : (
          <>
            <Field label="Name" htmlFor="fname"><Input id="fname" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. This week's priorities" /></Field>
            {rows.length > 1 && <div className="flex items-center gap-2 text-sm">Match <Segmented label="Match" value={match} onChange={setMatch} options={[{ value: 'and', label: 'all' }, { value: 'or', label: 'any' }]} /> of these conditions</div>}
            <ul className="space-y-2">
              {rows.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface p-2">
                  <Select aria-label="Condition type" value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as Row['kind'], value: e.target.value === 'priority' ? '1' : e.target.value === 'due' ? 'today' : e.target.value === 'status' ? 'open' : '' })} className="w-36">
                    <option value="priority">Priority</option><option value="due">Due</option><option value="project">Project</option><option value="label">Label</option><option value="text">Text contains</option><option value="repeat">Repeats</option><option value="status">Status</option>
                  </Select>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.negate} onChange={(e) => setRow(i, { negate: e.target.checked })} /> not</label>
                  {r.kind === 'priority' && <Select aria-label="Priority" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} className="w-32">{[1, 2, 3, 4].map((p) => <option key={p} value={p}>Priority {p}</option>)}</Select>}
                  {r.kind === 'due' && <Select aria-label="Due" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} className="w-44"><option value="overdue">Overdue</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="week">Next 7 days</option><option value="none">No date</option></Select>}
                  {r.kind === 'project' && <Select aria-label="Project" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} className="w-44"><option value="">Choose...</option><option value="inbox">Inbox</option>{Object.values(projects).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
                  {r.kind === 'label' && <Select aria-label="Label" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} className="w-44"><option value="">Choose...</option>{Object.values(labels).map((l) => <option key={l.id} value={l.id}>@{l.name}</option>)}</Select>}
                  {r.kind === 'text' && <Input aria-label="Text" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} className="w-44" />}
                  {r.kind === 'status' && <Select aria-label="Status" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} className="w-36"><option value="open">Open</option><option value="completed">Completed</option></Select>}
                  <IconButton label="Remove condition" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="ml-auto"><Trash2 size={16} /></IconButton>
                </li>
              ))}
            </ul>
            <Button onClick={() => setRows([...rows, { kind: 'priority', value: '1', negate: false }])}><Plus size={14} aria-hidden /> Add condition</Button>
            <p className="text-sm text-muted" aria-live="polite">{preview} matching task{preview === 1 ? '' : 's'} right now</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function useFilteredTasks(pred: (t: TaskDTO) => boolean) {
  const all = useAllTasks();
  return useMemo(() => all.filter((t) => t.status === 'open' && !t.deletedAt && pred(t)).sort(compareTasks('priority')), [all, pred]);
}

export function LabelTasksPage() {
  const { id = '' } = useParams();
  const label = useStore((s) => s.labels[id]);
  const pred = useMemo(() => (t: TaskDTO) => t.labelIds.includes(id), [id]);
  const tasks = useFilteredTasks(pred);
  if (!label) return <EmptyState title="Label not found" art={false} />;
  return (<><PageHeader title={`@${label.name}`} back="/labels" color={label.color} />{tasks.length ? <TaskList tasks={tasks} showProject /> : <EmptyState title="No open tasks with this label" art={false} />}</>);
}

export function FilterTasksPage() {
  const { id = '' } = useParams();
  const filter = useStore((s) => s.filters[id]);
  const projects = useStore((s) => s.projects);
  const labels = useStore((s) => s.labels);
  const today = useToday();
  const pred = useMemo(() => {
    if (!filter) return () => false;
    const projList = Object.values(projects);
    const withStatus = JSON.stringify(filter.ast).includes('"status"');
    return (t: TaskDTO) => evalFilter(filter.ast, t, { today, projectDescendants: (pid) => descendantsOf(pid, projList), labelNameToId: (n) => Object.values(labels).find((l) => l.name.toLowerCase() === n.toLowerCase())?.id }) && (withStatus || t.status === 'open');
  }, [filter, today, projects, labels]);
  const all = useAllTasks();
  const tasks = useMemo(() => all.filter((t) => t.status !== 'archived' && pred(t)).sort(compareTasks(filter?.sort ?? 'priority')), [all, pred, filter]);
  if (!filter) return <EmptyState title="Filter not found" art={false} />;
  return (<><PageHeader title={filter.name} back="/labels" />{tasks.length ? <TaskList tasks={tasks} showProject /> : <EmptyState title="Nothing matches this filter right now" art={false} />}</>);
}

// ---------------------------------------------------------------- Templates
export function TemplatesPage() {
  const templateMap = useStore((s) => s.templates);
  const templates = useMemo(() => Object.values(templateMap), [templateMap]);
  const [tab, setTab] = useState<'mine' | 'builtin'>('builtin');
  const [apply, setApply] = useState<TemplateDTO | null>(null);
  const [create, setCreate] = useState(false);
  const [del, setDel] = useState<TemplateDTO | null>(null);
  const list = templates.filter((t) => (tab === 'builtin' ? t.isBuiltin : !t.isBuiltin));
  const tint = ['#3a2b26', '#26332f', '#2a2f3d', '#352a39'];
  return (
    <>
      <PageHeader title="Templates" back="/browse" right={<Button size="sm" variant="primary" onClick={() => setCreate(true)}><Plus size={14} aria-hidden /> New</Button>} />
      <div className="mb-4"><Segmented label="Template source" value={tab} onChange={setTab} options={[{ value: 'builtin', label: 'Built-in' }, { value: 'mine', label: 'My templates' }]} /></div>
      {!list.length && <EmptyState title={tab === 'mine' ? 'You have no templates yet' : 'No built-in templates'} body="Create one from a list of tasks, then apply it to start a new project in one tap." art={false}><Button onClick={() => setCreate(true)}>Create a template</Button></EmptyState>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((t, i) => (
          <li key={t.id} className="flex flex-col rounded-xl border border-line p-4" style={{ background: `color-mix(in srgb, ${tint[i % tint.length]} 55%, var(--surface))` }}>
            <h2 className="font-semibold">{t.name}</h2>
            <p className="mt-1 flex-1 text-sm text-muted">{t.description}</p>
            <p className="mt-2 text-xs text-muted">{countTasks(t.body)} tasks</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => setApply(t)}>Use template</Button>
              {!t.isBuiltin && <Button size="sm" variant="ghost" onClick={() => setDel(t)}>Delete</Button>}
            </div>
          </li>
        ))}
      </ul>
      {apply && <ApplyTemplate template={apply} onClose={() => setApply(null)} />}
      {create && <CreateTemplate onClose={() => setCreate(false)} />}
      <Confirm open={!!del} onOpenChange={(o) => !o && setDel(null)} danger title={`Delete "${del?.name}"?`} body="Projects already created from it are not affected." confirmLabel="Delete" onConfirm={async () => { if (!del) return; try { await api('DELETE', `/templates/${del.id}`); await refresh(true); } catch (e) { toast(errorMessage(e), 'error'); } }} />
    </>
  );
}

function countTasks(b: TemplateBody): number {
  const c = (list: { subtasks?: unknown[] }[]): number => list.reduce((n, t) => n + 1 + c((t.subtasks ?? []) as never[]), 0);
  return c(b.tasks) + b.sections.reduce((n, s) => n + c(s.tasks), 0);
}

function ApplyTemplate({ template, onClose }: { template: TemplateDTO; onClose: () => void }) {
  const nav = useNavigate();
  const online = useStore((s) => s.online);
  const [name, setName] = useState(template.body.project?.name ?? template.name);
  const [busy, setBusy] = useState(false);
  const groups = [...template.body.sections.map((s) => ({ name: s.name, tasks: s.tasks })), ...(template.body.tasks.length ? [{ name: 'Tasks', tasks: template.body.tasks }] : [])];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Use template">
      <SheetHeader title={template.name} onClose={onClose} />
      <div className="space-y-4 overflow-auto p-4">
        <Field label="Project name" htmlFor="tpn"><Input id="tpn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="rounded-lg bg-surface p-3 text-sm">
          <p className="mb-1 font-medium">Preview ({countTasks(template.body)} tasks)</p>
          <ul className="space-y-2">{groups.map((s) => <li key={s.name}><p className="font-semibold">{s.name}</p><ul className="list-disc pl-5 text-muted">{s.tasks.slice(0, 8).map((t, i) => <li key={i}>{t.title}{t.subtasks?.length ? ` (+${t.subtasks.length} subtasks)` : ''}</li>)}</ul></li>)}</ul>
          {!online && <p className="mt-2 text-warn">Applying a template needs a connection.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!online || busy || !name.trim()} onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ projectId: string }>('POST', `/templates/${template.id}/apply`, { projectName: name }, { idempotencyKey: `tpl-${template.id}-${Date.now()}` });
              await refresh(true);
              toast('Project created from template', 'success');
              onClose();
              if (r.projectId) nav(`/project/${r.projectId}`);
            } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
          }}>Create project</Button>
        </div>
      </div>
    </Sheet>
  );
}

function CreateTemplate({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [lines, setLines] = useState('');
  const [busy, setBusy] = useState(false);
  const body = useMemo<TemplateBody>(() => {
    const tasks: { title: string; subtasks?: { title: string }[] }[] = [];
    for (const raw of lines.split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      if (/^[-*]\s+/.test(t) && tasks.length) { (tasks[tasks.length - 1] as { subtasks?: { title: string }[] }).subtasks = [...((tasks[tasks.length - 1] as { subtasks?: { title: string }[] }).subtasks ?? []), { title: t.replace(/^[-*]\s+/, '') }]; }
      else tasks.push({ title: t });
    }
    return { version: 1, project: { name: name || 'New project' }, sections: [], tasks };
  }, [lines, name]);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="New template">
      <SheetHeader title="New template" onClose={onClose} right={<Button size="sm" variant="primary" disabled={!name.trim() || !body.tasks.length || busy} onClick={async () => {
        setBusy(true);
        try { await api('POST', '/templates', { name: name.trim(), description: desc, kind: 'project', body }); await refresh(true); onClose(); } catch (e) { toast(errorMessage(e), 'error'); } finally { setBusy(false); }
      }}>Save</Button>} />
      <div className="space-y-4 overflow-auto p-4">
        <Field label="Template name" htmlFor="tn"><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description" htmlFor="td"><Input id="td" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Tasks" hint="One task per line. Start a line with - to make it a subtask of the line above." htmlFor="tl"><Textarea id="tl" rows={8} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'Plan the trip\n- Book flights\n- Reserve hotel\nPack bags'} /></Field>
        <p className="text-sm text-muted">{body.tasks.length} top-level task(s)</p>
      </div>
    </Sheet>
  );
}