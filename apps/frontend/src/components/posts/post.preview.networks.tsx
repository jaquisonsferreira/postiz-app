'use client';

import { FC, ReactNode } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { SliderComponent } from '@gitroom/frontend/components/third-parties/slider.component';

export type PreviewFormat = 'text' | 'image' | 'carousel' | 'video' | 'story';

export interface PreviewContent {
  name: string;
  picture: string;
  text: string;
  comments: string[];
  media: string[];
}

export interface PreviewNetwork {
  id: string;
  label: string;
  identifiers: string[];
  formats: PreviewFormat[];
  Feed: FC<{ content: PreviewContent; format: PreviewFormat }>;
}

const Media: FC<{ src: string; className?: string }> = ({ src, className }) =>
  hasExtension(src, 'mp4') ? (
    <video
      src={src}
      autoPlay
      muted
      loop
      playsInline
      className={clsx('w-full h-full object-cover', className)}
    />
  ) : (
    <img
      src={src}
      alt=""
      className={clsx('w-full h-full object-cover', className)}
    />
  );

const EmptyMedia: FC<{ className?: string }> = ({ className }) => {
  const t = useT();
  return (
    <div
      className={clsx(
        'w-full flex items-center justify-center bg-black/10 text-[13px] opacity-70',
        className
      )}
    >
      {t('preview_no_media', 'This post has no media')}
    </div>
  );
};

const Slides: FC<{ media: string[]; className: string }> = ({
  media,
  className,
}) =>
  media.length ? (
    <SliderComponent
      className={clsx(className, 'overflow-hidden')}
      list={media.map((src, index) => (
        <div
          key={`${src}_${index}`}
          data-testid="post-preview-slide"
          className="w-full h-full"
        >
          <Media src={src} />
        </div>
      ))}
    />
  ) : (
    <EmptyMedia className={className} />
  );

const SingleMedia: FC<{ media: string[]; className: string }> = ({
  media,
  className,
}) =>
  media[0] ? (
    <div className={clsx(className, 'overflow-hidden')}>
      <Media src={media[0]} />
    </div>
  ) : (
    <EmptyMedia className={className} />
  );

const FeedMedia: FC<{
  media: string[];
  format: PreviewFormat;
  className: string;
}> = ({ media, format, className }) => {
  if (format === 'text') {
    return null;
  }
  if (format === 'carousel') {
    return <Slides media={media} className={className} />;
  }
  return <SingleMedia media={media} className={className} />;
};

const Avatar: FC<{ picture: string; size: number }> = ({ picture, size }) => (
  <img
    src={picture || '/no-picture.jpg'}
    alt=""
    style={{ width: size, height: size }}
    className="rounded-full object-cover shrink-0"
  />
);

const Caption: FC<{ name?: string; text: string; className?: string }> = ({
  name,
  text,
  className,
}) => (
  <p
    dir="auto"
    className={clsx('m-0 whitespace-pre-line break-words', className)}
  >
    {name && <strong className="font-[600]">{name} </strong>}
    {text}
  </p>
);

const Comments: FC<{ content: PreviewContent }> = ({ content }) =>
  content.comments.length ? (
    <div className="flex flex-col gap-[10px] pt-[4px]">
      {content.comments.map((comment, index) => (
        <div key={index} className="flex gap-[8px]">
          <Avatar picture={content.picture} size={28} />
          <Caption
            name={content.name}
            text={comment}
            className="text-[13px] flex-1"
          />
        </div>
      ))}
    </div>
  ) : null;

const Icon: FC<{ children: ReactNode; size?: number }> = ({
  children,
  size = 22,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const Heart: FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" />
  </Icon>
);
const Bubble: FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M4 19l1.5-4A8 8 0 1112 20a8 8 0 01-3.5-.8L4 19z" />
  </Icon>
);
const Send: FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M21 3L3 10l7 3 3 7 8-17zM10 13l5-5" />
  </Icon>
);
const Share: FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M14 5l7 7-7 7v-4c-6 0-9 2-11 5 1-6 4-10 11-11V5z" />
  </Icon>
);
const Repost: FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4" />
  </Icon>
);
const ThumbUp: FC<{ size?: number }> = ({ size }) => (
  <Icon size={size}>
    <path d="M7 11v9H4v-9h3zm0 0l4-8a2 2 0 012 2v4h5a2 2 0 012 2.3l-1.2 7A2 2 0 0116.8 20H7" />
  </Icon>
);

const ActionRow: FC<{
  items: { icon: ReactNode; label?: string }[];
  className?: string;
}> = ({ items, className }) => (
  <div className={clsx('flex items-center gap-[16px] text-[13px]', className)}>
    {items.map((item, index) => (
      <span key={index} className="flex items-center gap-[6px]">
        {item.icon}
        {item.label}
      </span>
    ))}
  </div>
);

const VerticalVideo: FC<{ content: PreviewContent; slides?: boolean }> = ({
  content,
  slides,
}) => (
  <div
    data-testid="post-preview-vertical"
    className="relative w-full aspect-[9/16] bg-black text-white rounded-[12px] overflow-hidden"
  >
    {slides ? (
      <Slides media={content.media} className="w-full h-full" />
    ) : (
      <SingleMedia media={content.media} className="w-full h-full" />
    )}
    <div className="absolute end-[12px] bottom-[96px] flex flex-col items-center gap-[18px] pointer-events-none">
      <Avatar picture={content.picture} size={40} />
      <Heart />
      <Bubble />
      <Send />
    </div>
    <div className="absolute start-0 end-[64px] bottom-0 p-[14px] flex flex-col gap-[6px] bg-gradient-to-t from-black/70 to-transparent pointer-events-none">
      <span className="text-[14px] font-[600]">{content.name}</span>
      <Caption text={content.text} className="text-[13px] line-clamp-3" />
    </div>
  </div>
);

const Story: FC<{ content: PreviewContent }> = ({ content }) => {
  const t = useT();
  const pages = Math.max(content.media.length, 1);
  return (
    <div
      data-testid="post-preview-story"
      className="relative w-full aspect-[9/16] bg-black text-white rounded-[12px] overflow-hidden"
    >
      <SingleMedia media={content.media} className="w-full h-full" />
      <div className="absolute top-0 start-0 end-0 p-[10px] flex flex-col gap-[10px] bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex gap-[4px]">
          {Array.from({ length: pages }).map((_, index) => (
            <span
              key={index}
              className={clsx(
                'flex-1 h-[2px] rounded-full',
                index === 0 ? 'bg-white' : 'bg-white/40'
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-[8px]">
          <Avatar picture={content.picture} size={32} />
          <span className="text-[13px] font-[600]">{content.name}</span>
        </div>
      </div>
      <div className="absolute bottom-0 start-0 end-0 p-[12px] flex items-center gap-[12px]">
        <span className="flex-1 h-[40px] rounded-full border border-white/60 px-[16px] flex items-center text-[13px]">
          {t('preview_send_message', 'Send message')}
        </span>
        <Heart />
        <Send />
      </div>
    </div>
  );
};

const InstagramFeed: PreviewNetwork['Feed'] = ({ content, format }) => {
  if (format === 'story') {
    return <Story content={content} />;
  }
  if (format === 'video') {
    return <VerticalVideo content={content} />;
  }
  return (
    <div className="bg-bgInstagram text-newTextColor rounded-[12px] py-[10px] flex flex-col gap-[10px]">
      <div className="flex items-center gap-[10px] px-[12px]">
        <Avatar picture={content.picture} size={32} />
        <span className="text-[14px] font-[600]">{content.name}</span>
      </div>
      <FeedMedia
        media={content.media}
        format={format}
        className="w-full aspect-[4/5]"
      />
      <ActionRow
        className="px-[12px]"
        items={[{ icon: <Heart /> }, { icon: <Bubble /> }, { icon: <Send /> }]}
      />
      <div className="px-[12px] flex flex-col gap-[6px]">
        <Caption
          name={content.name}
          text={content.text}
          className="text-[14px]"
        />
        <Comments content={content} />
      </div>
    </div>
  );
};

const FacebookFeed: PreviewNetwork['Feed'] = ({ content, format }) => {
  const t = useT();
  if (format === 'story') {
    return <Story content={content} />;
  }
  if (format === 'video') {
    return <VerticalVideo content={content} />;
  }
  return (
    <div className="bg-bgFacebook text-newTextColor rounded-[12px] py-[12px] flex flex-col gap-[10px]">
      <div className="flex items-center gap-[10px] px-[12px]">
        <Avatar picture={content.picture} size={40} />
        <span className="text-[15px] font-[600]">{content.name}</span>
      </div>
      <Caption text={content.text} className="px-[12px] text-[15px]" />
      <FeedMedia
        media={content.media}
        format={format}
        className="w-full aspect-square"
      />
      <ActionRow
        className="px-[12px] justify-around border-t border-newBorder pt-[10px]"
        items={[
          { icon: <ThumbUp />, label: t('preview_like', 'Like') },
          { icon: <Bubble />, label: t('preview_comment', 'Comment') },
          { icon: <Share />, label: t('preview_share', 'Share') },
        ]}
      />
      <div className="px-[12px]">
        <Comments content={content} />
      </div>
    </div>
  );
};

const LinkedinFeed: PreviewNetwork['Feed'] = ({ content, format }) => {
  const t = useT();
  return (
    <div className="bg-bgLinkedin text-newTextColor border border-borderLinkedin rounded-[12px] py-[12px] flex flex-col gap-[10px]">
      <div className="flex items-center gap-[10px] px-[12px]">
        <Avatar picture={content.picture} size={48} />
        <span className="flex flex-col">
          <span className="text-[14px] font-[600]">{content.name}</span>
          <span className="text-[12px] text-textLinkedin">1h</span>
        </span>
      </div>
      <Caption text={content.text} className="px-[12px] text-[14px]" />
      {format === 'carousel' ? (
        <div className="flex flex-col">
          <Slides media={content.media} className="w-full aspect-square" />
          <span className="px-[12px] py-[6px] text-[12px] text-textLinkedin">
            {t('preview_pages', '{{total}} pages', {
              total: content.media.length,
            })}
          </span>
        </div>
      ) : (
        <FeedMedia
          media={content.media}
          format={format}
          className="w-full aspect-[4/3]"
        />
      )}
      <ActionRow
        className="px-[12px] justify-around border-t border-borderLinkedin pt-[10px] text-textLinkedin"
        items={[
          { icon: <ThumbUp />, label: t('preview_like', 'Like') },
          { icon: <Bubble />, label: t('preview_comment', 'Comment') },
          { icon: <Repost />, label: t('preview_repost', 'Repost') },
          { icon: <Send />, label: t('preview_send', 'Send') },
        ]}
      />
      <div className="px-[12px]">
        <Comments content={content} />
      </div>
    </div>
  );
};

const TiktokFeed: PreviewNetwork['Feed'] = ({ content, format }) => (
  <VerticalVideo content={content} slides={format === 'carousel'} />
);

const XFeed: PreviewNetwork['Feed'] = ({ content, format }) => (
  <div className="bg-newBgColor text-newTextColor rounded-[12px] p-[12px] flex gap-[10px]">
    <Avatar picture={content.picture} size={40} />
    <div className="flex-1 min-w-0 flex flex-col gap-[8px]">
      <span className="text-[15px] font-[700]">{content.name}</span>
      <Caption text={content.text} className="text-[15px]" />
      {format === 'carousel' && content.media.length ? (
        <div className="grid grid-cols-2 gap-[2px] rounded-[16px] overflow-hidden">
          {content.media.slice(0, 4).map((src, index) => (
            <div
              key={`${src}_${index}`}
              data-testid="post-preview-slide"
              className="aspect-square"
            >
              <Media src={src} />
            </div>
          ))}
        </div>
      ) : (
        <FeedMedia
          media={content.media}
          format={format}
          className="w-full aspect-video rounded-[16px]"
        />
      )}
      <ActionRow
        className="justify-between text-textItemBlur"
        items={[
          { icon: <Bubble size={18} /> },
          { icon: <Repost size={18} /> },
          { icon: <Heart size={18} /> },
          { icon: <Share size={18} /> },
        ]}
      />
      <Comments content={content} />
    </div>
  </div>
);

export const PREVIEW_NETWORKS: PreviewNetwork[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    identifiers: ['instagram', 'instagram-standalone'],
    formats: ['image', 'carousel', 'video', 'story'],
    Feed: InstagramFeed,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    identifiers: ['facebook'],
    formats: ['text', 'image', 'carousel', 'video', 'story'],
    Feed: FacebookFeed,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    identifiers: ['linkedin', 'linkedin-page'],
    formats: ['text', 'image', 'carousel', 'video'],
    Feed: LinkedinFeed,
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    identifiers: ['tiktok'],
    formats: ['video', 'carousel'],
    Feed: TiktokFeed,
  },
  {
    id: 'x',
    label: 'X',
    identifiers: ['x'],
    formats: ['text', 'image', 'carousel', 'video'],
    Feed: XFeed,
  },
];
