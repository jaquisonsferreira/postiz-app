import { randomUUID } from 'crypto';
import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

const day = (daysAgo: number) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
};

const clearAds = async (organizationId: string) => {
  await prisma.adBoost.deleteMany({ where: { organizationId } });
  await prisma.adAutoBoost.deleteMany({ where: { organizationId } });
  await prisma.adBudgetRule.deleteMany({ where: { adAccount: { organizationId } } });
  await prisma.adMetricDaily.deleteMany({ where: { adCampaign: { adAccount: { organizationId } } } });
  await prisma.adCampaign.deleteMany({ where: { adAccount: { organizationId } } });
  await prisma.adAccount.deleteMany({ where: { organizationId } });
};

const createAdAccount = async (organizationId: string) => {
  await clearAds(organizationId);
  const account = await prisma.adAccount.create({
    data: {
      organizationId,
      provider: 'meta-ads',
      externalId: '1234567890',
      name: 'Loja da Pauta',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      token: 'e2e-token',
      refreshToken: '',
      tokenExpiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastSyncAt: new Date(),
    },
  });
  const campaign = (externalId: string, name: string, status: string, budgetAmount: number | null) =>
    prisma.adCampaign.create({
      data: {
        adAccountId: account.id,
        externalId,
        name,
        status,
        objective: 'OUTCOME_ENGAGEMENT',
        budgetType: budgetAmount ? 'daily' : null,
        budgetAmount,
      },
    });
  const recent = await campaign('c1', 'Impulsionamento do carrossel', 'active', 5000);
  const old = await campaign('c2', 'Campanha de setembro', 'paused', null);

  await prisma.adMetricDaily.createMany({
    data: [
      { adCampaignId: recent.id, date: day(1), impressions: 3000, reach: 2500, clicks: 60, spend: 4000, conversions: 2 },
      { adCampaignId: recent.id, date: day(2), impressions: 1000, reach: 900, clicks: 20, spend: 1000, conversions: 0 },
      { adCampaignId: old.id, date: day(20), impressions: 6000, reach: 5000, clicks: 20, spend: 10000, conversions: 1 },
    ],
  });
  return account;
};

describe('Anúncios', () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await openAppSession();
  });

  afterAll(async () => {
    await clearAds(session.orgId);
    await session.close();
    await prisma.$disconnect();
  });

  it('mostra o convite para conectar quando não há conta e abre o login da Meta', async () => {
    const { page } = session;
    await page.route('https://www.facebook.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Login da Meta</p>' })
    );

    await page.goto(`${FRONTEND_URL}/ads`);
    await page.getByTestId('ads-empty').getByText('Nenhuma conta de anúncio conectada').waitFor();

    await page.getByTestId('ads-connect-meta-ads').click();
    await page.waitForURL(/facebook\.com/);
    const login = new URL(page.url());
    expect(login.searchParams.get('scope')).toBe(
      'ads_read,ads_management,business_management,pages_show_list,pages_read_engagement,pages_manage_ads,instagram_basic'
    );
    expect(login.searchParams.get('redirect_uri')).toBe(`${FRONTEND_URL}/ads/connect/meta-ads`);
    expect(login.searchParams.get('state')).toBeTruthy();
  });

  it('recusa a volta de um login que não foi iniciado pela organização', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/ads/connect/meta-ads?code=codigo&state=estado-inventado`);

    const error = page.getByTestId('ads-connect-error');
    await error.getByText('Não foi possível conectar a conta de anúncio').waitFor();
    await error.getByRole('link', { name: 'Voltar para Anúncios' }).click();
    await page.waitForURL(/\/ads$/);
  });

  it('soma o gasto do período, troca o período pela URL e remove a conta', async () => {
    const { page } = session;
    await createAdAccount(session.orgId);

    await page.goto(`${FRONTEND_URL}/ads?period=30d`);
    const campaigns = page.getByTestId('ads-campaign');
    await campaigns.first().waitFor();
    expect(await campaigns.count()).toBe(2);
    expect(await campaigns.first().textContent()).toContain('Campanha de setembro');
    expect(await page.getByTestId('ads-kpi-value').first().textContent()).toMatch(/R\$\s?150,00/);

    await page.getByRole('tab', { name: '7 dias' }).click();
    await page.waitForURL(/period=7d/);
    await page.getByText('Campanha de setembro').waitFor({ state: 'detached' });
    expect(await campaigns.count()).toBe(1);
    expect(await campaigns.first().textContent()).toContain('Impulsionamento do carrossel');
    expect(await campaigns.first().textContent()).toContain('Orçamento diário R$');
    expect(await page.getByTestId('ads-kpi-value').first().textContent()).toMatch(/R\$\s?50,00/);

    const account = page.getByTestId('ads-account');
    expect(await account.textContent()).toContain('Loja da Pauta');
    expect(await account.textContent()).toMatch(/Sincronizada em \d{2}\/\d{2} \d{2}:\d{2}/);
    await account.getByRole('button', { name: 'Remover' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();

    await page.getByTestId('ads-empty').waitFor();
    expect(await page.getByTestId('ads-campaign').count()).toBe(0);
    const removed = await prisma.adAccount.findFirstOrThrow({
      where: { organizationId: session.orgId },
      select: { deletedAt: true },
    });
    expect(removed.deletedAt).not.toBeNull();
  });

  it('cria, edita e remove a regra de orçamento mensal da conta', async () => {
    const { page } = session;
    const account = await createAdAccount(session.orgId);

    await page.goto(`${FRONTEND_URL}/ads?period=30d`);
    const budget = page.getByTestId('ads-budget-account').filter({ hasText: 'Loja da Pauta' });
    await budget.waitFor();
    expect(await budget.getByTestId('ads-budget-summary').textContent()).toContain('neste mês, sem teto');

    await budget.getByRole('button', { name: 'Criar regra' }).click();
    await budget.getByLabel('Teto mensal em BRL').fill('500');
    await budget.getByLabel('Aprovação acima de, em BRL').fill('100');
    await budget.getByLabel('Alertar em (% do teto)').fill('80');
    await budget.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Regra de orçamento salva').waitFor();
    await budget.getByRole('progressbar').waitFor();
    expect(await budget.getByTestId('ads-budget-summary').textContent()).toMatch(/de R\$\s?500,00 neste mês · Aprovação acima de R\$\s?100,00/);
    expect(
      await prisma.adBudgetRule.findUniqueOrThrow({
        where: { adAccountId: account.id },
        select: { monthlyCap: true, approvalThreshold: true, alertAt: true },
      })
    ).toEqual({ monthlyCap: 50000, approvalThreshold: 10000, alertAt: 80 });

    await budget.getByRole('button', { name: 'Editar regra' }).click();
    await budget.getByLabel('Teto mensal em BRL').fill('800');
    await budget.getByRole('button', { name: 'Salvar' }).click();
    await budget.getByText(/de R\$\s?800,00 neste mês/).waitFor();
    expect(
      (await prisma.adBudgetRule.findUniqueOrThrow({ where: { adAccountId: account.id } })).monthlyCap
    ).toBe(80000);

    await budget.getByRole('button', { name: 'Remover' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await page.getByText('Regra de orçamento removida').waitFor();
    await budget.getByRole('button', { name: 'Criar regra' }).waitFor();
    expect(await prisma.adBudgetRule.count({ where: { adAccountId: account.id } })).toBe(0);
  });

  it('impulsiona um post publicado do Facebook, manda para aprovação acima do limite e rejeita', async () => {
    const { page } = session;
    const account = await createAdAccount(session.orgId);
    await prisma.adBudgetRule.create({ data: { adAccountId: account.id, approvalThreshold: 5000 } });
    const channel = await createChannel(session.orgId, 'facebook', 'Página da Loja');
    const group = randomUUID();
    const post = await prisma.post.create({
      data: {
        organizationId: session.orgId,
        integrationId: channel.id,
        content: '<p>Promoção de primavera na loja</p>',
        group,
        publishDate: new Date(),
        state: 'PUBLISHED',
        releaseId: '900_800',
        releaseURL: 'https://www.facebook.com/900_800',
      },
      select: { id: true },
    });

    await page.goto(`${FRONTEND_URL}/posts?preview=${group}`);
    await page.getByTestId('post-preview-modal').getByTestId('preview-boost').click();
    await page.waitForURL(new RegExp(`boost=${post.id}`));
    const modal = page.getByTestId('boost-modal');
    await modal.getByTestId('boost-amount').waitFor();
    expect(await modal.getByTestId('boost-account').inputValue()).toBe(account.id);
    await modal.getByTestId('boost-amount').fill('15');
    await modal.getByTestId('boost-days').fill('4');
    await modal.getByText(/Até R\$\s?60,00 em 4 dias/).waitFor();
    await modal.getByRole('button', { name: 'Impulsionar' }).click();
    await page.getByText('Impulsionamento enviado para aprovação').waitFor();

    const boost = await prisma.adBoost.findFirstOrThrow({
      where: { postId: post.id },
      select: { id: true, status: true, origin: true, budgetAmount: true, days: true, reference: true },
    });
    expect(boost).toMatchObject({ status: 'awaiting_approval', origin: 'manual', budgetAmount: 1500, days: 4 });
    expect(JSON.parse(boost.reference)).toEqual({ type: 'meta-post', id: '900_800' });

    await page.goto(`${FRONTEND_URL}/approvals`);
    const approval = page.getByTestId('boost-approval').filter({ hasText: 'Promoção de primavera na loja' });
    await approval.waitFor();
    expect(await approval.textContent()).toMatch(/Loja da Pauta · Criado na Pauta · Até R\$\s?60,00 em 4 dias/);
    await approval.getByRole('button', { name: 'Rejeitar' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await page.getByText('Impulsionamento rejeitado').waitFor();
    await approval.waitFor({ state: 'detached' });
    expect((await prisma.adBoost.findUniqueOrThrow({ where: { id: boost.id } })).status).toBe('rejected');
  });

  it('liga e desliga o impulsionar automático de um canal', async () => {
    const { page } = session;
    const account = await createAdAccount(session.orgId);
    const channel = await createChannel(session.orgId, 'instagram', 'Instagram da Loja');

    await page.goto(`${FRONTEND_URL}/ads`);
    const card = page.getByTestId('ads-auto-boosts');
    await card.getByTestId('ads-auto-boost-add').click();
    const form = card.getByTestId('ads-auto-boost-form');
    await form.getByTestId('auto-boost-channel').selectOption({ label: 'Instagram da Loja' });
    await form.getByTestId('boost-amount').fill('10');
    await form.getByTestId('boost-days').fill('3');
    await form.getByRole('button', { name: 'Salvar' }).click();
    await page.getByText('Os novos posts deste canal serão impulsionados').waitFor();

    const row = card.getByTestId('ads-auto-boost').filter({ hasText: 'Instagram da Loja' });
    await row.waitFor();
    expect(await row.textContent()).toMatch(/Loja da Pauta · R\$\s?10,00 por dia durante 3 dias/);
    expect(
      await prisma.adAutoBoost.findUniqueOrThrow({
        where: { integrationId: channel.id },
        select: { adAccountId: true, budgetAmount: true, days: true, objective: true },
      })
    ).toEqual({ adAccountId: account.id, budgetAmount: 1000, days: 3, objective: 'engagement' });

    await row.getByRole('button', { name: 'Remover' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await page.getByText('Impulsionar automático desligado').waitFor();
    await row.waitFor({ state: 'detached' });
    expect(await prisma.adAutoBoost.count({ where: { integrationId: channel.id } })).toBe(0);
  });
});
