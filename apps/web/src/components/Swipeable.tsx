import { Archive, CalendarClock, Check, Trash2, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { addDays, type SwipeAction, type TaskDTO } from '@wos/shared';
import { rescheduleTask } from '../lib/format';
import { useToday, useTz } from '../lib/hooks';
import { actions, useStore } from '../lib/store';

const THRESHOLD = 88; // px to commit
const MAX = 150;

const META: Record<Exclude<SwipeAction, 'none'>, { label: string; icon: LucideIcon; bg: string }> = {
  delete: { label: 'Delete', icon: Trash2, bg: '#c62d33' },
  archive: { label: 'Archive', icon: Archive, bg: '#b45309' },
  complete: { label: 'Complete', icon: Check, bg: '#15803d' },
  tomorrow: { label: 'Tomorrow', icon: CalendarClock, bg: '#1d4ed8' },
};

/**
 * Touch swipe actions for a task row. Swipe right / left runs the actions chosen in Settings → General
 * (default: right = delete, left = archive). Vertical scrolling is untouched: we only take over once the
 * gesture is clearly horizontal. Mouse users keep the normal row; this is a touch gesture.
 */
export function Swipeable({ task, disabled, children }: { task: TaskDTO; disabled?: boolean; children: ReactNode }) {
  const right = useStore((s) => s.prefs['swipe.right'] as SwipeAction);
  const left = useStore((s) => s.prefs['swipe.left'] as SwipeAction);
  const today = useToday();
  const tz = useTz();
  const start = useRef<{ x: number; y: number; mode: 'idle' | 'swipe' | 'scroll' } | null>(null);
  const [dx, setDx] = useState(0);
  const dxRef = useRef(0);
  const [settling, setSettling] = useState(false);
  const enabled = !disabled && (right !== 'none' || left !== 'none');

  const run = (a: SwipeAction) => {
    if (a === 'delete') actions.deleteTask(task.id);
    else if (a === 'archive') actions.archiveTask(task.id);
    else if (a === 'complete') {
      if (task.status === 'completed') actions.reopenTask(task.id);
      else actions.completeTask(task.id);
    } else if (a === 'tomorrow') rescheduleTask(task, addDays(today, 1), tz);
  };

  const finish = (offset: number) => {
    dxRef.current = 0;
    const action = offset > 0 ? right : left;
    if (Math.abs(offset) >= THRESHOLD && action !== 'none') {
      const stays = action === 'tomorrow' || action === 'complete'; // the row remains in place
      setSettling(true);
      setDx(stays ? 0 : Math.sign(offset) * 480);
      window.setTimeout(() => {
        run(action);
        setSettling(false);
        setDx(0);
      }, stays ? 120 : 180);
    } else {
      setSettling(true);
      setDx(0);
      window.setTimeout(() => setSettling(false), 200);
    }
  };

  if (!enabled) return <>{children}</>;

  const active = dx > 0 ? right : dx < 0 ? left : 'none';
  const meta = active !== 'none' ? META[active] : null;
  const armed = Math.abs(dx) >= THRESHOLD;

  return (
    <div className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {meta && (
        <div
          aria-hidden
          className={`absolute inset-0 flex items-center px-5 text-sm font-semibold text-white ${dx > 0 ? 'justify-start' : 'justify-end'}`}
          style={{ background: meta.bg, opacity: Math.min(1, Math.abs(dx) / 40) }}
        >
          <span className="flex items-center gap-2" style={{ transform: armed ? 'scale(1.1)' : undefined, transition: 'transform .12s' }}>
            <meta.icon size={20} />
            {meta.label}
          </span>
        </div>
      )}
      <div
        data-swipe-surface
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: settling ? 'transform .18s ease-out' : undefined, background: dx ? 'var(--bg)' : undefined }}
        onTouchStart={(e) => {
          if (settling || e.touches.length !== 1) return;
          const t = e.touches[0] as Touch;
          start.current = { x: t.clientX, y: t.clientY, mode: 'idle' };
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s || s.mode === 'scroll') return;
          const t = e.touches[0] as Touch;
          const ddx = t.clientX - s.x;
          const ddy = t.clientY - s.y;
          if (s.mode === 'idle') {
            if (Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) { s.mode = 'scroll'; return; }
            if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.4) s.mode = 'swipe';
            else return;
          }
          const dir = ddx > 0 ? right : left;
          const resisted = dir === 'none' ? ddx * 0.15 : ddx;
          const next = Math.max(-MAX, Math.min(MAX, resisted));
          dxRef.current = next; // the ref (not state) decides on release, so a fast flick cannot read a stale render
          setDx(next);
        }}
        onTouchEnd={() => {
          const s = start.current;
          start.current = null;
          if (s?.mode === 'swipe') finish(dxRef.current);
        }}
        onTouchCancel={() => {
          start.current = null;
          if (dxRef.current) finish(0);
        }}
        onClickCapture={(e) => {
          // a finished swipe must not also "tap" the row underneath
          if (settling) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
