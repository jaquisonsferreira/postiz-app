'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPosts } from '@gitroom/helpers/utils/posts.list.minify';
import { ConfigType } from 'dayjs';
import i18next from 'i18next';
import 'dayjs/locale/pt';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';

export interface CalendarPost {
  id: string;
  content: string;
  publishDate: string;
  state: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT';
  group: string;
  integration: {
    id: string;
    providerIdentifier: string;
    name: string;
    picture: string | null;
  };
}

export const usePostsBetween = (startDate: string, endDate: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return expandPosts(await (await fetch(path)).json()).posts as CalendarPost[];
  }, []);
  return useSWR(
    `/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    load
  );
};

// Dates on the Pauta screens follow the interface language
export const useLocalDate = () => {
  const language = i18next.resolvedLanguage || 'en';
  return useCallback((date?: ConfigType) => newDayjs(date).locale(language), [language]);
};
