'use client';

import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useRouter } from 'next/navigation';
import { useChannelActions } from '@gitroom/frontend/components/launches/helpers/use.channel.actions';
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
  const router = useRouter();
  const refreshChannel = useRefreshChannel();
  const needsReconnect = channel.refreshNeeded || channel.inBetweenSteps;
  const reconnect = useCallback(() => {
    if (channel.inBetweenSteps && !channel.refreshNeeded) {
      router.push(`/launches?added=${channel.identifier}&continue=${channel.id}`);
      return;
    }
    refreshChannel(channel)();
  }, [channel]);

  const { disable, enable, remove } = useChannelActions(channel.id);
  const run = useCallback(
    (action: () => Promise<boolean>) => async () => {
      if (await action()) {
        onChange();
      }
    },
    [onChange]
  );

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
          <PillButton variant="primary" className="!h-[44px] !text-[15px]" onClick={reconnect}>
            {t('reconnect_channel', 'Reconnect channel')}
          </PillButton>
        ) : channel.disabled ? (
          <PillButton className="!h-[44px] !text-[15px]" disabled={!canEnable} onClick={run(enable)}>
            {t('enable_channel', 'Enable')}
          </PillButton>
        ) : (
          <PillButton className="!h-[44px] !text-[15px]" onClick={run(disable)}>
            {t('disable_channel', 'Disable')}
          </PillButton>
        )}
        <PillButton className="!h-[44px] !text-[15px] !text-statusErrorText" onClick={run(remove)}>
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
