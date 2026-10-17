import { AppSession, FRONTEND_URL, openAppSession, prisma } from './app.session';

describe('Layout do Pauta', () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await openAppSession();
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  it('mostra as seções do menu e navega entre as telas', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/launches`);
    const sidebar = page.getByTestId('sidebar');

    for (const section of ['Conteúdo', 'Automação', 'Configurações']) {
      await sidebar.getByText(section, { exact: true }).first().waitFor();
    }
    await sidebar.getByRole('link', { name: 'Calendário' }).waitFor();
    expect(await sidebar.getByRole('link', { name: 'Calendário' }).getAttribute('aria-current')).toBe('page');

    await sidebar.getByRole('link', { name: 'Mídia' }).click();
    await page.waitForURL(`${FRONTEND_URL}/media`);
    expect(await sidebar.getByRole('link', { name: 'Mídia' }).getAttribute('aria-current')).toBe('page');
  });

  it('mostra no menu quantas composições aguardam aprovação', async () => {
    const { page, orgId } = session;
    await prisma.composition.create({
      data: { organizationId: orgId, status: 'awaiting_approval', format: 'text', publishDate: new Date(), payload: '{"targets":[]}' },
    });
    await page.goto(`${FRONTEND_URL}/launches`);
    const badge = page.getByTestId('sidebar').getByRole('link', { name: /Aprovações/ }).getByTestId('menu-badge');
    await badge.waitFor();
    expect(await badge.textContent()).toBe('1');
  });
});
