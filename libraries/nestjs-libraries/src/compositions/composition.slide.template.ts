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

const headlineSize = (headline: string, width: number): number => {
  const scale = width / 1080;
  if (headline.length <= 40) {
    return Math.round(92 * scale);
  }
  if (headline.length <= 80) {
    return Math.round(76 * scale);
  }
  return Math.round(60 * scale);
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
html, body { margin: 0; padding: 0; }
body { width: ${size.width}px; height: ${size.height}px; overflow: hidden; }
.slide { position: relative; width: ${size.width}px; height: ${size.height}px; background: var(--background); color: var(--foreground); font-family: '${brand.bodyFont}', sans-serif; }
.background { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.78) 100%); }
.content { position: relative; height: 100%; padding: ${padding}px; display: flex; flex-direction: column; justify-content: space-between; gap: ${Math.round(32 * scale)}px; }
.top, .bottom { display: flex; align-items: center; justify-content: space-between; gap: ${Math.round(24 * scale)}px; font-size: ${Math.round(28 * scale)}px; font-weight: 700; }
.kicker { text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.85; }
.brand { display: flex; align-items: center; gap: ${Math.round(16 * scale)}px; }
.logo { height: ${Math.round(56 * scale)}px; width: auto; }
.text { display: flex; flex-direction: column; gap: ${Math.round(32 * scale)}px; margin-top: ${backgroundImage ? 'auto' : '0'}; }
h1 { margin: 0; font-family: '${brand.headingFont}', sans-serif; font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; font-size: ${headlineSize(slide.headline || '', size.width)}px; }
p { margin: 0; font-size: ${Math.round(38 * scale)}px; line-height: 1.4; font-weight: 500; opacity: 0.92; white-space: pre-line; }
</style>
</head>
<body>
<div class="slide">
${backgroundImage ? `<img class="background" alt="" src="${backgroundImage}">\n<div class="overlay"></div>` : ''}
<div class="content">
<div class="top"><span class="kicker">${slide.kicker ? escapeHtml(slide.kicker) : ''}</span><span class="brand">${brand.logo ? `<img class="logo" alt="" src="${brand.logo}">` : ''}${brandName}</span></div>
<div class="text">${slide.headline ? `<h1>${escapeHtml(slide.headline)}</h1>` : ''}${slide.body ? `<p>${escapeHtml(slide.body)}</p>` : ''}</div>
<div class="bottom"><span>${handle}</span><span>${position}</span></div>
</div>
</div>
</body>
</html>`;
};
