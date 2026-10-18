'use client';

import { FC, ReactNode } from 'react';

export const inputClass =
  'w-full h-[48px] px-[16px] rounded-[16px] bg-newBgColor text-[15px] text-newTextColor outline-none focus:ring-2 focus:ring-accent';

export const Field: FC<{ label: string; children: (id: string) => ReactNode; id: string }> = ({ label, children, id }) => (
  <div className="flex flex-col gap-[6px]">
    <label htmlFor={id} className="text-[14px] text-textItemBlur">
      {label}
    </label>
    {children(id)}
  </div>
);
