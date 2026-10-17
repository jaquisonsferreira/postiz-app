import { randomUUID } from 'crypto';
import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe('Posts', () => {
  let session: AppSession;
  let scheduledId = '';

  beforeAll(async () => {
    session = await openAppSession();
    const channel = await createChannel(session.orgId, 'linkedin-page', 'Connectabil');
    const post = (content: string, publishDate: Date, state: 'PUBLISHED' | 'QUEUE' | 'DRAFT') =>
      prisma.post.create({
        data: {
          organizationId: session.orgId,
          integrationId: channel.id,
          content: `<p>${content}</p>`,
          group: randomUUID(),
          publishDate,
          state,
        },
        select: { id: true },
      });
    scheduledId = (await post('Post agendado da lista', daysFromNow(2), 'QUEUE')).id;
    await post('Rascunho da lista', daysFromNow(3), 'DRAFT');
    await post('Post já publicado', daysFromNow(-2), 'PUBLISHED');
    await prisma.composition.create({
      data: {
        organizationId: session.orgId,
        status: 'awaiting_approval',
        format: 'carousel',
        publishDate: daysFromNow(4),
        payload: JSON.stringify({
          slides: [{ headline: 'Carrossel para aprovar' }, { headline: 'Segundo slide' }],
          targets: [{ integrationId: channel.id, content: 'Legenda' }],
        }),
      },
    });
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  const tab = (name: RegExp) => session.page.getByRole('tab', { name });

  it('separa os posts por status com contagens e guarda a aba na URL', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/posts`);
    await page.getByText('Post agendado da lista').waitFor();
    await page.getByText('Rascunho da lista').waitFor();

    expect(await tab(/Próximos/).textContent()).toContain('2');
    expect(await tab(/Rascunhos/).textContent()).toContain('1');
    expect(await tab(/Agendados/).textContent()).toContain('1');
    expect(await tab(/Publicados/).textContent()).toContain('1');
    expect(await tab(/Aguardando aprovação/).textContent()).toContain('1');

    await tab(/Rascunhos/).click();
    await page.waitForURL(/status=draft/);
    await page.getByText('Rascunho da lista').waitFor();
    expect(await page.getByText('Post agendado da lista').count()).toBe(0);

    await tab(/Publicados/).click();
    await page.getByText('Post já publicado').waitFor();

    await tab(/Aguardando aprovação/).click();
    await page.waitForURL(/status=approval/);
    await page.getByRole('link', { name: /Carrossel para aprovar/ }).click();
    await page.waitForURL(/\/approvals/);
  });

  it('abre o editor para editar e exclui um post', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/posts?status=scheduled`);
    const card = page.getByTestId('post-card').filter({ hasText: 'Post agendado da lista' });
    await card.getByRole('button', { name: 'Editar' }).click();
    await page.locator('.ProseMirror, [contenteditable="true"]').first().waitFor();
    await page.keyboard.press('Escape');

    await page.goto(`${FRONTEND_URL}/posts?status=scheduled`);
    await card.getByRole('button', { name: 'Excluir publicação' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await card.waitFor({ state: 'detached' });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: scheduledId } })).deletedAt).not.toBeNull();
  });
});
