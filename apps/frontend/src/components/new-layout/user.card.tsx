'use client';

import { FC } from 'react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const UserCard: FC = () => {
  const user = useUser();
  const t = useT();
  if (!user) {
    return null;
  }

  const name = user.name || user.email;
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
  const role =
    user.role === 'USER' ? t('role_user', 'Member') : t('role_admin', 'Administrator');

  return (
    <div className="mt-auto flex items-center gap-[10px] p-[12px] rounded-[12px] bg-btnSimple border border-newBorder">
      <span className="w-[36px] h-[36px] shrink-0 rounded-full bg-newTextColor text-newBgColorInner text-[13px] font-[700] flex items-center justify-center">
        {initials}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-[14px] font-[700] truncate">{name}</span>
        <span className="text-[12px] text-textItemBlur">{role}</span>
      </span>
    </div>
  );
};
