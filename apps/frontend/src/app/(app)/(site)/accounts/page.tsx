export const dynamic = 'force-dynamic';
import { AccountsComponent } from '@gitroom/frontend/components/accounts/accounts.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Contas conectadas',
  description: '',
};

export default async function Page() {
  return <AccountsComponent />;
}
