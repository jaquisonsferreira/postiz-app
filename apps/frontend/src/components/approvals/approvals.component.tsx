'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import {
  Composition,
  useCompositionActions,
  useCompositions,
  useCompositionSummary,
} from '@gitroom/frontend/components/approvals/use.compositions';
import { useLocalDate } from '@gitroom/frontend/components/dashboard/use.dashboard';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { StatusPill } from '@gitroom/frontend/components/ui/status.pill';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';

interface Channel {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
}

const Detail: FC<{ composition: Composition; channels: Channel[]; onDone: () => void }> = ({
  composition,
  channels,
  onDone,
}) => {
  const t = useT();
  const date = useLocalDate();
  const toaster = useToaster();
  const { approve, reject } = useCompositionActions();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<void>, success: string) => {
      setBusy(true);
      try {
        await action();
        toaster.show(success, 'success');
        onDone();
      } catch (err: unknown) {
        toaster.show(err instanceof Error ? err.message : String(err), 'warning');
      } finally {
        setBusy(false);
      }
    },
    [onDone]
  );

  const onApprove = useCallback(
    () => run(() => approve(composition.id), t('composition_approved', 'Composition approved and scheduled')),
    [composition.id, run]
  );

  const onReject = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('reject_composition_question', 'Reject this composition? Its drafts will be deleted.'),
        undefined,
        undefined,
        undefined,
        true
      ))
    ) {
      return;
    }
    await run(() => reject(composition.id), t('composition_rejected', 'Composition rejected'));
  }, [composition.id, run]);

  return (
    <div data-testid="approval-detail" className="flex-1 min-w-0 flex flex-col gap-[20px]">
      <div className="flex flex-wrap items-end gap-[16px]">
        <div className="flex-1 min-w-[260px] flex flex-col gap-[8px]">
          <span className="flex items-center gap-[10px]">
            <span className="text-[13px] uppercase tracking-[0.06em] text-textItemBlur">
              {t('composition', 'Composition')} · {t(`format_${composition.format}`, composition.format)}
            </span>
            <StatusPill status="awaiting_approval" />
          </span>
          <h2 className="m-0 text-[36px] mobile:text-[28px] leading-[1.15] font-[500] tracking-[-0.02em]">
            {composition.title}
          </h2>
          <p className="m-0 text-[17px] text-textItemBlur inline-block first-letter:uppercase">
            {t('scheduled_for', 'Scheduled for')} {date(composition.publishDate).format('dddd, D MMMM · HH:mm')}
          </p>
        </div>
        <div className="flex flex-wrap gap-[12px]">
          <PillButton disabled={busy} onClick={onReject}>
            {t('reject', 'Reject')}
          </PillButton>
          <PillButton variant="primary" disabled={busy} onClick={onApprove}>
            {t('approve_and_schedule', 'Approve and schedule')}
          </PillButton>
        </div>
      </div>

      {composition.media.length > 0 && (
        <Card>
          <CardHeader
            title={t('slides', 'Slides')}
            meta={String(composition.media.length)}
          />
          <div className="flex gap-[14px] overflow-x-auto pb-[4px]">
            {composition.media.map((media, index) => (
              <img
                key={media.id}
                src={media.path}
                alt={t('slide_position', 'Slide {{index}} of {{total}}', {
                  index: index + 1,
                  total: composition.media.length,
                })}
                className={clsx(
                  'shrink-0 rounded-[20px] object-cover bg-newBgColor',
                  composition.size === 'square' ? 'w-[220px] h-[220px]' : 'w-[216px] h-[270px]'
                )}
              />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t('captions', 'Captions')} meta={String(composition.targets.length)} />
        <ul className="m-0 p-0 list-none flex flex-col">
          {composition.targets.map((target, index) => {
            const channel = channels.find((item) => item.id === target.integrationId);
            return (
              <li key={`${target.integrationId}-${index}`} className="flex gap-[14px] py-[16px] border-t border-newBorder first:border-t-0">
                {channel && <ChannelIcon identifier={channel.identifier} picture={channel.picture} name={channel.name} />}
                <span className="flex-1 min-w-0 flex flex-col gap-[6px]">
                  <span className="text-[15px] font-[500]">{channel?.name || target.integrationId}</span>
                  <span className="text-[15px] leading-[1.5] whitespace-pre-line text-newTextColor/90">{target.content}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export const ApprovalsComponent: FC = () => {
  const t = useT();
  const date = useLocalDate();
  const summary = useCompositionSummary();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data: queue, isLoading } = useCompositions('awaiting_approval');
  const { data: channels = [] } = useIntegrationList();

  const selectedId = search.get('id');
  const selected = queue?.find((item) => item.id === selectedId) || queue?.[0];

  const select = useCallback(
    (id: string) => router.replace(`${pathname}?id=${id}`, { scroll: false }),
    [pathname]
  );
  const clearSelection = useCallback(() => router.replace(pathname, { scroll: false }), [pathname]);

  if (isLoading) {
    return null;
  }

  if (!queue?.length) {
    return (
      <div className="flex-1">
        <Card className="items-center text-center py-[64px]">
          <span className="text-[22px] font-[500]">{t('queue_empty', 'Queue is clear')}</span>
          <span className="text-[16px] text-textItemBlur">
            {t('no_pending_approvals', 'No composition is waiting for approval.')}
          </span>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex gap-[20px] items-start mobile:flex-col">
      <Card className="w-[360px] mobile:w-full shrink-0 !p-[16px] !gap-[8px]" testId="approval-queue">
        <div className="px-[12px] pt-[8px] pb-[4px]">
          <CardHeader title={t('queue', 'Queue')} meta={String(queue.length)} />
        </div>
        {queue.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => select(item.id)}
            aria-current={item.id === selected?.id ? 'true' : undefined}
            className={clsx(
              'text-start rounded-[22px] px-[16px] py-[14px] flex flex-col gap-[4px] transition-colors',
              item.id === selected?.id ? 'bg-newBgColor' : 'hover:bg-newBgColor/60'
            )}
          >
            <span className="text-[16px] font-[500] line-clamp-2">{item.title}</span>
            <span className="text-[13px] text-textItemBlur inline-block first-letter:uppercase">
              {date(item.publishDate).format('ddd, D MMM · HH:mm')} ·{' '}
              {summary(item)}
            </span>
          </button>
        ))}
      </Card>
      {selected && <Detail key={selected.id} composition={selected} channels={channels} onDone={clearSelection} />}
    </div>
  );
};
