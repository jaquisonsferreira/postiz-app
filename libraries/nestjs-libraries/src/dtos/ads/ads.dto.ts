import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

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
