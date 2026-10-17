'use client';

import { FC } from 'react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const UserCard: FC = () => {
  const user = useUser();
  if (!user) {
    return null;
  }

  const name = user.name || user.email.split('@')[0];
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  return (
    <div
      data-testid="user-card"
      className="flex items-center gap-[10px] h-[52px] ps-[6px] pe-[18px] rounded-full bg-newBgColorInner"
    >
      <span className="w-[40px] h-[40px] shrink-0 rounded-full bg-ink text-inkText text-[13px] font-[600] flex items-center justify-center">
        {initials}
      </span>
      <span className="flex flex-col min-w-0 leading-[1.25] mobile:hidden">
        <span className="text-[14px] font-[500] text-newTextColor truncate">{name}</span>
        <span className="text-[12px] text-textItemBlur truncate">{user.email}</span>
      </span>
    </div>
  );
};
