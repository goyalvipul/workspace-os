import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';

export interface CreatorosStatus {
  configured: boolean;
  enabled: boolean;
  webhookUrl: string | null;
  autoLabelId: string | null;
  autoProjectId: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  counts: { published: number; pending: number; failed: number };
}

export interface CreatorosLink {
  taskId: string;
  externalId: string | null;
  origin: string;
  state: 'synced' | 'pending' | 'failed';
}

export const CREATOROS_KEY = ['creatoros'] as const;

/** Link status plus a stable taskId -> link map (safe to use in render; it only changes when the data does). */
export function useCreatoros() {
  const status = useQuery<{ status: CreatorosStatus }>({ queryKey: CREATOROS_KEY, queryFn: () => api('GET', '/integrations/creatoros'), staleTime: 10_000, refetchInterval: 15_000, retry: false });
  const live = !!status.data?.status.enabled;
  const links = useQuery<{ items: CreatorosLink[] }>({ queryKey: [...CREATOROS_KEY, 'links'], queryFn: () => api('GET', '/integrations/creatoros/links'), enabled: live, staleTime: 5_000, refetchInterval: 10_000, retry: false });
  const byTask = useMemo(() => new Map((links.data?.items ?? []).map((l) => [l.taskId, l] as const)), [links.data]);
  return { status: status.data?.status ?? null, isLoading: status.isLoading, byTask };
}
