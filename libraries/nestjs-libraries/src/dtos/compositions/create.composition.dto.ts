import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

export const COMPOSITION_FORMATS = ['carousel', 'image', 'text'] as const;
export const COMPOSITION_SIZES = ['portrait', 'square', 'story'] as const;
export const SLIDE_THEMES = ['accent', 'light', 'dark'] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FONT_NAME = /^[A-Za-z0-9 ]{1,60}$/;
const HTTPS_URL = { protocols: ['https'], require_protocol: true };

const SLIDES_PER_FORMAT: Record<(typeof COMPOSITION_FORMATS)[number], [number, number]> = {
  carousel: [2, 10],
  image: [1, 1],
  text: [0, 0],
};

@ValidatorConstraint({ name: 'slidesMatchFormat' })
class SlidesMatchFormat implements ValidatorConstraintInterface {
  validate(slides: unknown, args: ValidationArguments): boolean {
    const range = SLIDES_PER_FORMAT[(args.object as CreateCompositionDto).format];
    if (!range) {
      return true;
    }
    const count = Array.isArray(slides) ? slides.length : 0;
    return count >= range[0] && count <= range[1];
  }

  defaultMessage(args: ValidationArguments): string {
    const format = (args.object as CreateCompositionDto).format;
    const [min, max] = SLIDES_PER_FORMAT[format];
    return min === max
      ? `${format} needs exactly ${min} slide(s)`
      : `${format} needs between ${min} and ${max} slides`;
  }
}

// The template needs something to draw: a slide with no text and no
// background would only fail later, inside the workflow
@ValidatorConstraint({ name: 'slideHasContent' })
class SlideHasContent implements ValidatorConstraintInterface {
  validate(slide: unknown): boolean {
    if (!slide || typeof slide !== 'object') {
      return true;
    }
    const { kicker, headline, body, background } = slide as CompositionSlideDto;
    return (
      [kicker, headline, body].some((text) => typeof text === 'string' && !!text.trim()) ||
      !!background
    );
  }

  defaultMessage(): string {
    return 'each slide needs a kicker, headline, body or background';
  }
}

const MAX_SETTINGS_LENGTH = 20000;
const MAX_SETTINGS_DEPTH = 10;

// Stops at the limit, so a body nested thousands of levels deep is refused
// before anything walks or serializes it whole
const withinDepth = (value: unknown, levels: number): boolean =>
  !value ||
  typeof value !== 'object' ||
  (levels > 0 && Object.values(value).every((child) => withinDepth(child, levels - 1)));

// The settings are free-form for each provider, so only their weight is
// bounded: they are stored on the composition and sent to the provider checks
@ValidatorConstraint({ name: 'boundedSettings' })
class BoundedSettings implements ValidatorConstraintInterface {
  validate(settings: unknown): boolean {
    if (settings === undefined) {
      return true;
    }
    return (
      withinDepth(settings, MAX_SETTINGS_DEPTH) &&
      JSON.stringify(settings).length <= MAX_SETTINGS_LENGTH
    );
  }

  defaultMessage(): string {
    return `settings must be at most ${MAX_SETTINGS_LENGTH} characters as JSON and ${MAX_SETTINGS_DEPTH} levels deep`;
  }
}

export class CompositionBackgroundDto {
  @IsIn(['ai', 'url'])
  type: 'ai' | 'url';

  @ValidateIf((o: CompositionBackgroundDto) => o.type === 'ai')
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  prompt?: string;

  @ValidateIf((o: CompositionBackgroundDto) => o.type === 'url')
  @IsUrl(HTTPS_URL)
  url?: string;
}

export class CompositionSlideDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  kicker?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  body?: string;

  @IsOptional()
  @IsIn(SLIDE_THEMES)
  theme?: (typeof SLIDE_THEMES)[number];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CompositionBackgroundDto)
  background?: CompositionBackgroundDto;
}

export class CompositionBrandDto {
  @IsOptional()
  @Matches(HEX_COLOR)
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR)
  darkColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR)
  lightColor?: string;

  @IsOptional()
  @Matches(FONT_NAME)
  headingFont?: string;

  @IsOptional()
  @Matches(FONT_NAME)
  bodyFont?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  handle?: string;

  @IsOptional()
  @IsUrl(HTTPS_URL)
  logoUrl?: string;
}

export class CompositionTargetDto {
  @IsDefined()
  @IsString()
  integrationId: string;

  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(10000, { each: true })
  comments?: string[];

  @IsOptional()
  @IsObject()
  @Validate(BoundedSettings)
  settings?: Record<string, unknown>;
}

export class CompositionTagDto {
  @IsString()
  @MaxLength(100)
  value: string;

  @IsString()
  @MaxLength(100)
  label: string;
}

export class CreateCompositionDto {
  @IsDateString()
  date: string;

  @IsIn(COMPOSITION_FORMATS)
  format: (typeof COMPOSITION_FORMATS)[number];

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsIn(COMPOSITION_SIZES)
  size?: (typeof COMPOSITION_SIZES)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => CompositionBrandDto)
  brand?: CompositionBrandDto;

  @Validate(SlidesMatchFormat)
  @ValidateIf(
    (o: CreateCompositionDto) =>
      o.slides !== undefined || (SLIDES_PER_FORMAT[o.format]?.[0] ?? 0) > 0
  )
  @IsArray()
  @IsObject({ each: true })
  @Validate(SlideHasContent, { each: true })
  @ValidateNested({ each: true })
  @Type(() => CompositionSlideDto)
  slides?: CompositionSlideDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => CompositionTargetDto)
  targets: CompositionTargetDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => CompositionTagDto)
  tags?: CompositionTagDto[];
}
