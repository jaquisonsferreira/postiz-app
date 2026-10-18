'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { PillButton, PillLink } from '@gitroom/frontend/components/ui/pill.button';
import { AdsAccountOption, useAdsActions } from '@gitroom/frontend/components/ads/use.ads';

export const AdsConnectComponent: FC<{ provider: string; code?: string; state?: string }> = ({
  provider,
  code,
  state,
}) => {
  const t = useT();
  const router = useRouter();
  const toaster = useToaster();
  const { connect, saveAccounts } = useAdsActions();
  const started = useRef(false);
  const [connection, setConnection] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AdsAccountOption[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The login state is single use, a second request would always be refused
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    if (!code || !state) {
      setError(t('ads_login_cancelled', 'The login was cancelled or did not return to Pauta.'));
      return;
    }
    connect(provider, code, state)
      .then((result) => {
        setConnection(result.connection);
        setAccounts(result.accounts);
        setChosen(result.accounts.map((account) => account.externalId));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const toggle = useCallback(
    (externalId: string) => () =>
      setChosen((current) =>
        current.includes(externalId)
          ? current.filter((item) => item !== externalId)
          : [...current, externalId]
      ),
    []
  );

  const save = useCallback(async () => {
    if (!connection) {
      return;
    }
    setSaving(true);
    try {
      await saveAccounts(connection, chosen);
      toaster.show(t('ads_accounts_connected', 'Ad accounts connected'), 'success');
      router.push('/ads');
    } catch (err: unknown) {
      toaster.show(err instanceof Error ? err.message : String(err), 'warning');
      setSaving(false);
    }
  }, [connection, chosen]);

  if (error) {
    return (
      <div className="flex-1">
        <Card className="items-center text-center py-[64px]" testId="ads-connect-error">
          <span className="text-[22px] font-[500]">{t('ads_connect_failed', 'Could not connect the ad account')}</span>
          <span className="text-[16px] text-textItemBlur max-w-[520px] break-words">{error}</span>
          <PillLink href="/ads">{t('ads_back', 'Back to Ads')}</PillLink>
        </Card>
      </div>
    );
  }

  if (!connection) {
    return <LoadingComponent />;
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-[24px]">
      <Card testId="ads-connect-accounts">
        <CardHeader title={t('ads_choose_accounts', 'Choose the ad accounts to follow')} meta={String(accounts.length)} />
        {accounts.length === 0 ? (
          <p className="m-0 text-[15px] text-textItemBlur">
            {t('ads_no_accounts_found', 'This login has no ad account. Check your access on the platform and try again.')}
          </p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col">
            {accounts.map((account) => (
              <li key={account.externalId} className="border-t border-newBorder first:border-t-0">
                <label className="flex items-center gap-[14px] py-[14px] cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-[20px] h-[20px] accent-[var(--accent)]"
                    checked={chosen.includes(account.externalId)}
                    onChange={toggle(account.externalId)}
                  />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[16px] font-[500] truncate">{account.name}</span>
                    <span className="text-[13px] text-textItemBlur">
                      {account.externalId} · {account.currency} · {account.timezone}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-[12px]">
          <PillLink href="/ads">{t('cancel', 'Cancel')}</PillLink>
          <PillButton variant="primary" disabled={saving || chosen.length === 0} onClick={save}>
            {t('ads_save_accounts', 'Save accounts')}
          </PillButton>
        </div>
      </Card>
    </div>
  );
};
