import { ApprovalsComponent } from '@gitroom/frontend/components/approvals/approvals.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Aprovações',
  description: '',
};

export default async function Page() {
  return <ApprovalsComponent />;
}
