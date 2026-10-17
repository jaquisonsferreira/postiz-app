'use client';

import { FC, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  buildSlideHtml,
  DEFAULT_BRAND,
  SLIDE_SIZES,
  SlideTheme,
} from '@gitroom/nestjs-libraries/compositions/composition.slide.template';
import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useLocalDate } from '@gitroom/frontend/components/dashboard/use.dashboard';
import {
  defaultSettings,
  editableSettings,
  useChannelSettingsSchema,
} from '@gitroom/frontend/components/editor/use.channel.settings';
import { Card, CardHeader } from '@gitroom/frontend/components/ui/card';
import { PillTabs } from '@gitroom/frontend/components/ui/pill.tabs';
import { PillButton } from '@gitroom/frontend/components/ui/pill.button';
import { ChannelIcon } from '@gitroom/frontend/components/ui/channel.icon';

type Format = 'carousel' | 'image' | 'text';
type Size = keyof typeof SLIDE_SIZES;
type Background = { type: 'none' } | { type: 'ai'; prompt: string } | { type: 'url'; url: string };

interface SlideDraft {
  kicker: string;
  headline: string;
  body: string;
  theme: '' | SlideTheme;
  background: Background;
}

interface Channel {
  id: string;
  name: string;
  identifier: string;
  picture: string | null;
  disabled: boolean;
}

const FORMATS: Format[] = ['carousel', 'image', 'text'];
const SIZES = Object.keys(SLIDE_SIZES) as Size[];
const MAX_SLIDES = 10;
const PREVIEW_WIDTH = 320;

const emptySlide = (): SlideDraft => ({
  kicker: '',
  headline: '',
  body: '',
  theme: '',
  background: { type: 'none' },
});

const inputClass =
  'w-full h-[48px] px-[16px] rounded-[16px] bg-newBgColor text-[15px] text-newTextColor outline-none focus:ring-2 focus:ring-accent';

const Field: FC<{ label: string; children: (id: string) => ReactNode; id: string }> = ({ label, children, id }) => (
  <div className="flex flex-col gap-[6px]">
    <label htmlFor={id} className="text-[14px] text-textItemBlur">
      {label}
    </label>
    {children(id)}
  </div>
);

const SlidePreview: FC<{
  slide: SlideDraft;
  index: number;
  total: number;
  size: Size;
  brand: { name: string; handle: string; primaryColor: string };
}> = ({ slide, index, total, size, brand }) => {
  const t = useT();
  const dimensions = SLIDE_SIZES[size];
  const scale = PREVIEW_WIDTH / dimensions.width;
  const html = useMemo(() => {
    try {
      return buildSlideHtml({
        slide: {
          kicker: slide.kicker || undefined,
          headline: slide.headline || undefined,
          body: slide.body || undefined,
          theme: slide.theme || undefined,
        },
        index,
        total,
        size: dimensions,
        brand: {
          ...DEFAULT_BRAND,
          primaryColor: brand.primaryColor,
          name: brand.name || undefined,
          handle: brand.handle || undefined,
        },
      });
    } catch (err: unknown) {
      if (err instanceof CompositionValidationError) {
        return null;
      }
      throw err;
    }
  }, [slide, index, total, dimensions, brand]);

  return (
    <div
      className="relative overflow-hidden rounded-[24px] bg-newBgColor shrink-0"
      style={{ width: PREVIEW_WIDTH, height: dimensions.height * scale }}
    >
      {html ? (
        <iframe
          title={t('slide_preview', 'Preview of slide {{index}}', { index: index + 1 })}
          srcDoc={html}
          sandbox=""
          className="absolute top-0 start-0 border-0 pointer-events-none origin-top-left"
          style={{ width: dimensions.width, height: dimensions.height, transform: `scale(${scale})` }}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center p-[24px] text-center text-[14px] text-textItemBlur">
          {t('fill_the_slide', 'Write a kicker, a headline or a text to see the slide')}
        </span>
      )}
      {slide.background.type !== 'none' && (
        <span className="absolute bottom-[12px] start-[12px] end-[12px] rounded-full bg-ink/80 text-inkText text-[12px] px-[12px] py-[6px] text-center">
          {slide.background.type === 'ai'
            ? t('background_ai_on_generate', 'AI background is created when you send')
            : t('background_url_on_generate', 'The image background is applied when you send')}
        </span>
      )}
    </div>
  );
};

const ChannelSettings: FC<{
  channel: Channel;
  caption: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}> = ({ channel, caption, value, onChange }) => {
  const t = useT();
  const { data: schema } = useChannelSettingsSchema(channel.id);
  const fields = editableSettings(schema);
  const missingDefaults = !!schema && fields.some(([key]) => value[key] === undefined);

  useEffect(() => {
    if (missingDefaults) {
      onChange({ ...defaultSettings(schema), ...value });
    }
  }, [missingDefaults, schema, value, onChange]);

  const tooLong = !!schema?.maxLength && caption.length > schema.maxLength;

  return (
    <div className="flex flex-wrap items-center gap-[12px] ps-[52px]">
      {!!schema?.maxLength && (
        <span className={clsx('text-[13px]', tooLong ? 'text-statusErrorText' : 'text-textItemBlur')}>
          {t('caption_length', '{{length}} of {{max}} characters', { length: caption.length, max: schema.maxLength })}
        </span>
      )}
      {fields.map(([key, property]) =>
        property.enum ? (
          <select
            key={key}
            aria-label={key}
            value={String(value[key] ?? property.enum[0])}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
            className="h-[40px] px-[14px] rounded-full bg-newBgColor text-[14px]"
          >
            {property.enum.map((option) => (
              <option key={option} value={option}>
                {key.replace(/_/g, ' ')}: {option}
              </option>
            ))}
          </select>
        ) : (
          <label key={key} className="flex items-center gap-[8px] h-[40px] px-[14px] rounded-full bg-newBgColor text-[14px]">
            <input
              type="checkbox"
              aria-label={key}
              checked={!!value[key]}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
            />
            {key.replace(/_/g, ' ')}
          </label>
        )
      )}
    </div>
  );
};

export const EditorComponent: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const date = useLocalDate();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data: integrations = [] } = useIntegrationList();
  const channels = (integrations as Channel[]).filter((channel) => !channel.disabled);

  const format: Format = FORMATS.includes(search.get('format') as Format) ? (search.get('format') as Format) : 'carousel';
  const size: Size = SIZES.includes(search.get('size') as Size) ? (search.get('size') as Size) : 'portrait';

  const [slides, setSlides] = useState<SlideDraft[]>([emptySlide(), emptySlide()]);
  const [brand, setBrand] = useState({ name: '', handle: '', primaryColor: DEFAULT_BRAND.primaryColor });
  const [caption, setCaption] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [publishAt, setPublishAt] = useState(() =>
    date().add(1, 'day').hour(12).minute(0).format('YYYY-MM-DDTHH:mm')
  );
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const visibleSlides = format === 'text' ? [] : format === 'image' ? slides.slice(0, 1) : slides;
  const current = Math.min(
    Math.max(0, Number(search.get('slide') || 1) - 1),
    Math.max(0, visibleSlides.length - 1)
  );

  const setQuery = useCallback(
    (changes: Record<string, string>) => {
      const params = new URLSearchParams(search.toString());
      Object.entries(changes).forEach(([key, value]) => params.set(key, value));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [search, pathname]
  );

  const updateSlide = useCallback(
    (changes: Partial<SlideDraft>) =>
      setSlides((list) => list.map((slide, index) => (index === current ? { ...slide, ...changes } : slide))),
    [current]
  );

  const addSlide = useCallback(() => {
    setSlides((list) => [...list, emptySlide()]);
    setQuery({ slide: String(slides.length + 1) });
  }, [slides.length, setQuery]);

  const removeSlide = useCallback(() => {
    setSlides((list) => list.filter((_, index) => index !== current));
    setQuery({ slide: String(Math.max(1, current)) });
  }, [current, setQuery]);

  const toggleChannel = useCallback((id: string, checked: boolean) => {
    setSelected((list) => (checked ? [...list, id] : list.filter((item) => item !== id)));
  }, []);

  const submit = useCallback(async () => {
    setError('');
    if (!selected.length) {
      setError(t('choose_a_channel', 'Choose at least one channel'));
      return;
    }
    if (!caption.trim()) {
      setError(t('write_a_caption', 'Write the caption of the post'));
      return;
    }
    setSending(true);
    try {
      const response = await fetch('/compositions', {
        method: 'POST',
        body: JSON.stringify({
          date: date(publishAt).toISOString(),
          format,
          size,
          requiresApproval,
          brand: {
            primaryColor: brand.primaryColor.toUpperCase(),
            ...(brand.name ? { name: brand.name } : {}),
            ...(brand.handle ? { handle: brand.handle } : {}),
          },
          ...(format === 'text'
            ? {}
            : {
                slides: visibleSlides.map((slide) => ({
                  ...(slide.kicker ? { kicker: slide.kicker } : {}),
                  ...(slide.headline ? { headline: slide.headline } : {}),
                  ...(slide.body ? { body: slide.body } : {}),
                  ...(slide.theme ? { theme: slide.theme } : {}),
                  ...(slide.background.type !== 'none' ? { background: slide.background } : {}),
                })),
              }),
          targets: selected.map((integrationId) => ({
            integrationId,
            content: caption,
            settings: settings[integrationId] || {},
          })),
        }),
      });
      const json = (await response.json()) as { id?: string; message?: string | string[] };
      if (!response.ok || !json.id) {
        setError(Array.isArray(json.message) ? json.message.join('; ') : json.message || response.statusText);
        return;
      }
      router.push(requiresApproval ? `/approvals?id=${json.id}` : '/launches');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [selected, caption, publishAt, format, size, requiresApproval, brand, visibleSlides, settings]);

  const slide = visibleSlides[current];

  return (
    <div className="flex-1 flex flex-col gap-[20px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <PillTabs
          label={t('format', 'Format')}
          value={format}
          onChange={(value) => setQuery({ format: value, slide: '1' })}
          items={[
            { id: 'carousel', label: t('format_carousel', 'Carousel') },
            { id: 'image', label: t('format_image', 'Image') },
            { id: 'text', label: t('format_text', 'Text') },
          ]}
        />
        {format !== 'text' && (
          <PillTabs
            label={t('size', 'Size')}
            value={size}
            onChange={(value) => setQuery({ size: value })}
            items={[
              { id: 'portrait', label: t('size_portrait', 'Portrait') },
              { id: 'square', label: t('size_square', 'Square') },
              { id: 'story', label: t('size_story', 'Story') },
            ]}
          />
        )}
      </div>

      <div className="flex gap-[20px] items-start mobile:flex-col">
        <div className="flex-1 min-w-0 flex flex-col gap-[20px]">
          {slide && (
            <Card>
              <CardHeader
                title={
                  format === 'carousel'
                    ? t('slide_of', 'Slide {{index}} of {{total}}', { index: current + 1, total: visibleSlides.length })
                    : t('image', 'Image')
                }
              />
              {format === 'carousel' && (
                <div className="flex flex-wrap gap-[8px]" role="tablist" aria-label={t('slides', 'Slides')}>
                  {visibleSlides.map((item, index) => (
                    <button
                      key={index}
                      type="button"
                      role="tab"
                      aria-selected={index === current}
                      onClick={() => setQuery({ slide: String(index + 1) })}
                      className={clsx(
                        'h-[40px] min-w-[40px] px-[14px] rounded-full text-[14px]',
                        index === current ? 'bg-ink text-inkText' : 'bg-newBgColor'
                      )}
                    >
                      {index + 1}
                    </button>
                  ))}
                  {visibleSlides.length < MAX_SLIDES && (
                    <PillButton className="!h-[40px] !px-[16px] !text-[14px]" onClick={addSlide}>
                      {t('add_slide', 'Add slide')}
                    </PillButton>
                  )}
                  {visibleSlides.length > 2 && (
                    <PillButton className="!h-[40px] !px-[16px] !text-[14px]" onClick={removeSlide}>
                      {t('remove_slide', 'Remove slide')}
                    </PillButton>
                  )}
                </div>
              )}
              <div data-testid="slide-form" className="flex gap-[20px] mobile:flex-col-reverse">
                <div className="flex-1 min-w-0 flex flex-col gap-[14px]">
                  <Field label={t('kicker', 'Kicker')} id="slide-kicker">
                    {(id) => (
                      <input id={id} maxLength={80} className={inputClass} value={slide.kicker} onChange={(e) => updateSlide({ kicker: e.target.value })} />
                    )}
                  </Field>
                  <Field label={t('headline', 'Headline')} id="slide-headline">
                    {(id) => (
                      <input id={id} maxLength={200} className={inputClass} value={slide.headline} onChange={(e) => updateSlide({ headline: e.target.value })} />
                    )}
                  </Field>
                  <Field label={t('slide_text', 'Text')} id="slide-body">
                    {(id) => (
                      <textarea
                        id={id}
                        rows={4}
                        maxLength={600}
                        className={clsx(inputClass, '!h-auto py-[12px] resize-y')}
                        value={slide.body}
                        onChange={(e) => updateSlide({ body: e.target.value })}
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-[14px]">
                    <div className="flex-1 min-w-[160px]">
                      <Field label={t('theme', 'Theme')} id="slide-theme">
                        {(id) => (
                          <select id={id} className={inputClass} value={slide.theme} onChange={(e) => updateSlide({ theme: e.target.value as SlideDraft['theme'] })}>
                            <option value="">{t('theme_auto', 'Automatic')}</option>
                            <option value="accent">{t('theme_accent', 'Brand color')}</option>
                            <option value="light">{t('theme_light', 'Light')}</option>
                            <option value="dark">{t('theme_dark', 'Dark')}</option>
                          </select>
                        )}
                      </Field>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <Field label={t('background', 'Background')} id="slide-background">
                        {(id) => (
                          <select
                            id={id}
                            className={inputClass}
                            value={slide.background.type}
                            onChange={(e) =>
                              updateSlide({
                                background:
                                  e.target.value === 'ai'
                                    ? { type: 'ai', prompt: '' }
                                    : e.target.value === 'url'
                                    ? { type: 'url', url: '' }
                                    : { type: 'none' },
                              })
                            }
                          >
                            <option value="none">{t('background_none', 'Solid color')}</option>
                            <option value="ai">{t('background_ai', 'Generated by AI')}</option>
                            <option value="url">{t('background_url', 'Image from a URL')}</option>
                          </select>
                        )}
                      </Field>
                    </div>
                  </div>
                  {slide.background.type === 'ai' && (
                    <Field label={t('background_prompt', 'Describe the background image')} id="slide-prompt">
                      {(id) => (
                        <textarea
                          id={id}
                          rows={2}
                          maxLength={1000}
                          className={clsx(inputClass, '!h-auto py-[12px]')}
                          value={slide.background.type === 'ai' ? slide.background.prompt : ''}
                          onChange={(e) => updateSlide({ background: { type: 'ai', prompt: e.target.value } })}
                        />
                      )}
                    </Field>
                  )}
                  {slide.background.type === 'url' && (
                    <Field label={t('background_image_url', 'Image URL (https)')} id="slide-url">
                      {(id) => (
                        <input
                          id={id}
                          type="url"
                          className={inputClass}
                          value={slide.background.type === 'url' ? slide.background.url : ''}
                          onChange={(e) => updateSlide({ background: { type: 'url', url: e.target.value } })}
                        />
                      )}
                    </Field>
                  )}
                </div>
                <SlidePreview slide={slide} index={current} total={visibleSlides.length} size={size} brand={brand} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title={t('caption_and_channels', 'Caption and channels')} />
            <Field label={t('caption', 'Caption')} id="caption">
              {(id) => (
                <textarea
                  id={id}
                  rows={6}
                  maxLength={10000}
                  className={clsx(inputClass, '!h-auto py-[12px] resize-y')}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
              )}
            </Field>
            {!channels.length ? (
              <p className="m-0 text-[15px] text-textItemBlur">
                {t('connect_a_channel_first', 'Connect a channel in Connected accounts to publish.')}
              </p>
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col">
                {channels.map((channel) => {
                  const checked = selected.includes(channel.id);
                  return (
                    <li key={channel.id} className="flex flex-col gap-[10px] py-[12px] border-t border-newBorder first:border-t-0">
                      <label className="flex items-center gap-[12px] cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-[18px] h-[18px] accent-[var(--accent)]"
                          checked={checked}
                          aria-label={channel.name}
                          onChange={(e) => toggleChannel(channel.id, e.target.checked)}
                        />
                        <ChannelIcon identifier={channel.identifier} picture={channel.picture} name={channel.name} size={36} />
                        <span className="text-[15px] font-[500]">{channel.name}</span>
                      </label>
                      {checked && (
                        <ChannelSettings
                          channel={channel}
                          caption={caption}
                          value={settings[channel.id] || {}}
                          onChange={(value) => setSettings((all) => ({ ...all, [channel.id]: value }))}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="w-[340px] mobile:w-full shrink-0">
          <CardHeader title={t('schedule', 'Schedule')} />
          <Field label={t('publish_at', 'Publish at')} id="publish-at">
            {(id) => (
              <input id={id} type="datetime-local" className={inputClass} value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
            )}
          </Field>
          <Field label={t('brand_name', 'Brand name')} id="brand-name">
            {(id) => (
              <input id={id} maxLength={60} className={inputClass} value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
            )}
          </Field>
          <Field label={t('brand_handle', 'Handle')} id="brand-handle">
            {(id) => (
              <input id={id} maxLength={60} className={inputClass} value={brand.handle} onChange={(e) => setBrand({ ...brand, handle: e.target.value })} />
            )}
          </Field>
          <Field label={t('brand_color', 'Brand color')} id="brand-color">
            {(id) => (
              <input
                id={id}
                type="color"
                className="w-full h-[48px] rounded-[16px] bg-newBgColor px-[8px]"
                value={brand.primaryColor}
                onChange={(e) => setBrand({ ...brand, primaryColor: e.target.value })}
              />
            )}
          </Field>
          <label className="flex items-center gap-[10px] text-[15px] cursor-pointer">
            <input
              type="checkbox"
              className="w-[18px] h-[18px] accent-[var(--accent)]"
              checked={requiresApproval}
              onChange={(e) => setRequiresApproval(e.target.checked)}
            />
            {t('requires_approval', 'Review before scheduling')}
          </label>
          {!!error && (
            <p role="alert" className="m-0 rounded-[16px] bg-statusErrorBg text-statusErrorText px-[16px] py-[12px] text-[14px]">
              {error}
            </p>
          )}
          <PillButton variant="primary" disabled={sending} onClick={submit}>
            {requiresApproval
              ? t('generate_and_send_for_approval', 'Generate and send for approval')
              : t('generate_and_schedule', 'Generate and schedule')}
          </PillButton>
        </Card>
      </div>
    </div>
  );
};
