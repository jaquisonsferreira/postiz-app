'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { CustomVariables } from '@gitroom/frontend/components/launches/add.provider.component';

export interface RefreshableChannel {
  identifier: string;
  internalId: string;
  isCustomFields?: boolean;
  customFields?: { key: string; label: string; validation: string; type: 'text' | 'password' }[];
}

// Reconnecting goes through the provider's OAuth again, or, for providers that
// connect with credentials (Bluesky and similar), through the same form
export const useRefreshChannel = () => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const router = useRouter();

  return useCallback(
    (integration: RefreshableChannel) => async () => {
      if (integration.isCustomFields) {
        modal.openModal({
          title: t('custom_url', 'Custom URL'),
          withCloseButton: false,
          classNames: {
            modal: 'md',
          },
          children: (
            <CustomVariables
              identifier={integration.identifier}
              gotoUrl={(url: string) => router.push(url)}
              variables={integration.customFields || []}
            />
          ),
        });
        return;
      }

      const { url } = await (
        await fetch(`/integrations/social/${integration.identifier}?refresh=${integration.internalId}`, {
          method: 'GET',
        })
      ).json();
      window.location.href = url;
    },
    []
  );
};
