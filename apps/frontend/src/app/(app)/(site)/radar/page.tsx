export const dynamic = 'force-dynamic';
import { RadarComponent } from '@gitroom/frontend/components/automation/automation.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Radar de notícias',
  description: '',
};

export default async function Page() {
  return <RadarComponent />;
}
