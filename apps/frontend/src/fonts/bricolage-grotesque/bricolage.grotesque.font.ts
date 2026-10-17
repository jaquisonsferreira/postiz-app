import localFont from 'next/font/local';

export const bricolageGrotesque = localFont({
  src: [{ path: './BricolageGrotesque.woff2', weight: '200 800', style: 'normal' }],
  variable: '--font-heading',
});
