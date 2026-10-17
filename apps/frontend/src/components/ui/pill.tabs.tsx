'use client';

import { FC } from 'react';
import clsx from 'clsx';

export interface PillTab {
  id: string;
  label: string;
  count?: number;
}

export const PillTabs: FC<{
  items: PillTab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}> = ({ items, value, onChange, label }) => (
  <div
    role="tablist"
    aria-label={label}
    className="inline-flex self-start flex-wrap items-center gap-[4px] p-[6px] rounded-full bg-newBgColorInner"
  >
    {items.map((item) => {
      const active = item.id === value;
      return (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(item.id)}
          className={clsx(
            'h-[44px] px-[20px] rounded-full text-[15px] flex items-center gap-[8px] transition-colors',
            active ? 'bg-ink text-inkText' : 'text-newTextColor/80 hover:bg-newBgColor'
          )}
        >
          {item.label}
          {item.count !== undefined && (
            <span
              className={clsx(
                'min-w-[22px] h-[22px] px-[6px] rounded-full text-[12px] flex items-center justify-center',
                active ? 'bg-inkText/20' : 'bg-newBgColor'
              )}
            >
              {item.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);
