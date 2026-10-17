'use client';

import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { Card } from '@gitroom/frontend/components/ui/card';

export const MediaLayoutComponent = () => {
  return (
    <Card testId="media-library" className="flex-1 min-w-0">
      <MediaBox setMedia={() => {}} closeModal={() => {}} standalone={true} />
    </Card>
  );
};
