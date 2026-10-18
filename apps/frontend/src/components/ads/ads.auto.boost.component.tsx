'use client';

import { FC, FormEvent, useCallback, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';
import { Field, inputClass } from '@gitroom/frontend/components/ui/field';
import {
  AutoBoost,
  BoostAccountOption,
  useAdsAccounts,
  useAdsActions,
  useAdsFormat,
  useAdsProviders,
  useAutoBoosts,
} from '@gitroom/frontend/components/ads/use.ads';
import {
  BoostDraft,
  BoostFields,
  boostSettingsOf,
  newBoostDraft,
} from '@gitroom/frontend/components/ads/ads.boost.form';

interface Channel {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
  disabled: boolean;
}

const AutoBoostForm: FC<{ accounts: BoostAccountOption[]; channels: Channel[]; onDone: () => void }> = ({
  accounts,
  channels,
  onDone,
}) => {
  const t = useT();
  const toaster = useToaster();
  const { saveAutoBoost } = useAdsActions();
  const [integrationId, setIntegrationId] = useState(channels[0]?.id || '');
  const [draft, setDraft] = useState<BoostDraft>(() => newBoostDraft(accounts));
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const account = accounts.find((item) => item.id === draft.adAccountId);
      if (!account) {
        return;
      }
      setBusy(true);
      try {
        await saveAutoBoost(integrationId, boostSettingsOf(draft, account));
        toaster.show(t('ads_auto_boost_saved', 'New posts of this channel will be boosted'), 'success');
        onDone();
      } catch (err: unknown) {
        toaster.show(err instanceof Error ? err.message : String(err), 'warning');
      } finally {
        setBusy(false);
      }
    },
    [accounts, draft, integrationId, onDone]
  );

  return (
    <form data-testid="ads-auto-boost-form" className="flex flex-col gap-[16px]" onSubmit={submit}>
      <Field label={t('channel', 'Channel')} id="auto-boost-channel">
        {(id) => (
          <select id={id} data-testid="auto-boost-channel" className={inputClass} value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <BoostFields accounts={accounts} draft={draft} onChange={setDraft} />
      <div className="flex gap-[8px]">
        <PillButton type="submit" variant="primary" className="!h-[40px] !px-[16px] !text-[14px]" disabled={busy || !integrationId}>
          {t('save', 'Save')}
        </PillButton>
        <PillButton className="!h-[40px] !px-[16px] !text-[14px]" disabled={busy} onClick={onDone}>
          {t('cancel', 'Cancel')}
        </PillButton>
      </div>
    </form>
  );
};

const AutoBoostRow: FC<{ rule: AutoBoost }> = ({ rule }) => {
  const t = useT();
  const toaster = useToaster();
  const format = useAdsFormat();
  const { deleteAutoBoost } = useAdsActions();

  const remove = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('ads_remove_auto_boost_question', 'Stop boosting new posts of {{name}}? Boosts already running keep going.', {
          name: rule.integration.name,
          interpolation: { escapeValue: false },
        })
      ))
    ) {
      return;
    }
    try {
      await deleteAutoBoost(rule.id);
      toaster.show(t('ads_auto_boost_removed', 'Automatic boost turned off'), 'success');
    } catch (err: unknown) {
      toaster.show(err instanceof Error ? err.message : String(err), 'warning');
    }
  }, [rule]);

  return (
    <li data-testid="ads-auto-boost" className="flex flex-wrap items-center gap-[12px] py-[14px] border-t border-newBorder first:border-t-0">
      <ChannelIcon identifier={rule.integration.providerIdentifier} picture={rule.integration.picture} name={rule.integration.name} />
      <span className="flex-1 min-w-[180px] flex flex-col">
        <span className="text-[16px] font-[500] truncate">{rule.integration.name}</span>
        <span className="text-[13px] text-textItemBlur">
          {rule.adAccount.name} ·{' '}
          {rule.budgetType === 'daily'
            ? t('ads_per_day_for_days', '{{value}} per day for {{days}} days', {
                value: format.money(rule.budgetAmount, rule.adAccount.currency),
                days: rule.days,
              })
            : t('ads_total_for_days', '{{value}} in {{days}} days', {
                value: format.money(rule.budgetAmount, rule.adAccount.currency),
                days: rule.days,
              })}
        </span>
      </span>
      <PillButton className="!h-[40px] !px-[16px] !text-[14px]" onClick={remove}>
        {t('ads_remove', 'Remove')}
      </PillButton>
    </li>
  );
};

export const AutoBoostCard: FC = () => {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const { data: rules = [] } = useAutoBoosts();
  const { data: providers = [] } = useAdsProviders();
  const { data: adAccounts = [] } = useAdsAccounts();
  const { data: integrations = [] } = useIntegrationList();

  const accounts = useMemo<BoostAccountOption[]>(
    () =>
      adAccounts
        .filter((account) => !account.refreshNeeded)
        .flatMap((account) => {
          const provider = providers.find((item) => item.identifier === account.provider);
          return provider
            ? [{ id: account.id, name: account.name, provider: account.provider, currency: account.currency, capabilities: provider.boost }]
            : [];
        }),
    [adAccounts, providers]
  );
  const channels = useMemo(
    () => (integrations as Channel[]).filter((channel) => !channel.disabled && !rules.some((rule) => rule.integration.id === channel.id)),
    [integrations, rules]
  );

  return (
    <Card className="flex-[1_1_420px] min-w-0" testId="ads-auto-boosts">
      <CardHeader title={t('ads_auto_boost', 'Automatic boost')} meta={String(rules.length)} />
      <p className="m-0 text-[14px] text-textItemBlur">
        {t('ads_auto_boost_hint', 'Every new post of the channel is boosted with these settings, within the account rules.')}
      </p>
      {rules.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col">
          {rules.map((rule) => (
            <AutoBoostRow key={rule.id} rule={rule} />
          ))}
        </ul>
      )}
      {adding ? (
        <AutoBoostForm accounts={accounts} channels={channels} onDone={() => setAdding(false)} />
      ) : (
        <PillButton
          data-testid="ads-auto-boost-add"
          className="self-start !h-[40px] !px-[16px] !text-[14px]"
          disabled={!accounts.length || !channels.length}
          onClick={() => setAdding(true)}
        >
          {t('ads_add_auto_boost', 'Add channel')}
        </PillButton>
      )}
    </Card>
  );
};
