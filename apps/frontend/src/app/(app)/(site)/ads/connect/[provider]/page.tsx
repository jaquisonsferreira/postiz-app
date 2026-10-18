export const dynamic = 'force-dynamic';
import { AdsConnectComponent } from '@gitroom/frontend/components/ads/ads.connect.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Conectar anúncios',
  description: '',
};

export default async function Page(props: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ code?: string; state?: string }>;
}) {
  const { provider } = await props.params;
  const { code, state } = await props.searchParams;
  return <AdsConnectComponent provider={provider} code={code} state={state} />;
}
