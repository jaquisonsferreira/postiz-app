'use client';

import { FC, ReactNode, useCallback } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { CalendarWeekProvider } from '@gitroom/frontend/components/launches/calendar.context';
import { usePostActions } from '@gitroom/frontend/components/launches/calendar';
import {
  useCompositions,
  useCompositionSummary,
  usePendingApprovals,
} from '@gitroom/frontend/components/approvals/use.compositions';
import { PostsListState, usePostsList } from '@gitroom/frontend/components/posts/use.posts.list';
import { CalendarPost, useLocalDate } from '@gitroom/frontend/components/dashboard/use.dashboard';
import { PillTabs } from '@gitroom/frontend/components/ui/pill.tabs';
import { StatusPill } from '@gitroom/frontend/components/ui/status.pill';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';
import { NewPost } from '@gitroom/frontend/components/launches/new.post';

const TABS = ['all', 'draft', 'approval', 'scheduled', 'published'] as const;
type Tab = (typeof TABS)[number];

const ActionButton: FC<{ label: string; onClick: () => void; children: ReactNode; danger?: boolean }> = ({
  label,
  onClick,
  children,
  danger,
}) => (
  <button
    type="button"
    aria-label={label}
    data-tooltip-id="tooltip"
    data-tooltip-content={label}
    onClick={onClick}
    className={clsx(
      'w-[40px] h-[40px] rounded-full flex items-center justify-center bg-newBgColor hover:bg-newBgLineColor',
      danger ? 'text-statusErrorText' : 'text-newTextColor'
    )}
  >
    {children}
  </button>
);

const PostCard: FC<{ post: CalendarPost; onChange: () => void }> = ({ post, onChange }) => {
  const t = useT();
  const date = useLocalDate();
  const { editPost, deletePost } = usePostActions(onChange);
  const title = stripHtmlValidation('none', post.content || '').trim() || t('no_content', 'no content');

  return (
    <article data-testid="post-card" className="bg-newBgColorInner rounded-[28px] p-[22px] flex flex-col gap-[16px]">
      <div className="flex items-center gap-[12px]">
        <ChannelIcon identifier={post.integration.providerIdentifier} picture={post.integration.picture} name={post.integration.name} />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[15px] font-[500] truncate">{post.integration.name}</span>
          <span className="text-[13px] text-textItemBlur inline-block first-letter:uppercase">
            {date(post.publishDate).format('ddd, D MMM · HH:mm')}
          </span>
        </span>
        <StatusPill status={post.state} />
      </div>
      <p className="m-0 text-[16px] leading-[1.45] line-clamp-3 min-h-[69px]">{title}</p>
      <div className="flex items-center gap-[8px]">
        <ActionButton label={t('edit', 'Edit')} onClick={editPost(post)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16v4z" />
          </svg>
        </ActionButton>
        <ActionButton label={t('duplicate', 'Duplicate')} onClick={editPost(post, true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 012-2h10" />
          </svg>
        </ActionButton>
        <ActionButton label={t('preview', 'Preview')} onClick={() => window.open(`/p/${post.id}?share=true`, '_blank')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </ActionButton>
        <span className="flex-1" />
        <ActionButton danger label={t('delete_post', 'Delete Post')} onClick={deletePost(post)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </ActionButton>
      </div>
    </article>
  );
};

const EmptyState: FC<{ text: string }> = ({ text }) => (
  <div className="bg-newBgColorInner rounded-[32px] p-[48px] text-center text-[16px] text-textItemBlur">{text}</div>
);

const PostsInner: FC = () => {
  const t = useT();
  const date = useLocalDate();
  const summary = useCompositionSummary();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const tab: Tab = TABS.includes(search.get('status') as Tab) ? (search.get('status') as Tab) : 'all';
  const listState: PostsListState = tab === 'approval' ? 'all' : tab;

  const all = usePostsList('all', 1);
  const drafts = usePostsList('draft', 1);
  const scheduled = usePostsList('scheduled', 1);
  const published = usePostsList('published', 1);
  const pending = useCompositions('awaiting_approval');
  const pendingTotal = usePendingApprovals();
  const list = usePostsList(listState);

  const refresh = useCallback(() => {
    list.mutate();
    all.mutate();
    drafts.mutate();
    scheduled.mutate();
    published.mutate();
  }, [list, all, drafts, scheduled, published]);

  const changeTab = useCallback(
    (next: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('status', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [search, pathname]
  );

  return (
    <div className="flex-1 flex flex-col gap-[20px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <div className="flex-1 min-w-0">
          <PillTabs
            label={t('post_status', 'Post status')}
            value={tab}
            onChange={changeTab}
            items={[
              { id: 'all', label: t('upcoming', 'Upcoming'), count: all.data?.total ?? 0 },
              { id: 'draft', label: t('drafts', 'Drafts'), count: drafts.data?.total ?? 0 },
              { id: 'approval', label: t('status_awaiting_approval', 'Awaiting approval'), count: pendingTotal },
              { id: 'scheduled', label: t('kpi_scheduled', 'Scheduled'), count: scheduled.data?.total ?? 0 },
              { id: 'published', label: t('kpi_published', 'Published'), count: published.data?.total ?? 0 },
            ]}
          />
        </div>
        <NewPost />
      </div>

      {tab === 'approval' ? (
        !pending.data?.length ? (
          <EmptyState text={t('no_pending_approvals', 'No composition is waiting for approval.')} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-[16px]">
            {pending.data.map((composition) => (
              <Link
                key={composition.id}
                href={`/approvals?id=${composition.id}`}
                className="bg-newBgColorInner rounded-[28px] p-[22px] flex flex-col gap-[12px] hover:ring-2 hover:ring-newBorder"
              >
                <span className="flex items-center justify-between gap-[12px]">
                  <span className="text-[13px] text-textItemBlur inline-block first-letter:uppercase">
                    {date(composition.publishDate).format('ddd, D MMM · HH:mm')}
                  </span>
                  <StatusPill status="awaiting_approval" />
                </span>
                <span className="text-[17px] font-[500]">{composition.title}</span>
                <span className="text-[13px] text-textItemBlur">
                  {summary(composition)}
                </span>
              </Link>
            ))}
          </div>
        )
      ) : !list.data?.posts?.length ? (
        <EmptyState text={t('no_posts_in_status', 'No posts here yet. Create a post or approve a composition.')} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-[16px]">
          {list.data.posts.map((post) => (
            <PostCard key={post.id} post={post} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  );
};

export const PostsComponent: FC = () => {
  const { data: integrations = [] } = useIntegrationList();
  return (
    <CalendarWeekProvider integrations={integrations}>
      <PostsInner />
    </CalendarWeekProvider>
  );
};
