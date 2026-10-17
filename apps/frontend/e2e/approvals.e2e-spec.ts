import { AppSession, API_URL, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

const createComposition = async (auth: string, integrationId: string, headline: string, caption: string) => {
  const response = await fetch(`${API_URL}/compositions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', auth },
    body: JSON.stringify({
      date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      format: 'carousel',
      requiresApproval: true,
      slides: [
        { kicker: 'Reforma Tributária', headline },
        { kicker: 'Ponto 01', headline: 'O cronograma', body: 'Entre 2026 e 2033.' },
      ],
      targets: [{ integrationId, content: caption }],
    }),
  });
  const { id } = (await response.json()) as { id: string };
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const row = await prisma.composition.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (row.status === 'awaiting_approval') {
      return id;
    }
    if (row.status === 'failed') {
      throw new Error(`Composition ${id} failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Composition ${id} never got ready`);
};

describe('Aprovações', () => {
  let session: AppSession;
  let approveId = '';
  let rejectId = '';

  beforeAll(async () => {
    session = await openAppSession();
    const channel = await createChannel(session.orgId, 'linkedin-page', 'Connectabil');
    approveId = await createComposition(session.auth, channel.id, 'Carrossel para aprovar', 'Legenda do carrossel aprovado');
    rejectId = await createComposition(session.auth, channel.id, 'Carrossel para rejeitar', 'Legenda rejeitada');
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  it('mostra a fila com a prévia dos slides e a legenda de cada canal', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/approvals`);
    const queue = page.getByTestId('approval-queue');
    await queue.getByText('Carrossel para aprovar').waitFor();
    await queue.getByText('Carrossel para rejeitar').waitFor();

    await queue.getByRole('button', { name: /Carrossel para aprovar/ }).click();
    await page.waitForURL(new RegExp(`id=${approveId}`));
    const detail = page.getByTestId('approval-detail');
    await detail.getByText('Legenda do carrossel aprovado').waitFor();
    expect(await detail.getByRole('img', { name: /Slide/ }).count()).toBe(2);
  });

  it('aprova e agenda uma composição', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/approvals?id=${approveId}`);
    await page.getByRole('button', { name: 'Aprovar e agendar', exact: true }).click();
    await page.getByTestId('approval-queue').getByText('Carrossel para aprovar').waitFor({ state: 'detached' });

    expect((await prisma.composition.findUniqueOrThrow({ where: { id: approveId } })).status).toBe('scheduled');
  });

  it('rejeita uma composição e ela some da fila', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/approvals?id=${rejectId}`);
    await page.getByRole('button', { name: 'Rejeitar', exact: true }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await page.getByTestId('approval-queue').getByText('Carrossel para rejeitar').waitFor({ state: 'detached' });

    expect((await prisma.composition.findUniqueOrThrow({ where: { id: rejectId } })).deletedAt).not.toBeNull();
    await page.getByText('Nenhuma composição aguardando aprovação.').waitFor();
  });
});
