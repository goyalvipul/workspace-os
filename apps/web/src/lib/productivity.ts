import { addDays, weekdayOf } from '@wos/shared';

export interface GoalPrefs {
  dailyGoal: number;
  weeklyGoal: number;
  daysOff: number[];
  vacation: boolean;
}

export const KARMA_LEVELS: { name: string; at: number }[] = [
  { name: 'Beginner', at: 0 },
  { name: 'Novice', at: 60 },
  { name: 'Intermediate', at: 200 },
  { name: 'Professional', at: 500 },
  { name: 'Expert', at: 1000 },
  { name: 'Master', at: 2000 },
  { name: 'Grandmaster', at: 4000 },
  { name: 'Enlightened', at: 7500 },
];

export interface Productivity {
  todayCount: number;
  weekCount: number;
  streak: number;
  longest: number;
  goalDays: number;
  karma: number;
  level: { name: string; at: number };
  next: { name: string; at: number } | null;
}

/**
 * Daily/weekly goals, goal streaks and karma from per-day completion counts.
 * - A day off never breaks (or extends) a streak. Vacation mode freezes goals entirely.
 * - Karma = 1 point per completed task + 10 bonus points for every day the daily goal was met.
 */
export function computeProductivity(days: { date: string; completed: number }[], prefs: GoalPrefs, today: string, weekStart: 0 | 1): Productivity {
  const byDate = new Map(days.map((d) => [d.date, d.completed]));
  const isOff = (date: string) => prefs.daysOff.includes(weekdayOf(date));
  const met = (date: string) => (byDate.get(date) ?? 0) >= prefs.dailyGoal;

  const first = days[0]?.date ?? today;
  let streak = 0;
  for (let d = today; d >= first; d = addDays(d, -1)) {
    if (isOff(d)) continue;
    if (met(d)) streak++;
    else if (d !== today) break; // today is still in progress, so it cannot break the streak yet
  }

  let longest = 0;
  let run = 0;
  let goalDays = 0;
  for (const { date } of days) {
    if (isOff(date)) continue;
    if (met(date)) {
      run++;
      goalDays++;
      longest = Math.max(longest, run);
    } else if (date !== today) run = 0;
  }

  const weekFrom = addDays(today, -((weekdayOf(today) - weekStart + 7) % 7));
  const weekCount = days.filter((d) => d.date >= weekFrom && d.date <= today).reduce((a, d) => a + d.completed, 0);
  const total = days.reduce((a, d) => a + d.completed, 0);
  const karma = total + goalDays * 10;
  const idx = KARMA_LEVELS.reduce((best, l, i) => (karma >= l.at ? i : best), 0);
  return {
    todayCount: byDate.get(today) ?? 0,
    weekCount,
    streak,
    longest,
    goalDays,
    karma,
    level: KARMA_LEVELS[idx] as { name: string; at: number },
    next: KARMA_LEVELS[idx + 1] ?? null,
  };
}
