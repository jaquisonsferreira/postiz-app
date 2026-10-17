import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export const COMPOSITION_STATUSES = [
  'pending',
  'rendering',
  'scheduling',
  'queueing',
  'awaiting_approval',
  'approving',
  'scheduled',
  'failed',
] as const;

export class GetCompositionsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 0;

  @IsOptional()
  @IsIn(COMPOSITION_STATUSES)
  status?: (typeof COMPOSITION_STATUSES)[number];
}
