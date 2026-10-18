'use client';

import { FC, FormEvent, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { PillButton, PillLink } from '@gitroom/frontend/components/ui/pill.button';
import { useAdsActions, useAdsFormat, useBoostOptions } from '@gitroom/frontend/components/ads/use.ads';
import {
  BoostDraft,
  BoostFields,
  boostSettingsOf,
  newBoostDraft,
} from '@gitroom/frontend/components/ads/ads.boost.form';

export const useBoostParam = () => {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return useCallback(
    (postId: string | null) => {
      const params = new URLSearchParams(search.toString());
      if (postId) {
        params.set('boost', postId);
      } else {
        params.delete('boost');
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, search]
  );
};

const BoostPostModal: FC<{ postId: string; close: () => void }> = ({ postId, close }) => {
  const t = useT();
  const toaster = useToaster();
  const format = useAdsFormat();
  const { createBoost } = useAdsActions();
  const { data, error, isLoading } = useBoostOptions(postId);
  const [draft, setDraft] = useState<BoostDraft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data && !draft) {
      setDraft(newBoostDraft(data.accounts));
    }
  }, [data]);

  const account = data?.accounts.find((item) => item.id === draft?.adAccountId);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!draft || !account) {
        return;
      }
      setBusy(true);
      try {
        const boost = await createBoost(postId, boostSettingsOf(draft, account));
        toaster.show(
          boost.status === 'awaiting_approval'
            ? t('ads_boost_waiting_approval', 'Boost sent for approval')
            : t('ads_boost_launching', 'Boost created, the ad goes live in a few minutes'),
          'success'
        );
        close();
      } catch (err: unknown) {
        toaster.show(err instanceof Error ? err.message : String(err), 'warning');
      } finally {
        setBusy(false);
      }
    },
    [draft, account, postId, close]
  );

  const amount = draft ? Math.round(Number(draft.amount.replace(',', '.')) * 100) : 0;
  const total = draft?.budgetType === 'daily' ? amount * Number(draft.days) : amount;

  return (
    <div data-testid="boost-modal" className="flex flex-col gap-[20px] w-[min(640px,calc(100vw-48px))]">
      <div className="flex items-center gap-[12px]">
        <span className="flex-1 text-[20px] font-[600]">{t('ads_boost_post', 'Boost post')}</span>
        <button
          type="button"
          aria-label={t('close', 'Close')}
          onClick={close}
          className="w-[40px] h-[40px] rounded-full flex items-center justify-center bg-newBgColor hover:bg-newBgLineColor"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {isLoading ? (
        <div className="min-h-[240px] flex items-center justify-center">
          <LoadingComponent />
        </div>
      ) : error ? (
        <p data-testid="boost-unavailable" className="m-0 text-[15px] text-textItemBlur">
          {error instanceof Error ? error.message : String(error)}
        </p>
      ) : !data?.accounts.length ? (
        <div data-testid="boost-no-account" className="flex flex-col gap-[16px] items-start">
          <p className="m-0 text-[15px] text-textItemBlur">
            {t('ads_boost_no_account', 'Connect an ad account that can promote posts of this channel first.')}
          </p>
          <PillLink href="/ads">{t('ads_go_to_ads', 'Go to Ads')}</PillLink>
        </div>
      ) : (
        draft && (
          <form className="flex flex-col gap-[20px]" onSubmit={submit}>
            <BoostFields accounts={data.accounts} draft={draft} onChange={setDraft} />
            <div className="flex flex-wrap items-center gap-[12px]">
              <span data-testid="boost-total" className="flex-1 min-w-[200px] text-[15px] text-textItemBlur">
                {account &&
                  t('ads_boost_total', 'Up to {{value}} in {{days}} days', {
                    value: format.money(Number.isFinite(total) ? total : 0, account.currency),
                    days: draft.days,
                  })}
              </span>
              <PillButton type="submit" variant="primary" disabled={busy}>
                {t('ads_boost', 'Boost')}
              </PillButton>
            </div>
          </form>
        )
      )}
    </div>
  );
};

export const BoostPost: FC = () => {
  const search = useSearchParams();
  const modals = useModals();
  const update = useBoostParam();
  const postId = search.get('boost');

  const closeBoost = useCallback(() => update(null), [update]);

  useEffect(() => {
    if (!postId) {
      return;
    }
    modals.openModal({
      id: 'boost-post',
      withCloseButton: false,
      onClose: closeBoost,
      classNames: { modal: 'text-textColor' },
      children: (close) => <BoostPostModal postId={postId} close={close} />,
    });
    return () => modals.closeById('boost-post');
  }, [postId]);

  return null;
};
