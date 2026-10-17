'use client';

import { ButtonHTMLAttributes, FC, ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'dark';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accentInk hover:brightness-95',
  secondary: 'bg-newBgColorInner text-newTextColor border border-newBorder hover:bg-newBgColor',
  dark: 'bg-ink text-inkText hover:opacity-90',
};

const base =
  'inline-flex items-center justify-center gap-[10px] h-[52px] px-[24px] rounded-full text-[16px] font-[500] transition disabled:opacity-50 disabled:pointer-events-none';

export const PillButton: FC<
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }
> = ({ variant = 'secondary', icon, className, children, type, ...props }) => (
  <button type={type || 'button'} className={clsx(base, variants[variant], className)} {...props}>
    {icon}
    {children}
  </button>
);

export const PillLink: FC<{
  href: string;
  variant?: Variant;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}> = ({ href, variant = 'secondary', icon, className, children }) => (
  <Link href={href} className={clsx(base, variants[variant], className)}>
    {icon}
    {children}
  </Link>
);
