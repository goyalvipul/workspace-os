import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import clsx from 'clsx';
import { Check, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { dismissToast, useStore } from '../lib/store';

export { clsx };

// ---------------------------------------------------------------- buttons
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', className, ...p }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none',
        size === 'sm' ? 'min-h-8 px-3 text-sm' : 'min-h-10 px-4 text-sm',
        variant === 'primary' && 'bg-accent text-accent-fg hover:bg-accent-strong',
        variant === 'secondary' && 'bg-surface2 text-fg hover:bg-line',
        variant === 'ghost' && 'text-fg hover:bg-surface2',
        variant === 'danger' && 'bg-surface2 text-danger hover:bg-line',
        className,
      )}
    />
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(function IconButton({ label, className, children, ...p }, ref) {
  return (
    <button ref={ref} type="button" aria-label={label} title={label} {...p} className={clsx('inline-flex h-10 w-10 items-center justify-center rounded-full text-fg hover:bg-surface2 disabled:opacity-40', className)}>
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- form fields
const fieldCls = 'w-full rounded-lg border border-line bg-surface px-3 min-h-10 text-sm text-fg placeholder:text-muted focus:border-accent-text focus:outline-none';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={clsx(fieldCls, className)} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} {...p} className={clsx(fieldCls, 'py-2', className)} />;
});
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={clsx(fieldCls, 'pr-8', className)}>
      {children}
    </select>
  );
}
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-accent' : 'bg-line')}
    >
      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-surface2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={clsx('min-h-8 rounded-md px-3 text-sm', value === o.value ? 'bg-bg font-medium text-fg shadow-sm' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type ChipProps = { children: ReactNode; active?: boolean; color?: string } & Omit<HTMLAttributes<HTMLElement>, 'color'>;

/**
 * Pill. Becomes a real <button> when it is interactive. It forwards its ref and any extra props, which is
 * required for Radix `asChild` triggers (Popover/Dropdown inject onClick, aria-* and a ref into the child).
 */
export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip({ children, active, color, className, onClick, ...rest }, ref) {
  const interactive = !!onClick;
  const cls = clsx('inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm', active ? 'border-accent-text text-accent-text' : 'border-line text-fg', interactive && 'cursor-pointer hover:bg-surface2', className);
  const dot = color ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden /> : null;
  return interactive ? (
    <button ref={ref as Ref<HTMLButtonElement>} type="button" onClick={onClick} className={cls} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {dot}
      {children}
    </button>
  ) : (
    <span ref={ref as Ref<HTMLSpanElement>} className={cls} {...rest}>
      {dot}
      {children}
    </span>
  );
});

// ---------------------------------------------------------------- overlays
export function Sheet({ open, onOpenChange, title, children, side, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; side?: boolean; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[var(--overlay)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={clsx(
            'anim-sheet fixed z-50 flex max-h-[92dvh] flex-col overflow-hidden border border-line bg-bg shadow-2xl outline-none',
            'inset-x-0 bottom-0 rounded-t-2xl',
            side ? 'md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[480px] md:rounded-none md:rounded-l-2xl' : clsx('md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl', wide ? 'md:w-[min(720px,94vw)]' : 'md:w-[min(520px,94vw)]'),
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SheetHeader({ title, onClose, right }: { title: string; onClose: () => void; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <IconButton label="Close" onClick={onClose} className="bg-surface">
        <X size={20} />
      </IconButton>
      <h2 className="flex-1 truncate text-center text-base font-semibold">{title}</h2>
      <div className="flex min-w-10 justify-end">{right}</div>
    </div>
  );
}

export function Confirm({ open, onOpenChange, title, body, confirmLabel, onConfirm, danger }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; danger?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content aria-describedby="confirm-body" className="anim-sheet fixed left-1/2 top-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-bg p-5 shadow-2xl outline-none">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <div id="confirm-body" className="mt-2 text-sm text-muted">
            {body}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const MenuRoot = Dropdown.Root;
export const MenuTrigger = Dropdown.Trigger;
export function MenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' | 'center' }) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content align={align} sideOffset={6} className="anim-fade z-[60] min-w-[200px] rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, icon }: { children: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode }) {
  return (
    <Dropdown.Item onSelect={onSelect} className={clsx('flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-surface2', danger && 'text-danger')}>
      {icon}
      {children}
    </Dropdown.Item>
  );
}
export const MenuSep = () => <Dropdown.Separator className="my-1 h-px bg-line" />;

export const PopoverRoot = Popover.Root;
export const PopoverTrigger = Popover.Trigger;
export function PopoverContent({ children, className, align = 'start' }: { children: ReactNode; className?: string; align?: 'start' | 'end' | 'center' }) {
  return (
    <Popover.Portal>
      <Popover.Content align={align} sideOffset={6} collisionPadding={8} className={clsx('anim-fade z-[70] max-h-[min(70dvh,var(--radix-popover-content-available-height))] overflow-auto rounded-xl border border-line bg-surface p-2 shadow-2xl', className)}>
        {children}
      </Popover.Content>
    </Popover.Portal>
  );
}
export const PopoverClose = Popover.Close;

// ---------------------------------------------------------------- misc
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex justify-center p-8">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent-text" />
    </div>
  );
}

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} className={clsx('anim-sheet pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl', t.kind === 'error' ? 'border-danger bg-surface text-fg' : 'border-line bg-surface2 text-fg')}>
          {t.kind === 'success' && <Check size={16} className="text-ok" />}
          <span>{t.text}</span>
          {t.action && (
            <button
              className="font-semibold text-accent-text"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, children, art = true }: { title: string; body?: ReactNode; children?: ReactNode; art?: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {art && <Illustration />}
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Original calm illustration (not derived from any third-party artwork). */
export function Illustration() {
  return (
    <svg width="220" height="150" viewBox="0 0 220 150" aria-hidden role="img">
      <ellipse cx="110" cy="132" rx="84" ry="10" fill="var(--surface2)" />
      <circle cx="110" cy="64" r="44" fill="var(--surface2)" />
      <path d="M72 120c8-34 24-52 38-52s30 18 38 52z" fill="var(--accent)" opacity=".9" />
      <circle cx="110" cy="58" r="18" fill="var(--bg)" stroke="var(--line)" strokeWidth="2" />
      <path d="M102 58q8 7 16 0" fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M44 124c-6-22 2-40 14-48 2 20-2 36-14 48zM176 124c6-22-2-40-14-48-2 20 2 36 14 48z" fill="var(--ok)" opacity=".55" />
      <circle cx="40" cy="60" r="5" fill="var(--warn)" />
      <circle cx="184" cy="48" r="4" fill="var(--accent-text)" />
      <circle cx="168" cy="92" r="3" fill="var(--warn)" />
    </svg>
  );
}
