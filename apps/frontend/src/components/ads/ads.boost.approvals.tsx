'use client';

import { FC, useCallback, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';
import { Boost, useAdsActions, useAdsFormat, useBoosts } from '@gitroom/frontend/components/ads/use.ads';

const BoostApproval: FC<{ boost: Boost }> = ({ boost }) => {
  const t = useT();
  const toaster = useToaster();
  const format = useAdsFormat();
  const { approveBoost, rejectBoost } = useAdsActions();
  const [busy, setBusy] = useState(false);
  const total = boost.budgetType === 'daily' ? boost.budgetAmount * boost.days : boost.budgetAmount;
  const origin: Record<Boost['origin'], string> = {
    manual: t('ads_origin_manual', 'Created in Pauta'),
    agent: t('ads_origin_agent', 'Proposed by the agent'),
    auto: t('ads_origin_auto', 'Automatic boost'),
  };

  const run = useCallback(async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      toaster.show(success, 'success');
    } catch (err: unknown) {
      toaster.show(err instanceof Error ? err.message : String(err), 'warning');
    } finally {
      setBusy(false);
    }
  }, []);

  const approve = useCallback(
    () => run(() => approveBoost(boost.id), t('ads_boost_approved', 'Boost approved, the ad goes live in a few minutes')),
    [boost, run]
  );

  const reject = useCallback(async () => {
    if (!(await deleteDialog(t('ads_reject_boost_question', 'Reject this boost? Nothing is spent.'), undefined, undefined, undefined, true))) {
      return;
    }
    await run(() => rejectBoost(boost.id), t('ads_boost_rejected', 'Boost rejected'));
  }, [boost, run]);

  return (
    <li data-testid="boost-approval" className="flex flex-wrap items-center gap-[14px] py-[16px] border-t border-newBorder first:border-t-0">
      <ChannelIcon identifier={boost.post.integration.providerIdentifier} picture={boost.post.integration.picture} name={boost.post.integration.name} />
      <span className="flex-1 min-w-[220px] flex flex-col gap-[4px]">
        <span className="text-[15px] leading-[1.5] line-clamp-2 break-words">{stripHtmlValidation('none', boost.post.content)}</span>
        <span className="text-[13px] text-textItemBlur">
          {boost.adAccount.name} · {origin[boost.origin]} ·{' '}
          {t('ads_boost_total', 'Up to {{value}} in {{days}} days', {
            value: format.money(total, boost.adAccount.currency),
            days: boost.days,
          })}
        </span>
      </span>
      <span className="flex gap-[8px]">
        <PillButton className="!h-[40px] !px-[16px] !text-[14px]" disabled={busy} onClick={reject}>
          {t('reject', 'Reject')}
        </PillButton>
        <PillButton variant="primary" className="!h-[40px] !px-[16px] !text-[14px]" disabled={busy} onClick={approve}>
          {t('approve', 'Approve')}
        </PillButton>
      </span>
    </li>
  );
};

export const BoostApprovals: FC = () => {
  const t = useT();
  const { data: boosts = [] } = useBoosts('awaiting_approval');

  if (!boosts.length) {
    return null;
  }

  return (
    <Card testId="boost-approvals">
      <CardHeader title={t('ads_boosts_awaiting_approval', 'Boosts awaiting approval')} meta={String(boosts.length)} />
      <ul className="m-0 p-0 list-none flex flex-col">
        {boosts.map((boost) => (
          <BoostApproval key={boost.id} boost={boost} />
        ))}
      </ul>
    </Card>
  );
};
