import { AppSession, FRONTEND_URL, openAppSession, prisma } from './app.session';

const day = (daysAgo: number) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
};

const createAdAccount = async (organizationId: string) => {
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
    await prisma.adMetricDaily.deleteMany({ where: { adCampaign: { adAccount: { organizationId: session.orgId } } } });
    await prisma.adCampaign.deleteMany({ where: { adAccount: { organizationId: session.orgId } } });
    await prisma.adAccount.deleteMany({ where: { organizationId: session.orgId } });
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
    expect(login.searchParams.get('scope')).toBe('ads_read,business_management');
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
});
