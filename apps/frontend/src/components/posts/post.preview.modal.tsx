'use client';

import { FC, useCallback, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { PillTabs } from '@gitroom/frontend/components/ui/pill.tabs';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';
import {
  PREVIEW_NETWORKS,
  PreviewFormat,
} from '@gitroom/frontend/components/posts/post.preview.networks';

interface PostGroupResponse {
  posts: {
    id: string;
    content: string;
    image: { id: string; path: string }[];
    integration?: {
      name: string;
      picture: string | null;
      providerIdentifier: string;
    };
  }[];
}

const PREVIEW_PARAMS = ['preview', 'network', 'format'];

const usePostGroup = (group: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as PostGroupResponse;
  }, []);
  return useSWR(`/posts/group/${group}`, load);
};

const usePreviewParams = () => {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (changes: Record<string, string | null>) => {
      const params = new URLSearchParams(window.location.search);
      Object.entries(changes).forEach(([key, value]) =>
        value ? params.set(key, value) : params.delete(key)
      );
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname]
  );
};

export const usePostPreview = () => {
  const update = usePreviewParams();
  return useCallback(
    (group: string) => () =>
      update({ preview: group, network: null, format: null }),
    [update]
  );
};

const defaultFormat = (
  media: string[],
  formats: PreviewFormat[]
): PreviewFormat => {
  const wanted: PreviewFormat = media.some((src) => hasExtension(src, 'mp4'))
    ? 'video'
    : media.length > 1
    ? 'carousel'
    : media.length
    ? 'image'
    : 'text';
  return formats.includes(wanted) ? wanted : formats[0];
};

const PostPreviewModal: FC<{ group: string; close: () => void }> = ({
  group,
  close,
}) => {
  const t = useT();
  const search = useSearchParams();
  const mediaDir = useMediaDirectory();
  const update = usePreviewParams();
  const { data, isLoading } = usePostGroup(group);

  const [root, ...comments] = data?.posts || [];
  const media = useMemo(
    () => (root?.image || []).map((image) => mediaDir.set(image.path)),
    [root]
  );
  const network =
    PREVIEW_NETWORKS.find((p) => p.id === search.get('network')) ||
    PREVIEW_NETWORKS.find((p) =>
      p.identifiers.includes(root?.integration?.providerIdentifier || '')
    ) ||
    PREVIEW_NETWORKS[0];
  const format = network.formats.includes(search.get('format') as PreviewFormat)
    ? (search.get('format') as PreviewFormat)
    : defaultFormat(media, network.formats);

  const changeNetwork = useCallback(
    (id: string) => {
      const next = PREVIEW_NETWORKS.find((p) => p.id === id);
      update({
        network: id,
        format: next?.formats.includes(search.get('format') as PreviewFormat)
          ? search.get('format')
          : null,
      });
    },
    [update, search]
  );

  const changeFormat = useCallback(
    (id: string) => update({ format: id }),
    [update]
  );

  const share = useCallback(() => {
    window.open(`/p/${root?.id}?share=true`, '_blank');
  }, [root]);

  const formatLabels: Record<PreviewFormat, string> = {
    text: t('format_text', 'Text'),
    image: t('format_image', 'Image'),
    carousel: t('format_carousel', 'Carousel'),
    video: t('format_video', 'Video'),
    story: t('format_story', 'Stories'),
  };

  return (
    <div
      data-testid="post-preview-modal"
      className="flex flex-col gap-[20px] w-[min(780px,calc(100vw-48px))]"
    >
      <div className="flex items-center gap-[12px]">
        {root?.integration && (
          <ChannelIcon
            identifier={root.integration.providerIdentifier}
            picture={root.integration.picture}
            name={root.integration.name}
          />
        )}
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[20px] font-[600]">
            {t('post_preview', 'Post Preview')}
          </span>
          <span className="text-[13px] text-textItemBlur truncate">
            {root?.integration?.name}
          </span>
        </span>
        <button
          type="button"
          aria-label={t('close', 'Close')}
          onClick={close}
          className="w-[40px] h-[40px] rounded-full flex items-center justify-center bg-newBgColor hover:bg-newBgLineColor"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {isLoading || !root ? (
        <div className="min-h-[400px] flex items-center justify-center">
          <LoadingComponent />
        </div>
      ) : (
        <div className="flex gap-[24px] mobile:flex-col">
          <div className="flex flex-col gap-[16px] w-[300px] mobile:w-full">
            <PillTabs
              label={t('preview_network', 'Network')}
              value={network.id}
              onChange={changeNetwork}
              items={PREVIEW_NETWORKS.map((p) => ({
                id: p.id,
                label: p.label,
              }))}
            />
            <PillTabs
              label={t('preview_format', 'Format')}
              value={format}
              onChange={changeFormat}
              items={network.formats.map((id) => ({
                id,
                label: formatLabels[id],
              }))}
            />
            <PillButton variant="secondary" onClick={share}>
              {t('open_share_link', 'Open link for third parties')}
            </PillButton>
          </div>
          <div className="flex-1 flex justify-center">
            <div className="w-full max-w-[375px]">
              <network.Feed
                format={format}
                content={{
                  name: root.integration?.name || '',
                  picture: root.integration?.picture || '',
                  text: stripHtmlValidation('normal', root.content, true),
                  comments: comments.map((p) =>
                    stripHtmlValidation('normal', p.content, true)
                  ),
                  media,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const PostPreview: FC = () => {
  const search = useSearchParams();
  const modals = useModals();
  const update = usePreviewParams();
  const group = search.get('preview');

  const closePreview = useCallback(
    () => update(Object.fromEntries(PREVIEW_PARAMS.map((key) => [key, null]))),
    [update]
  );

  useEffect(() => {
    if (!group) {
      return;
    }
    modals.openModal({
      id: 'post-preview',
      withCloseButton: false,
      onClose: closePreview,
      classNames: { modal: 'text-textColor' },
      children: (close) => <PostPreviewModal group={group} close={close} />,
    });
    return () => modals.closeById('post-preview');
  }, [group]);

  return null;
};
