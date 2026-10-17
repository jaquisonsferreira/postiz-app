'use client';

import { PillLink } from '@gitroom/frontend/components/ui/pill.button';
import { useEffect, useMemo } from 'react';
import { orderBy } from 'lodash';
import { CalendarWeekProvider } from '@gitroom/frontend/components/launches/calendar.context';
import { Filters } from '@gitroom/frontend/components/launches/filters';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useUser } from '../layout/user.context';
import { useSearchParams } from 'next/navigation';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { Calendar } from './calendar';
import { DNDProvider } from '@gitroom/frontend/components/launches/helpers/dnd.provider';
import { GeneratorComponent } from './generator/generator';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { NewPost } from '@gitroom/frontend/components/launches/new.post';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { Onboarding } from '@gitroom/frontend/components/onboarding/onboarding';
import { ChannelsAfterPayment } from '@gitroom/frontend/components/layout/check.payment';
import { HubspotInstalled } from '@gitroom/frontend/components/launches/hubspot.installed';

export const SVGLine = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="5"
      height="52"
      viewBox="0 0 5 52"
      fill="none"
      className="rtl:rotate-180"
    >
      <path
        d="M0.5 4C0.5 1.79086 2.29086 0 4.5 0V52C2.29086 52 0.5 50.2091 0.5 48V4Z"
        fill="url(#paint0_linear_1930_1119)"
      />
      <path
        d="M0.5 4C0.5 1.79086 2.29086 0 4.5 0V52C2.29086 52 0.5 50.2091 0.5 48V4Z"
        fill="url(#paint1_radial_1930_1119)"
      />
      <defs>
        <linearGradient
          id="paint0_linear_1930_1119"
          x1="-7"
          y1="-27.7727"
          x2="-2.58929"
          y2="-28.6843"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#662FDA" />
          <stop offset="1" stopColor="#5720CB" />
        </linearGradient>
        <radialGradient
          id="paint1_radial_1930_1119"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(1.19333 7.45342) rotate(21.2064) scale(16.1503 188.627)"
        >
          <stop stopColor="#8C66FF" />
          <stop offset="1" stopColor="#8C66FF" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
};
export const LaunchesComponent = () => {
  const user = useUser();
  const { billingEnabled } = useVariables();
  const search = useSearchParams();
  const toast = useToaster();
  const fireEvents = useFireEvents();
  const t = useT();
  const { isLoading, data: integrations } = useIntegrationList();

  const sortedIntegrations = useMemo(() => {
    return orderBy(
      integrations,
      ['type', 'disabled', 'identifier'],
      ['desc', 'asc', 'asc']
    );
  }, [integrations]);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (search.get('msg')) {
      toast.show(search.get('msg')!, 'success');
      window?.opener?.postMessage(
        {
          msg: search.get('msg')!,
          success: false,
        },
        '*'
      );
    }
    if (search.get('added')) {
      fireEvents('channel_added');
      window?.opener?.postMessage(
        {
          msg: t('channel_added', 'Channel added'),
          success: true,
        },
        '*'
      );
    }
    if (window.opener) {
      window.close();
    }
  }, []);
  if (isLoading) {
    return (
      <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all items-center justify-center">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <DNDProvider>
      <Onboarding />
      <ChannelsAfterPayment integrations={integrations} />
      <HubspotInstalled />
      <CalendarWeekProvider integrations={sortedIntegrations}>
        <div className="flex-1 min-w-0 flex flex-col gap-[20px]">
          <div className="flex flex-wrap items-center gap-[12px]">
            <div className="flex-1 min-w-0">
              <Filters />
            </div>
            {sortedIntegrations.length > 0 ? (
              <>
                {user?.tier?.ai && billingEnabled && <GeneratorComponent />}
                <NewPost />
              </>
            ) : (
              <PillLink href="/accounts" variant="primary">
                {t('connect_channel', 'Connect a channel')}
              </PillLink>
            )}
          </div>
          <div className="flex-1 flex min-h-[600px] bg-newBgColorInner rounded-[32px] p-[20px] mobile:p-[12px]">
            <Calendar />
          </div>
        </div>
      </CalendarWeekProvider>
    </DNDProvider>
  );
};
