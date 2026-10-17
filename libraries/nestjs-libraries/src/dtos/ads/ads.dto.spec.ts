import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdsSummaryDto,
  ConnectAdsDto,
  SaveAdAccountsDto,
} from '@gitroom/nestjs-libraries/dtos/ads/ads.dto';

const errorsOf = async <T extends object>(
  dto: new () => T,
  body: Record<string, unknown>
): Promise<string[]> =>
  (await validate(plainToInstance(dto, body))).map((error) => error.property);

describe('Ads DTOs', () => {
  it('aceita um período de dias', async () => {
    expect(await errorsOf(AdsSummaryDto, { from: '2026-10-01', to: '2026-10-17' })).toEqual([]);
  });

  it('recusa datas fora do formato de dia', async () => {
    expect(
      await errorsOf(AdsSummaryDto, { from: '01/10/2026', to: "2026-10-17' OR 1=1" })
    ).toEqual(['from', 'to']);
  });

  it('exige o código e o estado do login', async () => {
    expect(await errorsOf(ConnectAdsDto, { code: 'codigo', state: 'estado' })).toEqual([]);
    expect(await errorsOf(ConnectAdsDto, {})).toEqual(['code', 'state']);
  });

  it('exige ao menos uma conta escolhida', async () => {
    const connection = '0d6f2f5e-6a3b-4c1d-9f1e-2b7c8d9e0a1b';
    expect(
      await errorsOf(SaveAdAccountsDto, { connection, externalIds: ['111'] })
    ).toEqual([]);
    expect(await errorsOf(SaveAdAccountsDto, { connection, externalIds: [] })).toEqual([
      'externalIds',
    ]);
    expect(
      await errorsOf(SaveAdAccountsDto, { connection: 'qualquer', externalIds: [1] })
    ).toEqual(['connection', 'externalIds']);
  });
});
