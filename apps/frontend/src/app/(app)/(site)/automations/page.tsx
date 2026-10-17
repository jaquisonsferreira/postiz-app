import { AgentsComponent } from '@gitroom/frontend/components/automation/automation.empty';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Agentes',
  description: '',
};

export default async function Page() {
  return <AgentsComponent />;
}
