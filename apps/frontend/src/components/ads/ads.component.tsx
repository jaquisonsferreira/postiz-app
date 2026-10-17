'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useT, useTranslationSettings } from '@gitroom/react/translation/get.transation.service.client';
import { displayLocales } from '@gitroom/react/translation/i18n.config';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useLocalDate } from '@gitroom/frontend/components/dashboard/use.dashboard';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { PillTabs } from '@gitroom/frontend/components/ui/pill.tabs';
import {
  AdAccount,
  AdsCampaignRow,
  AdsProviderOption,
  AdsTotals,
  useAdsAccounts,
  useAdsActions,
  useAdsProviders,
  useAdsSummary,
} from '@gitroom/frontend/components/ads/use.ads';

const PERIODS = { '7d': 7, '30d': 30, '90d': 90 } as const;
type Period = keyof typeof PERIODS;

const campaignStatusStyles: Record<AdsCampaignRow['status'], string> = {
  active: 'bg-statusPublishedBg text-statusPublishedText',
  paused: 'bg-statusDraftBg text-statusDraftText',
  removed: 'bg-statusErrorBg text-statusErrorText',
};

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

const ProviderIcon: FC<{ provider: string; size?: number }> = ({ provider, size = 40 }) => (
  <img
    src={`/icons/platforms/${provider}.svg`}
    alt=""
    aria-hidden="true"
    width={size}
    height={size}
    className="shrink-0 rounded-full bg-newBgColor"
  />
);

const Kpi: FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <div data-testid="ads-kpi" className="flex-1 min-w-[180px] bg-newBgColorInner rounded-[32px] p-[26px] flex flex-col gap-[6px]">
    <span className="text-[15px] text-textItemBlur">{label}</span>
    <span data-testid="ads-kpi-value" className="text-[36px] leading-[1.1] font-[500] tracking-[-0.02em] break-words">
      {value}
    </span>
    <span className="text-[14px] text-textItemBlur">{hint}</span>
  </div>
);

const TotalsRow: FC<{ totals: AdsTotals }> = ({ totals }) => {
  const t = useT();
  const format = useAdsFormat();
  const ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  const cpc = totals.clicks ? totals.spend / totals.clicks : 0;
  return (
    <div className="flex flex-wrap gap-[16px]">
      <Kpi label={t('ads_spend', 'Spend')} value={format.money(totals.spend, totals.currency)} hint={totals.currency} />
      <Kpi label={t('ads_impressions', 'Impressions')} value={format.number(totals.impressions)} hint={t('in_selected_period', 'In the selected period')} />
      <Kpi label={t('ads_clicks', 'Clicks')} value={format.number(totals.clicks)} hint={t('ads_ctr_value', 'CTR {{ctr}}', { ctr: format.percent(ctr) })} />
      <Kpi label={t('ads_cpc', 'Cost per click')} value={format.money(cpc, totals.currency)} hint={t('ads_average', 'Average')} />
      <Kpi label={t('ads_conversions', 'Conversions')} value={format.number(totals.conversions)} hint={t('ads_reported_by_platforms', 'As reported by the platforms')} />
    </div>
  );
};

const ConnectButtons: FC<{ providers: AdsProviderOption[] }> = ({ providers }) => {
  const t = useT();
  const toaster = useToaster();
  const { authUrl } = useAdsActions();
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    (provider: string) => async () => {
      setBusy(true);
      try {
        window.location.href = await authUrl(provider);
      } catch (err: unknown) {
        toaster.show(err instanceof Error ? err.message : String(err), 'warning');
        setBusy(false);
      }
    },
    [authUrl]
  );

  return (
    <div className="flex flex-wrap gap-[12px]">
      {providers.map((provider) => (
        <PillButton
          key={provider.identifier}
          data-testid={`ads-connect-${provider.identifier}`}
          disabled={busy || !provider.configured}
          title={provider.configured ? undefined : t('ads_provider_not_configured', 'Not configured on this server yet')}
          onClick={start(provider.identifier)}
          icon={<ProviderIcon provider={provider.identifier} size={24} />}
        >
          {t('ads_connect_provider', 'Connect {{name}}', { name: provider.name })}
        </PillButton>
      ))}
    </div>
  );
};

const AccountsCard: FC<{ accounts: AdAccount[]; providers: AdsProviderOption[] }> = ({ accounts, providers }) => {
  const t = useT();
  const date = useLocalDate();
  const toaster = useToaster();
  const { sync, remove } = useAdsActions();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async (id: string, action: () => Promise<void>, success: string) => {
    setBusy(id);
    try {
      await action();
      toaster.show(success, 'success');
    } catch (err: unknown) {
      toaster.show(err instanceof Error ? err.message : String(err), 'warning');
    } finally {
      setBusy(null);
    }
  }, []);

  const onSync = useCallback(
    (account: AdAccount) => () => run(account.id, () => sync(account.id), t('ads_account_synced', 'Account synced')),
    [run]
  );

  const onRemove = useCallback(
    (account: AdAccount) => async () => {
      if (
        !(await deleteDialog(
          t('ads_remove_account_question', 'Remove {{name}}? Its campaigns stop showing here, nothing changes on the platform.', {
            name: account.name,
          })
        ))
      ) {
        return;
      }
      await run(account.id, () => remove(account.id), t('ads_account_removed', 'Account removed'));
    },
    [run]
  );

  return (
    <Card testId="ads-accounts">
      <CardHeader title={t('ads_accounts', 'Ad accounts')} meta={String(accounts.length)} />
      <ul className="m-0 p-0 list-none flex flex-col">
        {accounts.map((account) => (
          <li
            key={account.id}
            data-testid="ads-account"
            className="flex flex-wrap items-center gap-[14px] py-[14px] border-t border-newBorder first:border-t-0"
          >
            <ProviderIcon provider={account.provider} />
            <span className="flex-1 min-w-[180px] flex flex-col">
              <span className="text-[16px] font-[500] truncate">{account.name}</span>
              <span className="text-[13px] text-textItemBlur">
                {providers.find((provider) => provider.identifier === account.provider)?.name || account.provider} ·{' '}
                {account.currency} ·{' '}
                {account.lastSyncAt
                  ? t('ads_synced_at', 'Synced {{when}}', { when: date(account.lastSyncAt).format('DD/MM HH:mm') })
                  : t('ads_never_synced', 'Not synced yet')}
              </span>
              {account.refreshNeeded && (
                <span className="text-[13px] text-statusErrorText">
                  {t('ads_reconnect_needed', 'The platform asked for a new login, connect this account again')}
                </span>
              )}
            </span>
            <PillButton
              className="!h-[40px] !px-[16px] !text-[14px]"
              disabled={busy === account.id || account.refreshNeeded}
              onClick={onSync(account)}
            >
              {t('ads_sync_now', 'Sync now')}
            </PillButton>
            <PillButton
              className="!h-[40px] !px-[16px] !text-[14px]"
              disabled={busy === account.id}
              onClick={onRemove(account)}
            >
              {t('ads_remove', 'Remove')}
            </PillButton>
          </li>
        ))}
      </ul>
    </Card>
  );
};

const CampaignsCard: FC<{ campaigns: AdsCampaignRow[] }> = ({ campaigns }) => {
  const t = useT();
  const format = useAdsFormat();
  const statusLabel: Record<AdsCampaignRow['status'], string> = {
    active: t('ads_status_active', 'Active'),
    paused: t('ads_status_paused', 'Paused'),
    removed: t('ads_status_removed', 'Removed'),
  };

  return (
    <Card className="flex-[2_1_520px] min-w-0" testId="ads-campaigns">
      <CardHeader title={t('ads_campaigns', 'Campaigns')} meta={String(campaigns.length)} />
      {campaigns.length === 0 ? (
        <p className="m-0 text-[15px] text-textItemBlur">
          {t('ads_no_campaigns', 'No campaign ran in this period.')}
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col">
          {campaigns.map((campaign) => (
            <li
              key={campaign.id}
              data-testid="ads-campaign"
              className="flex flex-wrap items-center gap-[14px] py-[14px] border-t border-newBorder first:border-t-0"
            >
              <ProviderIcon provider={campaign.provider} />
              <span className="flex-1 min-w-[180px] flex flex-col gap-[2px]">
                <span className="text-[16px] font-[500] break-words">{campaign.name}</span>
                <span className="text-[13px] text-textItemBlur">
                  {campaign.accountName}
                  {campaign.budgetAmount !== null &&
                    ` · ${
                      campaign.budgetType === 'daily'
                        ? t('ads_daily_budget', 'Daily budget {{value}}', {
                            value: format.money(campaign.budgetAmount, campaign.currency),
                          })
                        : t('ads_lifetime_budget', 'Total budget {{value}}', {
                            value: format.money(campaign.budgetAmount, campaign.currency),
                          })
                    }`}
                </span>
              </span>
              <span
                className={clsx(
                  'inline-flex items-center gap-[6px] h-[28px] px-[10px] rounded-full text-[13px] font-[500] whitespace-nowrap',
                  campaignStatusStyles[campaign.status]
                )}
              >
                <span className="w-[6px] h-[6px] rounded-full bg-current" aria-hidden="true" />
                {statusLabel[campaign.status]}
              </span>
              <span className="w-[150px] mobile:w-auto flex flex-col items-end mobile:items-start">
                <span data-testid="ads-campaign-spend" className="text-[16px] font-[500]">
                  {format.money(campaign.spend, campaign.currency)}
                </span>
                <span className="text-[13px] text-textItemBlur">
                  {t('ads_clicks_count', '{{clicks}} clicks', { clicks: format.number(campaign.clicks) })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

const DailySpendCard: FC<{ days: { date: string; spend: number }[]; currency: string }> = ({ days, currency }) => {
  const t = useT();
  const date = useLocalDate();
  const format = useAdsFormat();
  const max = Math.max(1, ...days.map((day) => day.spend));
  return (
    <Card className="flex-[1_1_320px] min-w-0">
      <CardHeader title={t('ads_spend_per_day', 'Spend per day')} meta={currency} />
      {days.every((day) => day.spend === 0) ? (
        <p className="m-0 text-[15px] text-textItemBlur">{t('ads_no_spend', 'No spend in this period.')}</p>
      ) : (
        <div className="flex items-end gap-[4px] h-[160px]" role="img" aria-label={t('ads_spend_per_day', 'Spend per day')}>
          {days.map((day) => (
            <span
              key={day.date}
              title={`${date(day.date).format('DD/MM')} · ${format.money(day.spend, currency)}`}
              className="flex-1 min-w-[2px] rounded-t-[6px] bg-accent"
              style={{ height: `${Math.max(2, (day.spend / max) * 100)}%` }}
            />
          ))}
        </div>
      )}
    </Card>
  );
};

export const AdsComponent: FC = () => {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const date = useLocalDate();
  const format = useAdsFormat();
  const period: Period = (search.get('period') as Period) in PERIODS ? (search.get('period') as Period) : '30d';

  const range = useMemo(
    () => ({
      from: date().subtract(PERIODS[period] - 1, 'day').format('YYYY-MM-DD'),
      to: date().format('YYYY-MM-DD'),
    }),
    [period, date]
  );

  const { data: providers = [] } = useAdsProviders();
  const { data: accounts, isLoading } = useAdsAccounts();
  const { data: summary } = useAdsSummary(range.from, range.to);

  const changePeriod = useCallback(
    (next: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('period', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [search, pathname]
  );

  const mainTotals = useMemo(
    () => [...(summary?.totals || [])].sort((a, b) => b.spend - a.spend)[0],
    [summary]
  );
  const mainDays = useMemo(() => {
    const spendByDate = new Map(
      (summary?.daily || [])
        .filter((day) => day.currency === mainTotals?.currency)
        .map((day) => [day.date, day.spend])
    );
    const days: { date: string; spend: number }[] = [];
    for (let day = date(range.from); !day.isAfter(date(range.to), 'day'); day = day.add(1, 'day')) {
      const key = day.format('YYYY-MM-DD');
      days.push({ date: key, spend: spendByDate.get(key) || 0 });
    }
    return days;
  }, [summary, mainTotals, range, date]);

  if (isLoading || !accounts) {
    return <LoadingComponent />;
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-[24px]">
      <div className="flex flex-wrap items-end gap-[16px]">
        <div className="flex-1 min-w-[280px] flex flex-col gap-[8px]">
          <span className="text-[13px] uppercase tracking-[0.06em] text-textItemBlur">
            {t('ads_kicker', 'Meta Ads and Google Ads')}
          </span>
          <h2 className="m-0 text-[44px] mobile:text-[32px] leading-[1.1] font-[500] tracking-[-0.02em]">
            {t('ads', 'Ads')}
          </h2>
          {mainTotals && (
            <p className="m-0 text-[18px] text-textItemBlur">
              {t('ads_period_spend', 'Spend in the period: {{value}}', {
                value: summary!.totals.map((total) => format.money(total.spend, total.currency)).join(' + '),
              })}
            </p>
          )}
        </div>
        <ConnectButtons providers={providers} />
      </div>

      {accounts.length === 0 ? (
        <Card className="items-center text-center py-[64px]" testId="ads-empty">
          <span className="text-[22px] font-[500]">{t('ads_empty_title', 'No ad account connected')}</span>
          <span className="text-[16px] text-textItemBlur max-w-[520px]">
            {t(
              'ads_empty_description',
              'Connect Meta Ads or Google Ads to follow spend, clicks and campaigns next to your posts. Access is read only.'
            )}
          </span>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-[16px]">
            <PillTabs
              label={t('period', 'Period')}
              value={period}
              onChange={changePeriod}
              items={[
                { id: '7d', label: t('days_7', '7 days') },
                { id: '30d', label: t('days_30', '30 days') },
                { id: '90d', label: t('days_90', '90 days') },
              ]}
            />
            {summary?.totals.map((totals) => <TotalsRow key={totals.currency} totals={totals} />)}
          </div>

          <div className="flex flex-wrap gap-[16px] items-start">
            <CampaignsCard campaigns={summary?.campaigns || []} />
            {mainTotals && <DailySpendCard days={mainDays} currency={mainTotals.currency} />}
          </div>

          <AccountsCard accounts={accounts} providers={providers} />
        </>
      )}
    </div>
  );
};
