import { AppSession, FRONTEND_URL, openAppSession, prisma } from './app.session';

describe('Agentes e Radar de notícias', () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await openAppSession();
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  it.each([
    ['/automations', 'Nenhum agente ativo ainda'],
    ['/radar', 'O radar ainda não acompanha fontes'],
  ])('mostra em %s o estado atual e leva ao editor', async (path, heading) => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}${path}`);
    await page.getByRole('heading', { name: heading }).waitFor();
    await page.getByRole('link', { name: 'Criar post no editor' }).click();
    await page.waitForURL(`${FRONTEND_URL}/editor`);
  });
});
