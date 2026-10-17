import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

const waitForComposition = async (orgId: string) => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const row = await prisma.composition.findFirst({
      where: { organizationId: orgId, deletedAt: null },
      select: { id: true, status: true, media: true, payload: true },
    });
    if (row && ['awaiting_approval', 'failed'].includes(row.status)) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Composition never got ready');
};

describe('Editor de carrossel', () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await openAppSession();
    await createChannel(session.orgId, 'linkedin-page', 'Página Connectabil');
    await createChannel(session.orgId, 'x', 'X Connectabil');
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  it('pede ao menos um canal antes de enviar', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/editor`);
    await page.getByLabel('Título', { exact: true }).first().fill('Sem canal');
    await page.getByRole('button', { name: 'Gerar e enviar para aprovação' }).click();
    await page.getByText('Escolha ao menos um canal').waitFor();
    expect(await prisma.composition.count({ where: { organizationId: session.orgId } })).toBe(0);
  });

  it('monta um carrossel, mostra a prévia e envia para aprovação', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/editor`);

    await page.getByRole('tab', { name: 'Carrossel' }).click();
    await page.waitForURL(/format=carousel/);

    const slide = () => page.getByTestId('slide-form');
    await slide().getByLabel('Chamada').fill('Reforma Tributária');
    await slide().getByLabel('Título', { exact: true }).fill('5 pontos para acompanhar');
    await page.getByRole('tab', { name: '2', exact: true }).click();
    await page.waitForURL(/slide=2/);
    await slide().getByLabel('Título', { exact: true }).fill('O cronograma');
    await slide().getByLabel('Texto').fill('Entre 2026 e 2033.');
    await page.getByTitle('Prévia do slide 2').waitFor();

    await page.getByRole('checkbox', { name: 'Página Connectabil' }).check();
    await page.getByRole('checkbox', { name: 'X Connectabil' }).check();
    await page.getByLabel('Legenda').fill('A Reforma Tributária já começou.');
    expect(await page.getByLabel('who_can_reply_post').inputValue()).toBe('everyone');

    await page.getByRole('button', { name: 'Gerar e enviar para aprovação' }).click();
    await page.waitForURL(/\/approvals\?id=/);

    const composition = await waitForComposition(session.orgId);
    expect(composition.status).toBe('awaiting_approval');
    expect(JSON.parse(composition.media || '[]')).toHaveLength(2);
    const body = JSON.parse(composition.payload) as { targets: { content: string; settings?: Record<string, unknown> }[] };
    expect(body.targets).toHaveLength(2);
    expect(body.targets.every((target) => target.content === 'A Reforma Tributária já começou.')).toBe(true);
  });
});
