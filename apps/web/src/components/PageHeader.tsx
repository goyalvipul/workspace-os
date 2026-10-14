import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsDesktop } from '../lib/hooks';
import { IconButton } from './ui';
import { SyncBadge } from './Shell';

export function PageHeader({ title, subtitle, right, back, color }: { title: string; subtitle?: ReactNode; right?: ReactNode; back?: string | boolean; color?: string }) {
  const nav = useNavigate();
  const desktop = useIsDesktop();
  return (
    <header className="sticky top-0 z-10 -mx-4 bg-bg/95 px-4 pb-2 pt-3 backdrop-blur md:pt-8">
      <div className="flex items-center gap-1">
        {back && (
          <IconButton label="Back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))} className="-ml-2">
            <ChevronLeft size={24} />
          </IconButton>
        )}
        <h1 className="min-w-0 flex-1 truncate text-3xl font-bold tracking-tight md:text-[28px]" style={color ? { borderLeft: `4px solid ${color}`, paddingLeft: 10 } : undefined}>
          {title}
        </h1>
        <div className="flex items-center gap-1">{right}</div>
      </div>
      {subtitle && <div className="mt-1 text-sm font-semibold">{subtitle}</div>}
      {!desktop && (
        <div className="mt-1">
          <SyncBadge />
        </div>
      )}
    </header>
  );
}
