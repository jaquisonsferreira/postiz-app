import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdsAutoBoostDto,
  AdsBoostDto,
  AdsBudgetRuleDto,
  AdsCampaignBudgetDto,
  AdsCampaignStatusDto,
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

  it('recusa dias que não existem no calendário', async () => {
    expect(await errorsOf(AdsSummaryDto, { from: '2026-13-45', to: '2026-02-30' })).toEqual([
      'from',
      'to',
    ]);
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

  it('aceita só ativar ou pausar a campanha', async () => {
    expect(await errorsOf(AdsCampaignStatusDto, { status: 'paused' })).toEqual([]);
    expect(await errorsOf(AdsCampaignStatusDto, { status: 'removed' })).toEqual(['status']);
  });

  it('exige orçamento inteiro e positivo em centavos', async () => {
    expect(await errorsOf(AdsCampaignBudgetDto, { amount: 5000 })).toEqual([]);
    expect(await errorsOf(AdsCampaignBudgetDto, { amount: 0 })).toEqual(['amount']);
    expect(await errorsOf(AdsCampaignBudgetDto, { amount: 10.5 })).toEqual(['amount']);
  });

  it('aceita regra com campos vazios e recusa alerta fora de 1 a 100', async () => {
    expect(
      await errorsOf(AdsBudgetRuleDto, { monthlyCap: 100000, approvalThreshold: null, alertAt: 80 })
    ).toEqual([]);
    expect(
      await errorsOf(AdsBudgetRuleDto, { monthlyCap: -1, approvalThreshold: 0, alertAt: 120 })
    ).toEqual(['monthlyCap', 'approvalThreshold', 'alertAt']);
  });

  const boost = {
    postId: 'post-1',
    adAccountId: 'account-1',
    objective: 'engagement',
    budgetType: 'daily',
    budgetAmount: 2000,
    days: 7,
    audience: { countries: ['BR'], ageMin: 18, ageMax: 65 },
  };

  it('aceita um impulsionamento completo', async () => {
    expect(await errorsOf(AdsBoostDto, boost)).toEqual([]);
    expect(
      await errorsOf(AdsBoostDto, {
        ...boost,
        destinationUrl: 'https://loja.com.br',
        texts: {
          headline: 'Coleção nova',
          longHeadline: 'A coleção de verão chegou',
          description: 'Peças com desconto',
          businessName: 'Loja',
        },
      })
    ).toEqual([]);
  });

  it('recusa objetivo, orçamento, duração, público e link inválidos', async () => {
    expect(
      await errorsOf(AdsBoostDto, {
        ...boost,
        objective: 'sales',
        budgetType: 'weekly',
        budgetAmount: 0,
        days: 0,
        audience: { countries: ['Brasil'], ageMin: 10, ageMax: 70 },
        destinationUrl: 'javascript:alert(1)',
      })
    ).toEqual(['objective', 'budgetType', 'budgetAmount', 'days', 'audience', 'destinationUrl']);
  });

  it('recusa título longo demais para os anúncios', async () => {
    expect(
      await errorsOf(AdsBoostDto, {
        ...boost,
        texts: {
          headline: 'x'.repeat(41),
          longHeadline: 'ok',
          description: 'ok',
          businessName: 'ok',
        },
      })
    ).toEqual(['texts']);
  });

  it('exige o canal no impulsionar automático', async () => {
    const { postId, ...rule } = boost;
    expect(postId).toBe('post-1');
    expect(await errorsOf(AdsAutoBoostDto, { ...rule, integrationId: 'channel-1' })).toEqual([]);
    expect(await errorsOf(AdsAutoBoostDto, rule)).toEqual(['integrationId']);
  });
});
