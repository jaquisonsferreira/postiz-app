'use client';

import { useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface AdsProviderOption {
  identifier: string;
  name: string;
  configured: boolean;
}

export interface AdAccount {
  id: string;
  provider: string;
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
  refreshNeeded: boolean;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface AdsAccountOption {
  externalId: string;
  name: string;
  currency: string;
  timezone: string;
}

export interface AdsTotals {
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface AdsDay {
  date: string;
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export interface AdsCampaignRow {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'removed';
  provider: string;
  accountName: string;
  currency: string;
  budgetType: 'daily' | 'lifetime' | null;
  budgetAmount: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface AdsSummary {
  totals: AdsTotals[];
  daily: AdsDay[];
  campaigns: AdsCampaignRow[];
}

const errorMessage = async (response: Response) =>
  ((await response.json().catch(() => ({}))) as { message?: string }).message ||
  response.statusText;

export const useAdsProviders = () => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as AdsProviderOption[];
  }, []);
  return useSWR('/ads/providers', load);
};

export const useAdsAccounts = () => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as AdAccount[];
  }, []);
  return useSWR('/ads/accounts', load);
};

export const useAdsSummary = (from: string, to: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as AdsSummary;
  }, []);
  return useSWR(`/ads/summary?from=${from}&to=${to}`, load, {
    keepPreviousData: true,
  });
};

// Accounts and summary change together: a new or removed account changes the numbers
export const useAdsActions = () => {
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const refresh = useCallback(async () => {
    await mutate((key) => typeof key === 'string' && key.startsWith('/ads/'));
  }, [mutate]);

  const authUrl = useCallback(async (provider: string) => {
    const response = await fetch(`/ads/${provider}/url`);
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    return ((await response.json()) as { url: string }).url;
  }, []);

  const connect = useCallback(async (provider: string, code: string, state: string) => {
    const response = await fetch(`/ads/${provider}/connect`, {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    return (await response.json()) as { connection: string; accounts: AdsAccountOption[] };
  }, []);

  const saveAccounts = useCallback(
    async (connection: string, externalIds: string[]) => {
      const response = await fetch('/ads/accounts', {
        method: 'POST',
        body: JSON.stringify({ connection, externalIds }),
      });
      await refresh();
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
    },
    [refresh]
  );

  const sync = useCallback(
    async (id: string) => {
      const response = await fetch(`/ads/accounts/${id}/sync`, { method: 'POST' });
      await refresh();
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      const response = await fetch(`/ads/accounts/${id}`, { method: 'DELETE' });
      await refresh();
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
    },
    [refresh]
  );

  return { authUrl, connect, saveAccounts, sync, remove };
};
