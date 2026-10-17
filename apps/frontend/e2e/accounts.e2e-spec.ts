import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

describe('Contas conectadas', () => {
  let session: AppSession;
  let linkedinId = '';

  beforeAll(async () => {
    session = await openAppSession();
    linkedinId = (await createChannel(session.orgId, 'linkedin-page', 'Página Connectabil')).id;
    await createChannel(session.orgId, 'x', 'X Connectabil');
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  const card = (name: string) => session.page.getByTestId('account-card').filter({ hasText: name });

  it('lista os canais e abre a escolha de rede para adicionar outro', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/accounts`);
    await card('Página Connectabil').getByText('Conectado').waitFor();
    await card('X Connectabil').getByText('Conectado').waitFor();

    await page.getByRole('button', { name: 'Adicionar canal' }).click();
    await page.getByText('LinkedIn Page').first().waitFor();
  });

  it('desativa, reativa e exclui um canal', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/accounts`);

    await card('Página Connectabil').getByRole('button', { name: 'Desativar' }).click();
    await card('Página Connectabil').getByText('Desativado').waitFor();
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: linkedinId } })).disabled).toBe(true);

    await card('Página Connectabil').getByRole('button', { name: 'Ativar' }).click();
    await card('Página Connectabil').getByText('Conectado').waitFor();
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: linkedinId } })).disabled).toBe(false);

    await card('Página Connectabil').getByRole('button', { name: 'Excluir canal' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await card('Página Connectabil').waitFor({ state: 'detached' });
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: linkedinId } })).deletedAt).not.toBeNull();
  });
});
