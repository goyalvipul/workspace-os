import type { TemplateBody } from './schemas.js';

// Original built-in templates (original copy; not derived from any third-party template).
export const BUILTIN_TEMPLATES: { key: string; name: string; description: string; kind: 'project' | 'task'; body: TemplateBody }[] = [
  {
    key: 'weekly-review',
    name: 'Weekly Review',
    description: 'A short checklist to close out the week and set up the next one.',
    kind: 'project',
    body: {
      version: 1,
      project: { name: 'Weekly Review', outcome: 'Start each week with a clear, trusted plan.', color: '#3e63dd', defaultView: 'list' },
      sections: [
        {
          name: 'Clear',
          tasks: [
            { title: 'Empty the Inbox', description: 'Move every captured item to a project, schedule it, or delete it.', priority: 2 },
            { title: 'Review last week\u2019s completed work', subtasks: [{ title: 'Note what went well' }, { title: 'Note what slipped and why' }] },
          ],
        },
        {
          name: 'Plan',
          tasks: [
            { title: 'Check next week\u2019s calendar', priority: 2 },
            { title: 'Pick up to 3 focus tasks for Monday', priority: 1, dueOffsetDays: 2 },
            { title: 'Reschedule overdue tasks' },
          ],
        },
        { name: 'Maintain', tasks: [{ title: 'Back up important files' }, { title: 'Tidy projects: archive finished ones' }] },
      ],
      tasks: [],
    },
  },
  {
    key: 'project-tracker',
    name: 'Project Tracker',
    description: 'Board-style tracker with Backlog, In progress, Review and Done columns.',
    kind: 'project',
    body: {
      version: 1,
      project: { name: 'Project Tracker', outcome: 'Ship the project outcome on time.', color: '#12a594', defaultView: 'board' },
      sections: [
        { name: 'Backlog', tasks: [{ title: 'Define the outcome and success measure', priority: 2 }, { title: 'List the main deliverables' }] },
        { name: 'In progress', tasks: [{ title: 'First deliverable', priority: 2 }] },
        { name: 'Review', tasks: [] },
        { name: 'Done', tasks: [] },
      ],
      tasks: [],
    },
  },
  {
    key: 'quick-checklist',
    name: 'Packing checklist',
    description: 'A reusable list of tasks you can drop into any project.',
    kind: 'task',
    body: {
      version: 1,
      sections: [],
      tasks: [{ title: 'Documents and wallet' }, { title: 'Chargers and power bank' }, { title: 'Clothes' }, { title: 'Toiletries' }],
    },
  },
];
