'use client';

import { FC, ReactNode } from 'react';
import clsx from 'clsx';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MenuItem } from '@gitroom/frontend/components/new-layout/menu-item';
import { usePendingApprovals } from '@gitroom/frontend/components/approvals/use.compositions';

type MenuSection = 'content' | 'automation' | 'settings';

interface MenuItemInterface {
  name: string;
  icon: ReactNode;
  path: string;
  section: MenuSection;
  role?: string[];
  hide?: boolean;
  requireBilling?: boolean;
  badge?: number;
  onClick?: () => void;
}

const Icon: FC<{ children: ReactNode }> = ({ children }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const useMenuItem = () => {
  const t = useT();
  const pendingApprovals = usePendingApprovals();

  const all = [
    {
      section: 'content',
      name: t('dashboard', 'Dashboard'),
      path: '/dashboard',
      icon: (
        <Icon>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </Icon>
      ),
    },
    {
      section: 'content',
      name: t('calendar', 'Calendar'),
      path: '/launches',
      icon: (
        <Icon>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </Icon>
      ),
    },
    {
      section: 'content',
      name: t('posts', 'Posts'),
      path: '/posts',
      icon: (
        <Icon>
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 13l9 5 9-5" />
        </Icon>
      ),
    },
    {
      section: 'content',
      name: t('editor', 'Editor'),
      path: '/editor',
      icon: (
        <Icon>
          <path d="M4 20h4L19 9l-4-4L4 16v4z" />
          <path d="M13.5 6.5l4 4" />
        </Icon>
      ),
    },
    {
      section: 'automation',
      name: t('content_agents', 'Agents'),
      path: '/automations',
      hide: true,
      icon: (
        <Icon>
          <rect x="5" y="8" width="14" height="11" rx="3" />
          <path d="M12 4v4M9.5 13h.01M14.5 13h.01" />
        </Icon>
      ),
    },
    {
      section: 'automation',
      name: t('news_radar', 'News radar'),
      path: '/radar',
      hide: true,
      icon: (
        <Icon>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 12l6-6" />
        </Icon>
      ),
    },
    {
      section: 'automation',
      name: t('approvals', 'Approvals'),
      path: '/approvals',
      badge: pendingApprovals,
      icon: (
        <Icon>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M8 12l3 3 5-6" />
        </Icon>
      ),
    },
    {
      section: 'automation',
      name: t('ads', 'Ads'),
      path: '/ads',
      icon: (
        <Icon>
          <path d="M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1z" />
          <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" />
        </Icon>
      ),
    },
    {
      section: 'settings',
      name: t('connected_accounts', 'Connected accounts'),
      path: '/accounts',
      icon: (
        <Icon>
          <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
        </Icon>
      ),
    },
    {
      section: 'settings',
      name: t('analytics', 'Analytics'),
      path: '/analytics',
      icon: (
        <Icon>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </Icon>
      ),
    },
    {
      section: 'settings',
      name: t('media', 'Media'),
      path: '/media',
      icon: (
        <Icon>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="M21 16l-5-5-9 9" />
        </Icon>
      ),
    },
    {
      section: 'settings',
      name: t('ai_assistant', 'AI assistant'),
      path: '/agents',
      hide: true,
      icon: (
        <Icon>
          <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />
        </Icon>
      ),
    },
    {
      section: 'settings',
      name: t('billing', 'Billing'),
      path: '/billing',
      role: ['ADMIN', 'SUPERADMIN'],
      requireBilling: true,
      icon: (
        <Icon>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
        </Icon>
      ),
    },
    {
      section: 'settings',
      name: t('settings', 'Settings'),
      path: '/settings',
      role: ['ADMIN', 'USER', 'SUPERADMIN'],
      icon: (
        <Icon>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </Icon>
      ),
    },
  ] satisfies MenuItemInterface[] as MenuItemInterface[];

  return { all };
};

export const TopMenu: FC = () => {
  const user = useUser();
  const t = useT();
  const { all } = useMenuItem();
  const { isGeneral, billingEnabled } = useVariables();

  if (!user?.orgId) {
    return null;
  }
  const contentLocked = user.tier?.current === 'FREE' && isGeneral && billingEnabled;

  const visible = all.filter((f) => {
    if (contentLocked && f.section !== 'settings') {
      return false;
    }
    if (f.hide) {
      return false;
    }
    if (f.requireBilling && !billingEnabled) {
      return false;
    }
    if (f.path === '/billing' && user?.isLifetime) {
      return false;
    }
    if (f.role) {
      return f.role.includes(user?.role!);
    }
    return true;
  });

  const sections: { id: MenuSection; label: string }[] = [
    { id: 'content', label: t('content', 'Content') },
    { id: 'automation', label: t('automation', 'Automation') },
    { id: 'settings', label: t('configuration', 'Settings') },
  ];

  return (
    <nav
      aria-label={t('main_navigation', 'Main navigation')}
      className="flex flex-1 flex-col items-center mobile:items-stretch gap-[18px]"
    >
      {sections.map((section) => (
        <div
          key={section.id}
          role="group"
          aria-label={section.label}
          className={clsx(
            'flex flex-col items-center mobile:items-stretch gap-[8px]',
            section.id === 'settings' && 'mt-auto'
          )}
        >
          {visible
            .filter((item) => item.section === section.id)
            .map((item) => (
              <MenuItem
                key={item.path}
                path={item.path}
                label={item.name}
                icon={item.icon}
                badge={item.badge}
                onClick={item.onClick}
              />
            ))}
        </div>
      ))}
    </nav>
  );
};
