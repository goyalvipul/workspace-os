export interface ChangelogEntry {
  version: string;
  title: string;
  date?: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.2',
    title: 'Siri, Apple Watch and swipe actions',
    date: 'October 2026',
    items: [
      'Hey Siri, add task: capture tasks by voice on iPhone, iPad, Mac and Apple Watch through Apple Shortcuts, using personal access tokens.',
      'Swipe a task right to delete and left to archive, with undo. Choose the actions under Settings, General.',
      'New Archived list for tasks you want out of the way but not gone.',
      'Productivity: daily and weekly goals, goal streaks, karma levels, days off and vacation mode.',
      'Reminders: automatic reminders, snooze duration, and choose push, in-app or both.',
      'Morning overview and evening review notifications.',
      'General options: home view, detect dates in task names, reset sub-tasks on repeat, "next week" and "weekend" meaning, task complete sound.',
    ],
  },
  {
    version: '1.1',
    title: 'Installable app and mobile polish',
    items: [
      'Install on your phone or desktop as an app (PWA), with offline support.',
      'Quick add keeps clear of the on-screen keyboard.',
      'Add projects straight from the sidebar, and move a project to the top.',
    ],
  },
  {
    version: '1.0',
    title: 'Workspace OS',
    items: ['Tasks, projects, labels, filters, templates, recurring tasks, a unified read-only calendar for Google and Microsoft, push reminders, backups and import/export.'],
  },
];
