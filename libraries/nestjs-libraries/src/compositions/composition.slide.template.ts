import { CompositionValidationError } from '@gitroom/nestjs-libraries/compositions/composition.errors';

export type SlideTheme = 'accent' | 'light' | 'dark';

export interface CompositionBrand {
  primaryColor: string;
  darkColor: string;
  lightColor: string;
  headingFont: string;
  bodyFont: string;
  name?: string;
  handle?: string;
  logo?: string;
}

export interface SlideContent {
  kicker?: string;
  headline?: string;
  body?: string;
  theme?: SlideTheme;
}

export interface SlideSize {
  width: number;
  height: number;
}

export interface SlideTemplateInput {
  slide: SlideContent;
  index: number;
  total: number;
  size: SlideSize;
  brand: CompositionBrand;
  backgroundImage?: string;
}

export const DEFAULT_BRAND: CompositionBrand = {
  primaryColor: '#6D4AFF',
  darkColor: '#17151F',
  lightColor: '#FFFFFF',
  headingFont: 'Bricolage Grotesque',
  bodyFont: 'Manrope',
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT_NAME = /^[A-Za-z0-9 ]{1,60}$/;
const IMAGE_DATA_URI = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const assertColor = (name: string, value: string): string => {
  if (!HEX_COLOR.test(value)) {
    throw new CompositionValidationError(`${name} must be a #RRGGBB color`);
  }
  return value;
};

const assertFont = (name: string, value: string): string => {
  if (!FONT_NAME.test(value)) {
    throw new CompositionValidationError(`${name} has invalid characters`);
  }
  return value;
};

const assertImage = (name: string, value?: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!IMAGE_DATA_URI.test(value)) {
    throw new CompositionValidationError(`${name} must be an image data URI`);
  }
  return value;
};

export const resolveSlideTheme = (
  index: number,
  total: number,
  explicit?: SlideTheme
): SlideTheme => {
  if (explicit) {
    return explicit;
  }
  if (index === 0) {
    return 'accent';
  }
  if (total >= 3 && index === total - 1) {
    return 'dark';
  }
  return 'light';
};

const HEADLINE_LINE_HEIGHT = 1.05;
const BODY_LINE_HEIGHT = 1.4;
// average glyph width as a share of the font size, kept on the wide side so
// the estimate errs towards smaller text rather than clipped text
const HEADLINE_GLYPH = 0.6;
const BODY_GLYPH = 0.56;

const estimateHeight = (
  text: string,
  fontSize: number,
  glyph: number,
  lineHeight: number,
  width: number
): number => {
  const perLine = Math.max(1, Math.floor(width / (fontSize * glyph)));
  const lines = text
    .split('\n')
    .reduce((total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
  return lines * fontSize * lineHeight;
};

// Scripts are off in the renderer, so the text can't be measured on the page:
// the sizes start from the design's and shrink until the estimate fits
// share of the content width the kicker and the brand get in the top bar,
// and the handle in the bottom bar
const KICKER_SHARE = 0.55;
const BRAND_SHARE = 0.45;
const HANDLE_SHARE = 0.75;
const BAR_FONT = 28;
const BAR_LINE_HEIGHT = 1.25;

export const fitTextSizes = (
  slide: SlideContent,
  size: SlideSize,
  bars: { brand?: string; handle?: string } = {}
): { headline: number; body: number } => {
  const scale = size.width / 1080;
  const padding = 88 * scale;
  const width = size.width - padding * 2;
  const barFont = BAR_FONT * scale;
  const barHeight = (text: string | undefined, share: number) =>
    text ? estimateHeight(text, barFont, BODY_GLYPH, BAR_LINE_HEIGHT, width * share) : barFont * BAR_LINE_HEIGHT;
  const top = Math.max(barHeight(slide.kicker, KICKER_SHARE), barHeight(bars.brand, BRAND_SHARE));
  const bottom = barHeight(bars.handle, HANDLE_SHARE);
  const chrome = padding * 2 + top + bottom + 2 * 32 * scale;
  const available = size.height - chrome;
  const headline = slide.headline || '';
  const startHeadline =
    (headline.length <= 40 ? 92 : headline.length <= 80 ? 76 : 60) * scale;
  const startBody = 38 * scale;

  for (let factor = 1; factor > 0.3; factor -= 0.02) {
    const headlineFont = startHeadline * factor;
    const bodyFont = startBody * factor;
    const height =
      (headline ? estimateHeight(headline, headlineFont, HEADLINE_GLYPH, HEADLINE_LINE_HEIGHT, width) : 0) +
      (slide.body ? estimateHeight(slide.body, bodyFont, BODY_GLYPH, BODY_LINE_HEIGHT, width) + 32 * scale : 0);
    if (height <= available) {
      return { headline: Math.floor(headlineFont), body: Math.floor(bodyFont) };
    }
  }
  return { headline: Math.floor(startHeadline * 0.3), body: Math.floor(startBody * 0.3) };
};

const googleFontsUrl = (headingFont: string, bodyFont: string): string => {
  const family = (font: string, weights: string) =>
    `family=${font.replace(/ /g, '+')}:wght@${weights}`;
  return `https://fonts.googleapis.com/css2?${family(
    headingFont,
    '600;700'
  )}&${family(bodyFont, '400;500;700')}&display=block`;
};

export const buildSlideHtml = (input: SlideTemplateInput): string => {
  const { slide, index, total, size } = input;
  const brand = {
    primaryColor: assertColor('primaryColor', input.brand.primaryColor),
    darkColor: assertColor('darkColor', input.brand.darkColor),
    lightColor: assertColor('lightColor', input.brand.lightColor),
    headingFont: assertFont('headingFont', input.brand.headingFont),
    bodyFont: assertFont('bodyFont', input.brand.bodyFont),
    logo: assertImage('logo', input.brand.logo),
  };
  const backgroundImage = assertImage('backgroundImage', input.backgroundImage);

  if (!slide.kicker && !slide.headline && !slide.body && !backgroundImage) {
    throw new CompositionValidationError(
      `Slide ${index + 1} needs text or a background image`
    );
  }

  const theme = resolveSlideTheme(index, total, slide.theme);
  const background =
    theme === 'accent'
      ? brand.primaryColor
      : theme === 'dark'
      ? brand.darkColor
      : brand.lightColor;
  const foreground =
    backgroundImage || theme !== 'light' ? brand.lightColor : brand.darkColor;
  const scale = size.width / 1080;
  const padding = Math.round(88 * scale);
  const fonts = fitTextSizes(slide, size, { brand: input.brand.name, handle: input.brand.handle });

  const brandName = input.brand.name ? escapeHtml(input.brand.name) : '';
  const handle = input.brand.handle ? escapeHtml(input.brand.handle) : '';
  const position = total > 1 ? `${index + 1}/${total}` : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${googleFontsUrl(brand.headingFont, brand.bodyFont)}">
<style>
:root { --background: ${background}; --foreground: ${foreground}; }
* { box-sizing: border-box; }
h1, p, span { overflow-wrap: anywhere; }
html, body { margin: 0; padding: 0; }
body { width: ${size.width}px; height: ${size.height}px; overflow: hidden; }
.slide { position: relative; width: ${size.width}px; height: ${size.height}px; background: var(--background); color: var(--foreground); font-family: '${brand.bodyFont}', sans-serif; }
.background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.78) 100%); }
.content { position: relative; height: 100%; padding: ${padding}px; display: flex; flex-direction: column; justify-content: space-between; gap: ${Math.round(32 * scale)}px; }
.top, .bottom { display: flex; align-items: flex-start; justify-content: space-between; gap: ${Math.round(24 * scale)}px; font-size: ${Math.round(28 * scale)}px; font-weight: 700; }
.kicker { flex: 0 1 ${KICKER_SHARE * 100}%; min-width: 0; overflow-wrap: anywhere; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85; }
.brand { flex: 0 1 auto; max-width: ${BRAND_SHARE * 100}%; min-width: 0; overflow-wrap: anywhere; text-align: right; justify-content: flex-end; display: flex; align-items: center; gap: ${Math.round(16 * scale)}px; }
.handle { max-width: ${HANDLE_SHARE * 100}%; min-width: 0; }
.logo { height: ${Math.round(56 * scale)}px; width: auto; min-width: 0; max-width: 100%; object-fit: contain; object-position: right center; }
.text { min-width: 0; display: flex; flex-direction: column; gap: ${Math.round(32 * scale)}px; margin-top: ${backgroundImage ? 'auto' : '0'}; }
h1 { margin: 0; font-family: '${brand.headingFont}', sans-serif; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; font-size: ${fonts.headline}px; }
p { margin: 0; font-size: ${fonts.body}px; line-height: 1.4; font-weight: 500; opacity: 0.92; white-space: pre-line; }
</style>
</head>
<body>
<div class="slide">
${backgroundImage ? `<img class="background" alt="" src="${backgroundImage}">\n<div class="overlay"></div>` : ''}
<div class="content">
<div class="top"><span class="kicker">${slide.kicker ? escapeHtml(slide.kicker) : ''}</span><span class="brand">${brand.logo ? `<img class="logo" alt="" src="${brand.logo}">` : ''}${brandName}</span></div>
<div class="text">${slide.headline ? `<h1>${escapeHtml(slide.headline)}</h1>` : ''}${slide.body ? `<p>${escapeHtml(slide.body)}</p>` : ''}</div>
<div class="bottom"><span class="handle">${handle}</span><span>${position}</span></div>
</div>
</div>
</body>
</html>`;
};
