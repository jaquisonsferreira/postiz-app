'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{
  label: string;
  icon: ReactNode;
  path: string;
  badge?: number;
  onClick?: () => void;
}> = ({ label, icon, path, badge, onClick }) => {
  const currentPath = usePathname();
  const isActive = currentPath.indexOf(path) === 0;

  const className = clsx(
    'relative w-[52px] h-[52px] mobile:w-full mobile:justify-start mobile:px-[14px] mobile:gap-[12px] flex items-center justify-center rounded-[14px] transition-colors',
    isActive
      ? 'bg-accent text-accentInk'
      : 'text-railIcon hover:text-white hover:bg-white/10'
  );

  const inner = (
    <>
      <span className="flex shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="hidden mobile:block text-[14px] font-[500]">{label}</span>
      {!!badge && (
        <span
          data-testid="menu-badge"
          className="absolute top-[4px] end-[4px] min-w-[18px] h-[18px] px-[5px] rounded-[9px] bg-accent text-accentInk text-[11px] font-[700] flex items-center justify-center ring-2 ring-railBg"
        >
          {badge}
        </span>
      )}
    </>
  );

  const tooltip = {
    'data-tooltip-id': 'tooltip',
    'data-tooltip-content': label,
    'data-tooltip-place': 'right' as const,
  };

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} className={className} {...tooltip}>
        {inner}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      {...(path.indexOf('http') === 0 && { target: '_blank' })}
      className={className}
      {...tooltip}
    >
      {inner}
    </Link>
  );
};
