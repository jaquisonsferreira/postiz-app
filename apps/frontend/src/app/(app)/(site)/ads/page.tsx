export const dynamic = 'force-dynamic';
import { AdsComponent } from '@gitroom/frontend/components/ads/ads.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Anúncios',
  description: '',
};

export default async function Page() {
  return <AdsComponent />;
}
