'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useVariables } from '@gitroom/react/helpers/variable.context';

// Disable, enable and delete a channel, shared by the channel menu and the
// connected accounts screen. Each action resolves to true when it was applied
export const useChannelActions = (id: string) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const { extensionId } = useVariables();

  const failed = useCallback(
    async (response: Response) => {
      if (response.ok) {
        return false;
      }
      toast.show(
        ((await response.json().catch(() => ({}))) as { message?: string }).message ||
          t('channel_action_failed', 'The channel could not be updated, try again'),
        'warning'
      );
      return true;
    },
    [t]
  );

  const disable = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('are_you_sure_disable_channel', 'Are you sure you want to disable this channel?'),
        t('disable_channel_title', 'Disable Channel')
      ))
    ) {
      return false;
    }
    const response = await fetch('/integrations/disable', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    if (await failed(response)) {
      return false;
    }
    toast.show(t('channel_disabled', 'Channel Disabled'), 'success');
    return true;
  }, [id, failed]);

  const enable = useCallback(async () => {
    const response = await fetch('/integrations/enable', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    if (await failed(response)) {
      return false;
    }
    toast.show(t('channel_enabled', 'Channel Enabled'), 'success');
    return true;
  }, [id, failed]);

  const remove = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('are_you_sure_delete_channel', 'Are you sure you want to delete this channel?'),
        t('delete_channel_title', 'Delete Channel')
      ))
    ) {
      return false;
    }
    const response = await fetch('/integrations', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
    if (response.status === 406) {
      toast.show(
        t('delete_posts_before_channel', 'You have to delete all the posts associated with this channel before deleting it'),
        'warning'
      );
      return false;
    }
    if (await failed(response)) {
      return false;
    }
    if (extensionId && typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage(extensionId, { type: 'REMOVE_REFRESH_TOKEN', integrationId: id }, () => {
          if (chrome.runtime.lastError) {
            return;
          }
        });
      } catch (err: unknown) {
        console.warn('Could not remove the extension refresh token', err);
      }
    }
    toast.show(t('channel_deleted', 'Channel Deleted'), 'success');
    return true;
  }, [id, extensionId, failed]);

  return { disable, enable, remove };
};
