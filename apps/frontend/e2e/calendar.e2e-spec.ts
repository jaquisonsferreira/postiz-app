import { randomUUID } from 'crypto';
import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

describe('Calendário', () => {
  let session: AppSession;
  let postId = '';

  beforeAll(async () => {
    session = await openAppSession();
    const channel = await createChannel(session.orgId, 'linkedin-page', 'Connectabil');
    const publishDate = new Date();
    publishDate.setDate(publishDate.getDate() + 1);
    publishDate.setHours(12, 0, 0, 0);
    postId = (
      await prisma.post.create({
        data: {
          organizationId: session.orgId,
          integrationId: channel.id,
          content: '<p>Post agendado no calendário</p>',
          group: randomUUID(),
          publishDate,
          state: 'QUEUE',
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  it('mostra o post nas visões de mês, semana e lista guardando a visão na URL', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/launches?display=month`);
    const post = () => page.getByTestId('calendar-post').filter({ hasText: 'Post agendado no calendário' });
    await post().first().waitFor();

    await page.getByRole('tab', { name: 'Semana' }).click();
    await page.waitForURL(/display=week/);
    await post().first().waitFor();

    await page.getByRole('tab', { name: 'Lista' }).click();
    await page.waitForURL(/display=list/);
    await page.getByText('Post agendado no calendário').first().waitFor();

    await page.getByRole('tab', { name: 'Mês' }).click();
    await page.waitForURL(/display=month/);
    await post().first().waitFor();
  });

  it('abre o editor pelo botão de criar post', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/launches?display=month`);
    await page.getByRole('button', { name: 'Criar post' }).click();
    await page.locator('.ProseMirror, [contenteditable="true"]').first().waitFor();
  });

  it('exclui o post pelo calendário', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/launches?display=month`);
    const post = page.getByTestId('calendar-post').filter({ hasText: 'Post agendado no calendário' }).first();
    await post.hover();
    await post.getByRole('button', { name: 'Excluir publicação' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await post.waitFor({ state: 'detached' });

    expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).deletedAt).not.toBeNull();
  });
});
