export const dynamic = 'force-dynamic';
import { EditorComponent } from '@gitroom/frontend/components/editor/editor.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Editor',
  description: '',
};

export default async function Page() {
  return <EditorComponent />;
}
