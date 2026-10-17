import { RadarComponent } from '@gitroom/frontend/components/automation/automation.empty';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Radar de notícias',
  description: '',
};

export default async function Page() {
  return <RadarComponent />;
}
