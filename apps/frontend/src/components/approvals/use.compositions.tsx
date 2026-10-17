'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
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
