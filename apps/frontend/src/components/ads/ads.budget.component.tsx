'use client';

import { FC, FormEvent, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { Field, inputClass } from '@gitroom/frontend/components/ui/field';
import {
  AdsAccountBudget,
  useAdsActions,
  useAdsBudget,
  useAdsFormat,
} from '@gitroom/frontend/components/ads/use.ads';

const toCents = (value: string) =>
  value.trim() ? Math.round(Number(value.replace(',', '.')) * 100) : null;
const fromCents = (value: number | null | undefined) => (value ? String(value / 100) : '');

const RuleForm: FC<{ account: AdsAccountBudget; onDone: () => void }> = ({ account, onDone }) => {
  const t = useT();
  const toaster = useToaster();
  const { saveRule } = useAdsActions();
  const [busy, setBusy] = useState(false);
  const [monthlyCap, setMonthlyCap] = useState(fromCents(account.rule?.monthlyCap));
  const [approvalThreshold, setApprovalThreshold] = useState(fromCents(account.rule?.approvalThreshold));
  const [alertAt, setAlertAt] = useState(account.rule?.alertAt ? String(account.rule.alertAt) : '');

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      try {
        await saveRule(account.accountId, {
          monthlyCap: toCents(monthlyCap),
          approvalThreshold: toCents(approvalThreshold),
          alertAt: alertAt.trim() ? Number(alertAt) : null,
        });
        toaster.show(t('ads_rule_saved', 'Budget rule saved'), 'success');
        onDone();
      } catch (err: unknown) {
        toaster.show(err instanceof Error ? err.message : String(err), 'warning');
      } finally {
        setBusy(false);
      }
    },
    [account, monthlyCap, approvalThreshold, alertAt, onDone]
  );

  return (
    <form data-testid="ads-rule-form" className="flex flex-col gap-[16px] pt-[8px]" onSubmit={submit}>
      <div className="grid grid-cols-3 mobile:grid-cols-1 gap-[12px]">
        <Field label={t('ads_monthly_cap_in', 'Monthly cap in {{currency}}', { currency: account.currency })} id={`cap-${account.accountId}`}>
          {(id) => <input id={id} inputMode="decimal" className={inputClass} value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} />}
        </Field>
        <Field label={t('ads_approval_above_in', 'Approval above, in {{currency}}', { currency: account.currency })} id={`approval-${account.accountId}`}>
          {(id) => (
            <input id={id} inputMode="decimal" className={inputClass} value={approvalThreshold} onChange={(e) => setApprovalThreshold(e.target.value)} />
          )}
        </Field>
        <Field label={t('ads_alert_at', 'Alert at (% of the cap)')} id={`alert-${account.accountId}`}>
          {(id) => <input id={id} type="number" min={1} max={100} className={inputClass} value={alertAt} onChange={(e) => setAlertAt(e.target.value)} />}
        </Field>
      </div>
      <div className="flex gap-[8px]">
        <PillButton type="submit" variant="primary" className="!h-[40px] !px-[16px] !text-[14px]" disabled={busy}>
          {t('save', 'Save')}
        </PillButton>
        <PillButton className="!h-[40px] !px-[16px] !text-[14px]" disabled={busy} onClick={onDone}>
          {t('cancel', 'Cancel')}
        </PillButton>
      </div>
    </form>
  );
};

const AccountBudget: FC<{ account: AdsAccountBudget }> = ({ account }) => {
  const t = useT();
  const toaster = useToaster();
  const format = useAdsFormat();
  const { deleteRule } = useAdsActions();
  const [editing, setEditing] = useState(false);
  const cap = account.rule?.monthlyCap;
  const used = cap ? Math.min(1, account.monthSpend / cap) : 0;

  const remove = useCallback(async () => {
    if (!(await deleteDialog(t('ads_remove_rule_question', 'Remove the budget rule of {{name}}?', { name: account.name, interpolation: { escapeValue: false } })))) {
      return;
    }
    try {
      await deleteRule(account.accountId);
      toaster.show(t('ads_rule_removed', 'Budget rule removed'), 'success');
    } catch (err: unknown) {
      toaster.show(err instanceof Error ? err.message : String(err), 'warning');
    }
  }, [account]);

  return (
    <li data-testid="ads-budget-account" className="flex flex-col gap-[10px] py-[14px] border-t border-newBorder first:border-t-0">
      <div className="flex flex-wrap items-center gap-[12px]">
        <span className="flex-1 min-w-[180px] flex flex-col">
          <span className="text-[16px] font-[500] truncate">{account.name}</span>
          <span data-testid="ads-budget-summary" className="text-[13px] text-textItemBlur">
            {cap
              ? t('ads_spent_of_cap', '{{spent}} of {{cap}} this month', {
                  spent: format.money(account.monthSpend, account.currency),
                  cap: format.money(cap, account.currency),
                })
              : t('ads_spent_this_month', '{{spent}} this month, no cap', {
                  spent: format.money(account.monthSpend, account.currency),
                })}
            {account.rule?.approvalThreshold
              ? ` · ${t('ads_approval_above', 'Approval above {{value}}', {
                  value: format.money(account.rule.approvalThreshold, account.currency),
                })}`
              : ''}
          </span>
        </span>
        {!editing && (
          <span className="flex gap-[8px]">
            <PillButton className="!h-[40px] !px-[16px] !text-[14px]" onClick={() => setEditing(true)}>
              {account.rule ? t('ads_edit_rule', 'Edit rule') : t('ads_add_rule', 'Add rule')}
            </PillButton>
            {account.rule && (
              <PillButton className="!h-[40px] !px-[16px] !text-[14px]" onClick={remove}>
                {t('ads_remove', 'Remove')}
              </PillButton>
            )}
          </span>
        )}
      </div>
      {cap ? (
        <div
          className="h-[8px] rounded-full bg-newBgColor overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(used * 100)}
        >
          <span
            className={clsx('block h-full rounded-full', used >= 1 ? 'bg-statusErrorText' : 'bg-accent')}
            style={{ width: `${used * 100}%` }}
          />
        </div>
      ) : null}
      {editing && <RuleForm account={account} onDone={() => setEditing(false)} />}
    </li>
  );
};

export const BudgetCard: FC = () => {
  const t = useT();
  const { data: accounts = [] } = useAdsBudget();

  return (
    <Card className="flex-[1_1_420px] min-w-0" testId="ads-budget">
      <CardHeader title={t('ads_monthly_budget', 'Monthly budget')} />
      <p className="m-0 text-[14px] text-textItemBlur">
        {t('ads_monthly_budget_hint', 'Reaching the cap pauses every campaign of the account until the next month.')}
      </p>
      <ul className="m-0 p-0 list-none flex flex-col">
        {accounts.map((account) => (
          <AccountBudget key={account.accountId} account={account} />
        ))}
      </ul>
    </Card>
  );
};
