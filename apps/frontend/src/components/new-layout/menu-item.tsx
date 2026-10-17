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
    'w-full min-h-[44px] px-[12px] py-[10px] flex items-center gap-[12px] rounded-[10px] text-[14px] transition-colors hover:bg-boxFocused hover:text-textItemFocused',
    isActive
      ? 'bg-boxFocused text-textItemFocused font-[700]'
      : 'text-textItemBlur font-[600]'
  );

  const inner = (
    <>
      <span className="flex shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 text-start truncate">{label}</span>
      {!!badge && (
        <span
          data-testid="menu-badge"
          className="min-w-[22px] h-[22px] px-[6px] rounded-[11px] bg-btnPrimary text-white text-[12px] font-[700] flex items-center justify-center"
        >
          {badge}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      aria-current={isActive ? 'page' : undefined}
      {...(path.indexOf('http') === 0 && { target: '_blank' })}
      className={className}
    >
      {inner}
    </Link>
  );
};
