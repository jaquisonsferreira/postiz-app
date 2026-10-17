'use client';

import { FC, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { usePendingApprovals } from '@gitroom/frontend/components/approvals/use.compositions';
import {
  CalendarPost,
  useLocalDate,
  usePostsBetween,
} from '@gitroom/frontend/components/dashboard/use.dashboard';
import { PillTabs } from '@gitroom/frontend/components/ui/pill.tabs';
import { PillLink } from '@gitroom/frontend/components/ui/pill.button';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { StatusPill } from '@gitroom/frontend/components/ui/status.pill';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';

const PERIODS = { '7d': 7, '30d': 30, '90d': 90 } as const;
type Period = keyof typeof PERIODS;
const UPCOMING_DAYS = 14;

const postTitle = (post: CalendarPost) =>
  stripHtmlValidation('none', post.content || '').trim() || post.integration.name;

const Kpi: FC<{ label: string; value: number; hint: string }> = ({ label, value, hint }) => (
  <div data-testid="kpi" className="flex-1 min-w-[200px] bg-newBgColorInner rounded-[32px] p-[26px] flex flex-col gap-[6px]">
    <span className="text-[15px] text-textItemBlur">{label}</span>
    <span data-testid="kpi-value" className="text-[44px] leading-[1.1] font-[500] tracking-[-0.02em]">
      {value}
    </span>
    <span className="text-[14px] text-textItemBlur">{hint}</span>
  </div>
);

export const DashboardComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const date = useLocalDate();
  const search = useSearchParams();
  const period: Period = (search.get('period') as Period) in PERIODS ? (search.get('period') as Period) : '7d';

  const range = useMemo(
    () => ({
      start: date().subtract(PERIODS['90d'], 'day').startOf('day').toISOString(),
      end: date().add(UPCOMING_DAYS, 'day').endOf('day').toISOString(),
    }),
    [date]
  );
  const { data: posts = [] } = usePostsBetween(range.start, range.end);
  const { data: integrations = [] } = useIntegrationList();
  const pendingApprovals = usePendingApprovals();

  const changePeriod = useCallback(
    (next: string) => {
      const params = new URLSearchParams(search.toString());
      params.set('period', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [search, pathname]
  );

  const stats = useMemo(() => {
    const now = date();
    const from = now.subtract(PERIODS[period], 'day');
    const published = posts.filter(
      (post) => post.state === 'PUBLISHED' && date(post.publishDate).isAfter(from) && date(post.publishDate).isBefore(now)
    );
    const upcoming = posts
      .filter((post) => post.state === 'QUEUE' && date(post.publishDate).isAfter(now))
      .sort((a, b) => date(a.publishDate).valueOf() - date(b.publishDate).valueOf());
    const today = upcoming.filter((post) => date(post.publishDate).isSame(now, 'day'));
    const weeks = Math.ceil(PERIODS[period] / 7);
    const perWeek = Array.from({ length: weeks }, (_, index) => {
      const weekStart = now.subtract((weeks - index) * 7, 'day');
      const weekEnd = weekStart.add(7, 'day');
      return {
        label: weekStart.format('DD/MM'),
        value: published.filter(
          (post) => !date(post.publishDate).isBefore(weekStart) && date(post.publishDate).isBefore(weekEnd)
        ).length,
      };
    });
    return { published, upcoming, today, perWeek };
  }, [posts, period, date]);

  const activeChannels = integrations.filter((integration: { disabled: boolean }) => !integration.disabled).length;
  const maxWeek = Math.max(1, ...stats.perWeek.map((week) => week.value));
  const hour = date().hour();
  const greeting =
    hour < 12 ? t('good_morning', 'Good morning') : hour < 18 ? t('good_afternoon', 'Good afternoon') : t('good_evening', 'Good evening');
  const firstName = (user?.name || user?.email?.split('@')[0] || '').split(' ')[0];

  return (
    <div className="flex-1 flex flex-col gap-[24px]">
      <div className="flex flex-wrap items-end gap-[16px]">
        <div className="flex-1 min-w-[280px] flex flex-col gap-[8px]">
          <span className="text-[13px] uppercase tracking-[0.06em] text-textItemBlur">
            {t('overview', 'Overview')} · {date().format('dddd, D MMMM')}
          </span>
          <h2 className="m-0 text-[44px] mobile:text-[32px] leading-[1.1] font-[500] tracking-[-0.02em]">
            {greeting}, {firstName}
          </h2>
          <p className="m-0 text-[18px] text-textItemBlur">
            {t('dashboard_summary', '{{scheduled}} posts scheduled for today · {{pending}} awaiting your approval', {
              scheduled: stats.today.length,
              pending: pendingApprovals,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-[12px]">
          <PillLink href="/launches">{t('see_calendar', 'See calendar')}</PillLink>
          <PillLink href="/editor" variant="primary">
            {t('create_post', 'Create post')}
          </PillLink>
        </div>
      </div>

      {pendingApprovals > 0 && (
        <div className="flex flex-wrap items-center gap-[20px] rounded-[32px] bg-accentSoft px-[24px] py-[20px]">
          <span className="w-[48px] h-[48px] rounded-[14px] bg-newBgColorInner text-accentText flex items-center justify-center" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12l3 3 5-6" />
            </svg>
          </span>
          <div className="flex-1 min-w-[220px] flex flex-col gap-[4px]">
            <span className="text-[18px] font-[500] text-accentText">
              {t('pending_approvals_title', '{{total}} compositions awaiting your approval', { total: pendingApprovals })}
            </span>
            <span className="text-[15px] text-newTextColor/80">
              {t('pending_approvals_hint', 'Review the slides and captions before they are scheduled.')}
            </span>
          </div>
          <PillLink href="/approvals" className="!border-0">
            {t('review', 'Review')}
          </PillLink>
        </div>
      )}

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
        <div className="flex flex-wrap gap-[16px]">
          <Kpi label={t('kpi_published', 'Published')} value={stats.published.length} hint={t('in_selected_period', 'In the selected period')} />
          <Kpi label={t('kpi_scheduled', 'Scheduled')} value={stats.upcoming.length} hint={t('next_14_days', 'Next 14 days')} />
          <Kpi label={t('status_awaiting_approval', 'Awaiting approval')} value={pendingApprovals} hint={t('compositions', 'Compositions')} />
          <Kpi label={t('kpi_channels', 'Connected channels')} value={activeChannels} hint={t('active_channels', 'Active channels')} />
        </div>
      </div>

      <div className="flex flex-wrap gap-[16px] items-start">
        <Card className="flex-[2_1_520px] min-w-0" testId="upcoming-posts">
          <CardHeader
            title={t('upcoming_posts', 'Upcoming posts')}
            meta={t('next_14_days', 'Next 14 days')}
          />
          {stats.upcoming.length === 0 ? (
            <p className="m-0 text-[15px] text-textItemBlur">
              {t('no_upcoming_posts', 'Nothing scheduled yet. Create a post or approve a composition.')}
            </p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col">
              {stats.upcoming.slice(0, 6).map((post) => (
                <li key={post.id} className="flex items-center gap-[16px] py-[14px] border-t border-newBorder first:border-t-0">
                  <span className="w-[72px] shrink-0 flex flex-col">
                    <span className="text-[15px] font-[500] capitalize">{date(post.publishDate).format('ddd D')}</span>
                    <span className="text-[13px] text-textItemBlur">{date(post.publishDate).format('HH:mm')}</span>
                  </span>
                  <ChannelIcon identifier={post.integration.providerIdentifier} picture={post.integration.picture} name={post.integration.name} />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[16px] truncate">{postTitle(post)}</span>
                    <span className="text-[13px] text-textItemBlur truncate">{post.integration.name}</span>
                  </span>
                  <StatusPill status={post.state} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex-[1_1_320px] min-w-0">
          <CardHeader title={t('published_per_week', 'Published per week')} />
          <div className="flex items-end gap-[8px] h-[160px]" role="img" aria-label={t('published_per_week', 'Published per week')}>
            {stats.perWeek.map((week) => (
              <div key={week.label} className="flex-1 flex flex-col items-center gap-[6px] h-full justify-end">
                <span className="text-[12px] text-textItemBlur">{week.value}</span>
                <span
                  className="w-full max-w-[36px] rounded-[10px] bg-accent"
                  style={{ height: `${Math.max(4, (week.value / maxWeek) * 120)}px` }}
                />
                <span className="text-[11px] text-textItemBlur">{week.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
