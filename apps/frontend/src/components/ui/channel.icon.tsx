'use client';

import { FC } from 'react';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';

export const ChannelIcon: FC<{ identifier: string; picture?: string | null; name: string; size?: number }> = ({
  identifier,
  picture,
  name,
  size = 40,
}) => (
  <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
    <ImageWithFallback
      fallbackSrc="/no-picture.jpg"
      src={picture || '/no-picture.jpg'}
      alt={name}
      width={size}
      height={size}
      className="rounded-full object-cover"
    />
    <img
      src={`/icons/platforms/${identifier}.png`}
      alt=""
      aria-hidden="true"
      width={Math.round(size * 0.45)}
      height={Math.round(size * 0.45)}
      className="absolute -bottom-[2px] -end-[2px] rounded-full ring-2 ring-newBgColorInner"
    />
  </span>
);
