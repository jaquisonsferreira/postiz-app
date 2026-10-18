'use client';

import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Field, inputClass } from '@gitroom/frontend/components/ui/field';
import {
  BoostAccountOption,
  BoostObjective,
  BoostSettings,
  BoostTexts,
  BudgetType,
} from '@gitroom/frontend/components/ads/use.ads';

export interface BoostDraft {
  adAccountId: string;
  objective: BoostObjective;
  budgetType: BudgetType;
  amount: string;
  days: string;
  countries: string;
  ageMin: string;
  ageMax: string;
  destinationUrl: string;
  texts: BoostTexts;
}

const fitTo = (draft: BoostDraft, account?: BoostAccountOption): BoostDraft =>
  account
    ? {
        ...draft,
        adAccountId: account.id,
        objective: account.capabilities.objectives.includes(draft.objective)
          ? draft.objective
          : account.capabilities.objectives[0],
        budgetType: account.capabilities.budgetTypes.includes(draft.budgetType)
          ? draft.budgetType
          : account.capabilities.budgetTypes[0],
      }
    : draft;

export const newBoostDraft = (accounts: BoostAccountOption[]): BoostDraft =>
  fitTo(
    {
      adAccountId: '',
      objective: 'engagement',
      budgetType: 'daily',
      amount: '20',
      days: '7',
      countries: 'BR',
      ageMin: '18',
      ageMax: '65',
      destinationUrl: '',
      texts: { headline: '', longHeadline: '', description: '', businessName: '' },
    },
    accounts[0]
  );

// The amount is typed in the account currency, the API takes cents
export const boostSettingsOf = (draft: BoostDraft, account: BoostAccountOption): BoostSettings => ({
  adAccountId: draft.adAccountId,
  objective: draft.objective,
  budgetType: draft.budgetType,
  budgetAmount: Math.round(Number(draft.amount.replace(',', '.')) * 100),
  days: Number(draft.days),
  audience: {
    countries: draft.countries
      .split(',')
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean),
    ageMin: Number(draft.ageMin),
    ageMax: Number(draft.ageMax),
  },
  ...(account.capabilities.needsDestinationUrl ? { destinationUrl: draft.destinationUrl } : {}),
  ...(account.capabilities.needsTexts ? { texts: draft.texts } : {}),
});

export const BoostFields: FC<{
  accounts: BoostAccountOption[];
  draft: BoostDraft;
  onChange: (draft: BoostDraft) => void;
}> = ({ accounts, draft, onChange }) => {
  const t = useT();
  const account = accounts.find((item) => item.id === draft.adAccountId);

  const set = useCallback(
    (changes: Partial<BoostDraft>) => onChange({ ...draft, ...changes }),
    [draft, onChange]
  );
  const setText = useCallback(
    (key: keyof BoostTexts) => (value: string) => set({ texts: { ...draft.texts, [key]: value } }),
    [draft, set]
  );

  const objectiveLabels: Record<BoostObjective, string> = {
    engagement: t('ads_objective_engagement', 'Engagement'),
    reach: t('ads_objective_reach', 'Reach'),
    traffic: t('ads_objective_traffic', 'Clicks to a page'),
  };
  const budgetLabels: Record<BudgetType, string> = {
    daily: t('ads_budget_daily', 'Per day'),
    lifetime: t('ads_budget_lifetime', 'Total for the period'),
  };

  return (
    <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[16px]">
      <Field label={t('ads_account', 'Ad account')} id="boost-account">
        {(id) => (
          <select
            id={id}
            data-testid="boost-account"
            className={inputClass}
            value={draft.adAccountId}
            onChange={(e) => onChange(fitTo(draft, accounts.find((item) => item.id === e.target.value)))}
          >
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.currency}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('ads_objective', 'Objective')} id="boost-objective">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={draft.objective}
            onChange={(e) => set({ objective: e.target.value as BoostObjective })}
          >
            {(account?.capabilities.objectives || []).map((objective) => (
              <option key={objective} value={objective}>
                {objectiveLabels[objective]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('ads_budget_type', 'Budget')} id="boost-budget-type">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={draft.budgetType}
            onChange={(e) => set({ budgetType: e.target.value as BudgetType })}
          >
            {(account?.capabilities.budgetTypes || []).map((type) => (
              <option key={type} value={type}>
                {budgetLabels[type]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={t('ads_amount_in', 'Amount in {{currency}}', { currency: account?.currency || '' })} id="boost-amount">
        {(id) => (
          <input
            id={id}
            data-testid="boost-amount"
            inputMode="decimal"
            className={inputClass}
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('ads_days', 'Days')} id="boost-days">
        {(id) => (
          <input
            id={id}
            data-testid="boost-days"
            type="number"
            min={1}
            max={90}
            className={inputClass}
            value={draft.days}
            onChange={(e) => set({ days: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('ads_countries', 'Countries (codes, like BR, PT)')} id="boost-countries">
        {(id) => (
          <input id={id} className={inputClass} value={draft.countries} onChange={(e) => set({ countries: e.target.value })} />
        )}
      </Field>
      <Field label={t('ads_age_min', 'Minimum age')} id="boost-age-min">
        {(id) => (
          <input id={id} type="number" min={13} max={65} className={inputClass} value={draft.ageMin} onChange={(e) => set({ ageMin: e.target.value })} />
        )}
      </Field>
      <Field label={t('ads_age_max', 'Maximum age')} id="boost-age-max">
        {(id) => (
          <input id={id} type="number" min={13} max={65} className={inputClass} value={draft.ageMax} onChange={(e) => set({ ageMax: e.target.value })} />
        )}
      </Field>
      {account?.capabilities.needsDestinationUrl && (
        <div className="col-span-2 mobile:col-span-1">
          <Field label={t('ads_destination_url', 'Landing page')} id="boost-url">
            {(id) => (
              <input
                id={id}
                type="url"
                placeholder="https://"
                className={inputClass}
                value={draft.destinationUrl}
                onChange={(e) => set({ destinationUrl: e.target.value })}
              />
            )}
          </Field>
        </div>
      )}
      {account?.capabilities.needsTexts && (
        <>
          <Field label={t('ads_headline', 'Headline')} id="boost-headline">
            {(id) => (
              <input id={id} maxLength={40} className={inputClass} value={draft.texts.headline} onChange={(e) => setText('headline')(e.target.value)} />
            )}
          </Field>
          <Field label={t('ads_long_headline', 'Long headline')} id="boost-long-headline">
            {(id) => (
              <input id={id} maxLength={90} className={inputClass} value={draft.texts.longHeadline} onChange={(e) => setText('longHeadline')(e.target.value)} />
            )}
          </Field>
          <Field label={t('ads_description', 'Description')} id="boost-description">
            {(id) => (
              <input id={id} maxLength={90} className={inputClass} value={draft.texts.description} onChange={(e) => setText('description')(e.target.value)} />
            )}
          </Field>
          <Field label={t('ads_business_name', 'Business name')} id="boost-business-name">
            {(id) => (
              <input id={id} maxLength={25} className={inputClass} value={draft.texts.businessName} onChange={(e) => setText('businessName')(e.target.value)} />
            )}
          </Field>
        </>
      )}
    </div>
  );
};
