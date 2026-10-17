'use client';

import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';
import {
  CalendarWeekProvider,
  Integrations,
} from '@gitroom/frontend/components/launches/calendar.context';
import { Menu } from '@gitroom/frontend/components/launches/menu/menu';
import {
  RefreshableChannel,
  useRefreshChannel,
} from '@gitroom/frontend/components/launches/helpers/use.refresh.channel';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';
import clsx from 'clsx';

type AccountChannel = Integrations & RefreshableChannel & { refreshNeeded: boolean };

const AccountCard: FC<{
  channel: AccountChannel;
  canEnable: boolean;
  onChange: () => void;
}> = ({ channel, canEnable, onChange }) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const refreshChannel = useRefreshChannel();
  const needsReconnect = channel.refreshNeeded || channel.inBetweenSteps;

  const setDisabled = useCallback(
    async (disabled: boolean) => {
      await fetch(disabled ? '/integrations/disable' : '/integrations/enable', {
        method: 'POST',
        body: JSON.stringify({ id: channel.id }),
      });
      toast.show(
        disabled ? t('channel_disabled', 'Channel Disabled') : t('channel_enabled', 'Channel Enabled'),
        'success'
      );
      onChange();
    },
    [channel.id, onChange]
  );

  const remove = useCallback(async () => {
    if (!(await deleteDialog(t('are_you_sure_delete_channel', 'Are you sure you want to delete this channel?')))) {
      return;
    }
    const response = await fetch('/integrations', {
      method: 'DELETE',
      body: JSON.stringify({ id: channel.id }),
    });
    if (response.status === 406) {
      toast.show(
        t('delete_posts_before_channel', 'You have to delete all the posts associated with this channel before deleting it'),
        'warning'
      );
      return;
    }
    toast.show(t('channel_deleted', 'Channel deleted'), 'success');
    onChange();
  }, [channel.id, onChange]);

  const status = needsReconnect
    ? { label: t('status_reconnect', 'Reconnect'), className: 'bg-statusPendingBg text-statusPendingText' }
    : channel.disabled
    ? { label: t('status_disabled', 'Disabled'), className: 'bg-statusDraftBg text-statusDraftText' }
    : { label: t('status_connected', 'Connected'), className: 'bg-statusPublishedBg text-statusPublishedText' };

  return (
    <article data-testid="account-card" className="bg-newBgColorInner rounded-[28px] p-[22px] flex flex-col gap-[18px]">
      <div className="flex items-center gap-[14px]">
        <ChannelIcon identifier={channel.identifier} picture={channel.picture} name={channel.name} size={48} />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[17px] font-[500] truncate">{channel.name}</span>
          <span className="text-[13px] text-textItemBlur truncate">
            {channel.display ? `@${channel.display}` : channel.identifier}
          </span>
        </span>
        <span className={clsx('inline-flex items-center gap-[6px] h-[28px] px-[10px] rounded-full text-[13px] font-[500]', status.className)}>
          <span className="w-[6px] h-[6px] rounded-full bg-current" aria-hidden="true" />
          {status.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-[8px]">
        {needsReconnect ? (
          <PillButton variant="primary" className="!h-[44px] !text-[15px]" onClick={refreshChannel(channel)}>
            {t('reconnect_channel', 'Reconnect channel')}
          </PillButton>
        ) : channel.disabled ? (
          <PillButton className="!h-[44px] !text-[15px]" disabled={!canEnable} onClick={() => setDisabled(false)}>
            {t('enable_channel', 'Enable')}
          </PillButton>
        ) : (
          <PillButton className="!h-[44px] !text-[15px]" onClick={() => setDisabled(true)}>
            {t('disable_channel', 'Disable')}
          </PillButton>
        )}
        <PillButton className="!h-[44px] !text-[15px] !text-statusErrorText" onClick={remove}>
          {t('delete_channel_button', 'Delete channel')}
        </PillButton>
        <span className="flex-1" />
        <Menu
          canChangeProfilePicture={channel.changeProfilePicture}
          canChangeNickName={channel.changeNickName}
          refreshChannel={refreshChannel}
          mutate={onChange}
          onChange={onChange}
          id={channel.id}
          canEnable={canEnable && channel.disabled}
          canDisable={!channel.disabled}
        />
      </div>
    </article>
  );
};

export const AccountsComponent: FC = () => {
  const t = useT();
  const user = useUser();
  const { data: integrations = [], mutate } = useIntegrationList();
  const channels = integrations as AccountChannel[];
  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);
  const addProvider = useAddProvider(refresh);
  const activeChannels = channels.filter((channel) => !channel.disabled).length;
  const canEnable = (user?.totalChannels || 0) > activeChannels;

  return (
    <CalendarWeekProvider integrations={channels}>
      <div className="flex-1 flex flex-col gap-[20px]">
        <div className="flex flex-wrap items-end gap-[16px]">
          <p className="flex-1 min-w-[260px] m-0 text-[18px] text-textItemBlur">
            {t('accounts_subtitle', 'Networks where your posts are published. Connect, reconnect or turn off each channel.')}
          </p>
          <PillButton variant="primary" onClick={addProvider}>
            {t('add_channel', 'Add channel')}
          </PillButton>
        </div>
        {!channels.length ? (
          <div className="bg-newBgColorInner rounded-[32px] p-[48px] text-center text-[16px] text-textItemBlur">
            {t('no_channels_yet', 'No channel connected yet. Add one to start publishing.')}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-[16px]">
            {channels.map((channel) => (
              <AccountCard key={channel.id} channel={channel} canEnable={canEnable} onChange={refresh} />
            ))}
          </div>
        )}
      </div>
    </CalendarWeekProvider>
  );
};
