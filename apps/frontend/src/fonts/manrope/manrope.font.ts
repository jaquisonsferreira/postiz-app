import localFont from 'next/font/local';

export const manrope = localFont({
  src: [{ path: './Manrope.woff2', weight: '200 800', style: 'normal' }],
  variable: '--font-manrope',
});
