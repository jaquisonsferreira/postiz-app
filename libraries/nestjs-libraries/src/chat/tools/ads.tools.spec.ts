import { HttpException } from '@nestjs/common';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsBoostService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service';
import { AdsAccountsListTool } from '@gitroom/nestjs-libraries/chat/tools/ads.accounts.list.tool';
import { AdsCampaignsReportTool } from '@gitroom/nestjs-libraries/chat/tools/ads.campaigns.report.tool';
import { AdsBoostOptionsTool } from '@gitroom/nestjs-libraries/chat/tools/ads.boost.options.tool';
import { AdsBoostPostTool } from '@gitroom/nestjs-libraries/chat/tools/ads.boost.post.tool';
import { AdsCampaignStatusTool } from '@gitroom/nestjs-libraries/chat/tools/ads.campaign.status.tool';
import { AdsCampaignBudgetTool } from '@gitroom/nestjs-libraries/chat/tools/ads.campaign.budget.tool';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';

// The service modules load ESM-only packages that Jest can't require, each
// test passes the stub of the calls it expects
jest.mock('@gitroom/nestjs-libraries/database/prisma/ads/ads.service', () => ({
  AdsService: class AdsService {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service', () => ({
  AdsBoostService: class AdsBoostService {},
}));

const ORGANIZATION = { id: 'org', name: 'Pauta' };

interface ToolResult {
  output: Record<string, unknown>;
}

const run = async (
  tool: AgentToolInterface,
  input: Record<string, unknown>
): Promise<ToolResult> => {
  const requestContext = new Map<string, string>([
    ['organization', JSON.stringify(ORGANIZATION)],
  ]);
  const created = tool.run() as unknown as {
    execute: (input: Record<string, unknown>, context: unknown) => Promise<ToolResult>;
  };
  return created.execute(input, { requestContext });
};

const adsWith = (calls: Record<string, jest.Mock>): AdsService => calls as unknown as AdsService;
const boostsWith = (calls: Record<string, jest.Mock>): AdsBoostService =>
  calls as unknown as AdsBoostService;

const boostInput = {
  postId: 'post-1',
  adAccountId: 'account-1',
  objective: 'engagement',
  budgetType: 'daily',
  budgetAmount: 2000,
  days: 5,
  audience: { countries: ['BR'], ageMin: 18, ageMax: 45 },
};

describe('ferramentas de anúncios do MCP', () => {
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://pauta.oriflow.io';
  });

  it('lista as contas com o gasto do mês e a regra de orçamento', async () => {
    const accounts = [
      {
        accountId: 'account-1',
        provider: 'meta-ads',
        name: 'Loja',
        currency: 'BRL',
        monthSpend: 12000,
        rule: { monthlyCap: 50000, approvalThreshold: 10000, alertAt: 80 },
      },
    ];
    const budget = jest.fn().mockResolvedValue(accounts);

    const result = await run(new AdsAccountsListTool(adsWith({ budget })), {});

    expect(budget).toHaveBeenCalledWith('org');
    expect(result).toEqual({ output: { accounts } });
  });

  it('devolve o relatório do período pedido', async () => {
    const report = { totals: [], daily: [], campaigns: [] };
    const summary = jest.fn().mockResolvedValue(report);

    const result = await run(new AdsCampaignsReportTool(adsWith({ summary })), {
      from: '2026-10-01',
      to: '2026-10-17',
    });

    expect(summary).toHaveBeenCalledWith('org', { from: '2026-10-01', to: '2026-10-17' });
    expect(result).toEqual({ output: report });
  });

  it('mostra em quais contas o post pode ser impulsionado', async () => {
    const options = jest.fn().mockResolvedValue({ reference: 'meta-post', accounts: [] });

    const result = await run(new AdsBoostOptionsTool(boostsWith({ options })), {
      postId: 'post-1',
    });

    expect(options).toHaveBeenCalledWith('org', 'post-1');
    expect(result).toEqual({ output: { reference: 'meta-post', accounts: [] } });
  });

  it('cria o impulsionamento sempre aguardando a aprovação de uma pessoa', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'boost-1', status: 'awaiting_approval' });

    const result = await run(new AdsBoostPostTool(boostsWith({ create })), boostInput);

    expect(create).toHaveBeenCalledWith('org', boostInput, 'agent');
    expect(result).toEqual({
      output: {
        id: 'boost-1',
        status: 'awaiting_approval',
        approvalUrl: 'https://pauta.oriflow.io/approvals',
      },
    });
  });

  it('devolve a recusa do serviço como erro da ferramenta', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new HttpException('This ad account reached its monthly budget', 400));

    const result = await run(new AdsBoostPostTool(boostsWith({ create })), boostInput);

    expect(result).toEqual({
      output: { errors: 'This ad account reached its monthly budget' },
    });
  });

  it('pausa a campanha da organização', async () => {
    const setCampaignStatus = jest
      .fn()
      .mockResolvedValue({ id: 'campaign-1', status: 'paused', budgetAmount: 5000 });

    const result = await run(new AdsCampaignStatusTool(adsWith({ setCampaignStatus })), {
      campaignId: 'campaign-1',
      status: 'paused',
    });

    expect(setCampaignStatus).toHaveBeenCalledWith('org', 'campaign-1', 'paused');
    expect(result).toEqual({
      output: { id: 'campaign-1', status: 'paused', budgetAmount: 5000 },
    });
  });

  it('muda o orçamento e repassa quando a campanha não tem orçamento próprio', async () => {
    const updateCampaignBudget = jest
      .fn()
      .mockResolvedValueOnce({ id: 'campaign-1', status: 'active', budgetAmount: 8000 })
      .mockRejectedValueOnce(new HttpException('This campaign has no budget of its own', 400));
    const tool = new AdsCampaignBudgetTool(adsWith({ updateCampaignBudget }));

    expect(await run(tool, { campaignId: 'campaign-1', amount: 8000 })).toEqual({
      output: { id: 'campaign-1', status: 'active', budgetAmount: 8000 },
    });
    expect(updateCampaignBudget).toHaveBeenCalledWith('org', 'campaign-1', 8000);
    expect(await run(tool, { campaignId: 'campaign-2', amount: 8000 })).toEqual({
      output: { errors: 'This campaign has no budget of its own' },
    });
  });
});
