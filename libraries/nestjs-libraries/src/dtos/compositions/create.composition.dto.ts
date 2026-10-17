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
  settings?: Record<string, unknown>;
}

export class CompositionTagDto {
  @IsString()
  value: string;

  @IsString()
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
      Array.isArray(o.slides) || (SLIDES_PER_FORMAT[o.format]?.[0] ?? 0) > 0
  )
  @ValidateNested({ each: true })
  @Type(() => CompositionSlideDto)
  slides?: CompositionSlideDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CompositionTargetDto)
  targets: CompositionTargetDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompositionTagDto)
  tags?: CompositionTagDto[];
}
