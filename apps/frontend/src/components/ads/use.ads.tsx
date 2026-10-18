'use client';

import { useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useTranslationSettings } from '@gitroom/react/translation/get.transation.service.client';
import { displayLocales } from '@gitroom/react/translation/i18n.config';

export interface AdsProviderOption {
  identifier: string;
  name: string;
  configured: boolean;
  boost: BoostCapabilities;
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

export type BoostObjective = 'engagement' | 'reach' | 'traffic';
export type BudgetType = 'daily' | 'lifetime';

export interface BudgetRule {
  monthlyCap: number | null;
  approvalThreshold: number | null;
  alertAt: number | null;
}

export interface AdsAccountBudget {
  accountId: string;
  provider: string;
  name: string;
  currency: string;
  monthSpend: number;
  rule: BudgetRule | null;
}

export interface BoostCapabilities {
  promotes: string[];
  objectives: BoostObjective[];
  budgetTypes: BudgetType[];
  needsDestinationUrl: boolean;
  needsTexts: boolean;
}

export interface BoostAccountOption {
  id: string;
  name: string;
  provider: string;
  currency: string;
  capabilities: BoostCapabilities;
}

export interface BoostTexts {
  headline: string;
  longHeadline: string;
  description: string;
  businessName: string;
}

export interface BoostSettings {
  adAccountId: string;
  objective: BoostObjective;
  budgetType: BudgetType;
  budgetAmount: number;
  days: number;
  audience: { countries: string[]; ageMin: number; ageMax: number };
  destinationUrl?: string;
  texts?: BoostTexts;
}

export interface Boost {
  id: string;
  status: 'awaiting_approval' | 'launching' | 'active' | 'failed' | 'rejected';
  origin: 'manual' | 'agent' | 'auto';
  name: string;
  objective: BoostObjective;
  budgetType: BudgetType;
  budgetAmount: number;
  days: number;
  error: string | null;
  createdAt: string;
  adAccount: { id: string; name: string; provider: string; currency: string };
  post: {
    id: string;
    content: string;
    releaseURL: string | null;
    integration: { id: string; name: string; picture: string | null; providerIdentifier: string };
  };
}

export interface AutoBoost {
  id: string;
  objective: BoostObjective;
  budgetType: BudgetType;
  budgetAmount: number;
  days: number;
  createdAt: string;
  adAccount: { id: string; name: string; provider: string; currency: string };
  integration: { id: string; name: string; picture: string | null; providerIdentifier: string };
}

export const useAdsFormat = () => {
  const { language } = useTranslationSettings();
  const locale = displayLocales[language] || language;
  return useMemo(
    () => ({
      money: (cents: number, currency: string) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100),
      number: (value: number) => new Intl.NumberFormat(locale).format(Math.round(value)),
      percent: (value: number) =>
        new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value),
    }),
    [locale]
  );
};

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

export const useAdsBudget = () => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as AdsAccountBudget[];
  }, []);
  return useSWR('/ads/budget', load);
};

// A post that can't be promoted answers with the reason instead of the accounts
export const useBoostOptions = (postId: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(await errorMessage(response));
    }
    return (await response.json()) as { reference: string; accounts: BoostAccountOption[] };
  }, []);
  return useSWR(`/ads/posts/${postId}/boost`, load, { shouldRetryOnError: false });
};

export const useBoosts = (status?: Boost['status']) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as Boost[];
  }, []);
  return useSWR(`/ads/boosts${status ? `?status=${status}` : ''}`, load);
};

export const useAutoBoosts = () => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as AutoBoost[];
  }, []);
  return useSWR('/ads/auto-boosts', load);
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

  const send = useCallback(
    async (path: string, method: string, body?: unknown) => {
      const response = await fetch(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await refresh();
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      return response;
    },
    [refresh]
  );

  const saveAccounts = useCallback(
    async (connection: string, externalIds: string[]) => {
      await send('/ads/accounts', 'POST', { connection, externalIds });
    },
    [send]
  );

  const sync = useCallback(
    async (id: string) => {
      await send(`/ads/accounts/${id}/sync`, 'POST');
    },
    [send]
  );

  const remove = useCallback(
    async (id: string) => {
      await send(`/ads/accounts/${id}`, 'DELETE');
    },
    [send]
  );

  const setCampaignStatus = useCallback(
    async (id: string, status: 'active' | 'paused') => {
      await send(`/ads/campaigns/${id}/status`, 'POST', { status });
    },
    [send]
  );

  const setCampaignBudget = useCallback(
    async (id: string, amount: number) => {
      await send(`/ads/campaigns/${id}/budget`, 'PUT', { amount });
    },
    [send]
  );

  const saveRule = useCallback(
    async (accountId: string, rule: BudgetRule) => {
      await send(`/ads/accounts/${accountId}/rule`, 'PUT', rule);
    },
    [send]
  );

  const deleteRule = useCallback(
    async (accountId: string) => {
      await send(`/ads/accounts/${accountId}/rule`, 'DELETE');
    },
    [send]
  );

  const createBoost = useCallback(
    async (postId: string, settings: BoostSettings) => {
      return (await (await send('/ads/boosts', 'POST', { ...settings, postId })).json()) as Boost;
    },
    [send]
  );

  const approveBoost = useCallback(
    async (id: string) => {
      await send(`/ads/boosts/${id}/approve`, 'POST');
    },
    [send]
  );

  const rejectBoost = useCallback(
    async (id: string) => {
      await send(`/ads/boosts/${id}/reject`, 'POST');
    },
    [send]
  );

  const saveAutoBoost = useCallback(
    async (integrationId: string, settings: BoostSettings) => {
      await send('/ads/auto-boosts', 'POST', { ...settings, integrationId });
    },
    [send]
  );

  const deleteAutoBoost = useCallback(
    async (id: string) => {
      await send(`/ads/auto-boosts/${id}`, 'DELETE');
    },
    [send]
  );

  return {
    authUrl,
    connect,
    saveAccounts,
    sync,
    remove,
    setCampaignStatus,
    setCampaignBudget,
    saveRule,
    deleteRule,
    createBoost,
    approveBoost,
    rejectBoost,
    saveAutoBoost,
    deleteAutoBoost,
  };
};
