import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class AdsSummaryDto {
  @Matches(DAY)
  @IsDateString({ strict: true })
  from: string;

  @Matches(DAY)
  @IsDateString({ strict: true })
  to: string;
}

export class ConnectAdsDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  state: string;
}

export class SaveAdAccountsDto {
  @IsUUID()
  connection: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  externalIds: string[];
}

export class AdsCampaignStatusDto {
  @IsIn(['active', 'paused'])
  status: 'active' | 'paused';
}

export class AdsCampaignBudgetDto {
  @IsInt()
  @Min(1)
  amount: number;
}

export class AdsBudgetRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  monthlyCap: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  approvalThreshold: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  alertAt: number | null;
}

export class AdsAudienceDto {
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(/^[A-Z]{2}$/, { each: true })
  countries: string[];

  @IsInt()
  @Min(13)
  @Max(65)
  ageMin: number;

  @IsInt()
  @Min(13)
  @Max(65)
  ageMax: number;
}

export class AdsCreativeTextsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  headline: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  longHeadline: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(90)
  description: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(25)
  businessName: string;
}

export class AdsBoostSettingsDto {
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @IsIn(['engagement', 'reach', 'traffic'])
  objective: 'engagement' | 'reach' | 'traffic';

  @IsIn(['daily', 'lifetime'])
  budgetType: 'daily' | 'lifetime';

  @IsInt()
  @Min(1)
  budgetAmount: number;

  @IsInt()
  @Min(1)
  @Max(90)
  days: number;

  @ValidateNested()
  @Type(() => AdsAudienceDto)
  audience: AdsAudienceDto;

  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  destinationUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdsCreativeTextsDto)
  texts?: AdsCreativeTextsDto;
}

export class AdsBoostDto extends AdsBoostSettingsDto {
  @IsString()
  @IsNotEmpty()
  postId: string;
}

export class AdsAutoBoostDto extends AdsBoostSettingsDto {
  @IsString()
  @IsNotEmpty()
  integrationId: string;
}

export class AdsBoostListDto {
  @IsOptional()
  @IsIn(['awaiting_approval', 'launching', 'active', 'failed', 'rejected'])
  status?: string;
}
