'use client';

import { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export type PostStatus =
  | 'QUEUE'
  | 'PUBLISHED'
  | 'ERROR'
  | 'DRAFT'
  | 'awaiting_approval'
  | 'scheduled'
  | 'failed'
  | 'processing';

const styles: Record<PostStatus, string> = {
  QUEUE: 'bg-statusScheduledBg text-statusScheduledText',
  scheduled: 'bg-statusScheduledBg text-statusScheduledText',
  PUBLISHED: 'bg-statusPublishedBg text-statusPublishedText',
  ERROR: 'bg-statusErrorBg text-statusErrorText',
  failed: 'bg-statusErrorBg text-statusErrorText',
  DRAFT: 'bg-statusDraftBg text-statusDraftText',
  processing: 'bg-statusDraftBg text-statusDraftText',
  awaiting_approval: 'bg-statusPendingBg text-statusPendingText',
};

export const useStatusLabel = () => {
  const t = useT();
  return (status: PostStatus): string =>
    ({
      QUEUE: t('status_scheduled', 'Scheduled'),
      scheduled: t('status_scheduled', 'Scheduled'),
      PUBLISHED: t('status_published', 'Published'),
      ERROR: t('status_error', 'Error'),
      failed: t('status_error', 'Error'),
      DRAFT: t('status_draft', 'Draft'),
      processing: t('status_processing', 'Processing'),
      awaiting_approval: t('status_awaiting_approval', 'Awaiting approval'),
    })[status];
};

export const StatusPill: FC<{ status: PostStatus }> = ({ status }) => {
  const label = useStatusLabel();
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-[6px] h-[28px] px-[10px] rounded-full text-[13px] font-[500] whitespace-nowrap',
        styles[status]
      )}
    >
      <span className="w-[6px] h-[6px] rounded-full bg-current" aria-hidden="true" />
      {label(status)}
    </span>
  );
};
