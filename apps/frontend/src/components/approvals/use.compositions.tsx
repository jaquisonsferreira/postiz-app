'use client';

import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface CompositionSlide {
  kicker?: string;
  headline?: string;
  body?: string;
  theme?: 'accent' | 'light' | 'dark';
}

export interface Composition {
  id: string;
  status: string;
  format: 'carousel' | 'image' | 'text';
  title: string;
  size: 'portrait' | 'square' | 'story';
  publishDate: string;
  requiresApproval: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  slides: CompositionSlide[];
  targets: { integrationId: string; content: string }[];
  media: { id: string; path: string }[];
  posts: { postId: string; integration: string; target: number }[];
}

export const PENDING_APPROVALS_KEY = '/compositions/count?status=awaiting_approval';

export const usePendingApprovals = (): number => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as { total: number };
  }, []);
  const { data } = useSWR(PENDING_APPROVALS_KEY, load, { refreshInterval: 30000 });
  return data?.total || 0;
};

export const useCompositions = (status?: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as Composition[];
  }, []);
  return useSWR(`/compositions${status ? `?status=${status}` : ''}`, load);
};

// Approving or rejecting changes both the queue and the menu badge
export const useCompositionActions = () => {
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const refresh = useCallback(async () => {
    await mutate((key) => typeof key === 'string' && key.startsWith('/compositions'));
  }, [mutate]);

  const approve = useCallback(
    async (id: string) => {
      const response = await fetch(`/compositions/${id}/approve`, { method: 'POST' });
      await refresh();
      if (!response.ok) {
        throw new Error(((await response.json()) as { message?: string }).message || response.statusText);
      }
    },
    [refresh]
  );

  const reject = useCallback(
    async (id: string) => {
      const response = await fetch(`/compositions/${id}`, { method: 'DELETE' });
      await refresh();
      if (!response.ok) {
        throw new Error(((await response.json()) as { message?: string }).message || response.statusText);
      }
    },
    [refresh]
  );

  return { approve, reject };
};
