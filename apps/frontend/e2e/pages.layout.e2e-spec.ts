import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

describe('Analytics, Mídia e Configurações no layout do Pauta', () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await openAppSession();
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  const radius = (testId: string) =>
    session.page.getByTestId(testId).evaluate((element) => getComputedStyle(element).borderRadius);

  it('mostra o aviso de análises sem canais dentro de um card', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/analytics`);
    await page.getByTestId('analytics-empty').getByText('Ainda não é possível mostrar análises').waitFor();
    expect(await radius('analytics-empty')).toBe('32px');

    await page.getByTestId('analytics-empty').getByRole('link', { name: 'Conectar um canal' }).click();
    await page.waitForURL(`${FRONTEND_URL}/accounts`);
  });

  it('separa os canais e as análises em cards', async () => {
    const { page, orgId } = session;
    await createChannel(orgId, 'linkedin-page', 'Página Analytics');
    await page.goto(`${FRONTEND_URL}/analytics`);

    await page.getByTestId('analytics-channels').getByText('Página Analytics').waitFor();
    await page.getByTestId('analytics-content').waitFor();
    expect(await radius('analytics-channels')).toBe('32px');
    expect(await radius('analytics-content')).toBe('32px');
  });

  it('mostra a biblioteca de mídia dentro de um card', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/media`);
    await page.getByTestId('media-library').waitFor();
    expect(await radius('media-library')).toBe('32px');
  });

  it('troca as seções das configurações pelas abas e guarda a aba na URL', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/settings`);
    const tabs = page.getByRole('tablist', { name: 'Seções das configurações' });
    await tabs.getByRole('tab', { name: 'Configurações Globais' }).waitFor();
    expect(await tabs.getByRole('tab', { name: 'Configurações Globais' }).getAttribute('aria-selected')).toBe('true');
    expect(await radius('settings-content')).toBe('32px');

    await tabs.getByRole('tab', { name: 'Integrações' }).click();
    await page.waitForURL(`${FRONTEND_URL}/settings?tab=integrations`);
    expect(await tabs.getByRole('tab', { name: 'Integrações' }).getAttribute('aria-selected')).toBe('true');

    await page.reload();
    await tabs.getByRole('tab', { name: 'Integrações' }).waitFor();
    expect(await tabs.getByRole('tab', { name: 'Integrações' }).getAttribute('aria-selected')).toBe('true');
  });
});
