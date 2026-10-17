'use client';

import { FC, ReactNode } from 'react';
import clsx from 'clsx';

export const Card: FC<{ children: ReactNode; className?: string; testId?: string }> = ({
  children,
  className,
  testId,
}) => (
  <section
    data-testid={testId}
    className={clsx('bg-newBgColorInner rounded-[32px] p-[28px] mobile:p-[20px] flex flex-col gap-[20px]', className)}
  >
    {children}
  </section>
);

export const CardHeader: FC<{ icon?: ReactNode; title: string; meta?: ReactNode }> = ({
  icon,
  title,
  meta,
}) => (
  <div className="flex items-center gap-[12px]">
    {icon && (
      <span className="text-textItemBlur flex" aria-hidden="true">
        {icon}
      </span>
    )}
    <h2 className="flex-1 m-0 text-[19px] font-[500] text-newTextColor">{title}</h2>
    {meta && <span className="text-[15px] text-textItemBlur">{meta}</span>}
  </div>
);
