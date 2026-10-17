'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';
import { CalendarPost } from '@gitroom/frontend/components/dashboard/use.dashboard';

export type PostsListState = 'all' | 'scheduled' | 'draft' | 'published';

interface PostsListResult {
  posts: (CalendarPost & { actualDate?: string })[];
  total: number;
}

export const usePostsList = (state: PostsListState, limit = 100) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return expandPostsList(await (await fetch(path)).json()) as PostsListResult;
  }, []);
  return useSWR(`/posts/list?page=0&limit=${limit}&state=${state}`, load);
};
