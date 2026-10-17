export const dynamic = 'force-dynamic';
import { PostsComponent } from '@gitroom/frontend/components/posts/posts.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pauta - Posts',
  description: '',
};

export default async function Page() {
  return <PostsComponent />;
}
