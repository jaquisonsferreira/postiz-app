'use client';

import React, { ReactNode, useCallback, useEffect, useState } from 'react';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { UserCard } from '@gitroom/frontend/components/new-layout/user.card';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
import { ShowMediaBoxModal } from '@gitroom/frontend/components/media/media.component';
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Impersonate } from '@gitroom/frontend/components/layout/impersonate';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { setSentryUser } from '@gitroom/react/sentry/initialize.sentry.client';

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user, mutate } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  useEffect(() => {
    setSentryUser(
      user ? { id: user.id, email: user.email, orgId: user.orgId } : null
    );
  }, [user]);

  if (!user) return null;

  return (
    <ContextWrapper user={user}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        useSingleEndpoint={true}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor bg-newBgColor'
              )}
            >
              <div>{user?.admin ? <Impersonate /> : <div />}</div>
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex-1 flex min-h-screen">
                    <Support />
                    {menuOpen && (
                      <div
                        className="hidden mobile:block fixed inset-0 bg-newBackdrop opacity-60 z-[490]"
                        onClick={() => setMenuOpen(false)}
                      />
                    )}
                    <aside
                      id="left-menu"
                      data-testid="sidebar"
                      className={clsx(
                        'w-[88px] mobile:w-[240px] shrink-0 bg-railBg flex flex-col items-center mobile:items-stretch gap-[28px] px-[18px] py-[22px] sticky top-0 h-screen overflow-y-auto mobile:fixed mobile:start-0 mobile:z-[491]',
                        !menuOpen && 'mobile:hidden'
                      )}
                      onClick={() => setMenuOpen(false)}
                    >
                      <Logo />
                      <TopMenu />
                    </aside>
                    <main className="flex-1 min-w-0 flex flex-col blurMe">
                      <header className="flex h-[96px] mobile:h-[72px] px-[32px] mobile:px-[16px] gap-[12px] items-center">
                        <button
                          type="button"
                          className="hidden mobile:flex items-center justify-center w-[44px] h-[44px] -ms-[6px] rounded-full bg-newBgColorInner text-newTextColor"
                          onClick={() => setMenuOpen(true)}
                          aria-label="Open menu"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M3 6H21M3 12H21M3 18H21"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                        <div className="text-[28px] mobile:text-[22px] font-[500] tracking-[-0.02em] flex flex-1 min-w-0">
                          <Title />
                        </div>
                        <div className="flex gap-[12px] items-center text-textItemBlur">
                          <div className="flex items-center gap-[16px] h-[52px] px-[18px] rounded-full bg-newBgColorInner mobile:hidden">
                            <OrganizationSelector />
                            <div className="hover:text-newTextColor">
                              <ModeComponent />
                            </div>
                            <LanguageComponent />
                            <AttachToFeedbackIcon />
                          </div>
                          <div className="w-[52px] h-[52px] rounded-full bg-newBgColorInner flex items-center justify-center text-newTextColor">
                            <NotificationComponent />
                          </div>
                          <UserCard />
                        </div>
                      </header>
                      <div className="flex flex-1 min-w-0 px-[32px] pb-[48px] mobile:px-[16px] mobile:flex-col">
                        {children}
                      </div>
                    </main>
                  </div>
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
