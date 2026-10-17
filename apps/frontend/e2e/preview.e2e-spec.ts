import { randomUUID } from 'crypto';
import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

const tomorrowAtNoon = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(12, 0, 0, 0);
  return date;
};

describe('Pré-visualização interna', () => {
  let session: AppSession;
  let postId = '';
  let group = '';

  beforeAll(async () => {
    session = await openAppSession();
    const channel = await createChannel(session.orgId, 'instagram', 'Pauta no Instagram');
    group = randomUUID();
    postId = (
      await prisma.post.create({
        data: {
          organizationId: session.orgId,
          integrationId: channel.id,
          content: '<p>Carrossel de lançamento</p>',
          image: JSON.stringify([
            { id: randomUUID(), path: 'https://pauta.test/slide-1.png' },
            { id: randomUUID(), path: 'https://pauta.test/slide-2.png' },
          ]),
          group,
          publishDate: tomorrowAtNoon(),
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

  const modal = () => session.page.getByTestId('post-preview-modal');
  const card = () => session.page.getByTestId('post-card').filter({ hasText: 'Carrossel de lançamento' });

  it('abre a prévia pela lista no formato da rede do post e guarda a escolha na URL', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/posts?status=scheduled`);
    await card().getByRole('button', { name: 'Pré-visualizar' }).click();

    await modal().waitFor();
    await page.waitForURL(new RegExp(`preview=${group}`));
    await modal().getByText('Carrossel de lançamento').first().waitFor();
    expect(await modal().getByRole('tab', { name: 'Instagram' }).getAttribute('aria-selected')).toBe('true');
    expect(await modal().getByRole('tab', { name: 'Carrossel' }).getAttribute('aria-selected')).toBe('true');
    expect(await modal().getByTestId('post-preview-slide').count()).toBe(1);
    const slide = () => modal().getByTestId('post-preview-slide').locator('img');
    expect(await slide().getAttribute('src')).toBe('https://pauta.test/slide-1.png');
    await modal().getByRole('button', { name: 'Next slide' }).click();
    await modal().getByRole('button', { name: 'Previous slide' }).waitFor();
    expect(await slide().getAttribute('src')).toBe('https://pauta.test/slide-2.png');

    await page.keyboard.press('ArrowLeft');
    await modal().getByRole('button', { name: 'Previous slide' }).waitFor({ state: 'detached' });
    expect(await slide().getAttribute('src')).toBe('https://pauta.test/slide-1.png');

    const box = await modal().getByTestId('post-preview-slide').boundingBox();
    if (!box) {
      throw new Error('Slide has no box');
    }
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await modal().getByRole('button', { name: 'Previous slide' }).waitFor();
    expect(await slide().getAttribute('src')).toBe('https://pauta.test/slide-2.png');

    await modal().getByRole('tab', { name: 'Stories' }).click();
    await page.waitForURL(/format=story/);
    const story = modal().getByTestId('post-preview-story');
    await story.waitFor();
    expect(await story.getByTestId('post-preview-slide').locator('img').getAttribute('src')).toBe(
      'https://pauta.test/slide-1.png'
    );
    await story.getByRole('button', { name: 'Next slide' }).click();
    expect(await story.getByTestId('post-preview-slide').locator('img').getAttribute('src')).toBe(
      'https://pauta.test/slide-2.png'
    );
    expect(await story.locator('[data-active="true"]').count()).toBe(2);

    await modal().getByRole('tab', { name: 'LinkedIn' }).click();
    await page.waitForURL(/network=linkedin/);
    expect(await modal().getByRole('tab', { name: 'Stories' }).count()).toBe(0);
    expect(await modal().getByRole('tab', { name: 'Carrossel' }).getAttribute('aria-selected')).toBe('true');

    await page.reload();
    await modal().waitFor();
    expect(await modal().getByRole('tab', { name: 'LinkedIn' }).getAttribute('aria-selected')).toBe('true');

    await page.keyboard.press('Escape');
    await modal().waitFor({ state: 'detached' });
    await page.waitForURL((url) => !url.searchParams.has('preview'));
    expect(page.url()).toContain('status=scheduled');
  });

  it('avisa e fecha a prévia quando o post do link não existe mais', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/posts?status=scheduled&preview=${randomUUID()}`);
    await page.getByText('Post não encontrado').first().waitFor();
    await page.waitForURL((url) => !url.searchParams.has('preview'));
    expect(await modal().count()).toBe(0);
  });

  it('mantém o link público para terceiros validarem', async () => {
    const { page, context } = session;
    await page.goto(`${FRONTEND_URL}/posts?status=scheduled&preview=${group}`);
    await modal().waitFor();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      modal().getByRole('button', { name: 'Abrir link para terceiros' }).click(),
    ]);
    await popup.waitForURL(new RegExp(`/p/${postId}`));
    await popup.close();
  });

  it('abre a prévia pelo calendário, edita o post e exclui', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/launches?display=week`);
    const post = page.getByTestId('calendar-post').filter({ hasText: 'Carrossel de lançamento' }).first();
    await post.hover();
    await post.getByRole('button', { name: 'Pré-visualizar' }).click();
    await modal().waitFor();
    await page.waitForURL(new RegExp(`preview=${group}`));

    await modal().getByRole('tab', { name: 'Vídeo' }).click();
    await page.waitForURL(/format=video/);
    await modal().getByRole('button', { name: 'Fechar' }).click();
    await modal().waitFor({ state: 'detached' });

    await prisma.post.update({ where: { id: postId }, data: { content: '<p>Carrossel revisado</p>' } });
    await page.goto(`${FRONTEND_URL}/posts?status=scheduled&preview=${group}`);
    await modal().getByText('Carrossel revisado').first().waitFor();
    await page.keyboard.press('Escape');

    const revised = page.getByTestId('post-card').filter({ hasText: 'Carrossel revisado' });
    await revised.getByRole('button', { name: 'Excluir publicação' }).click();
    await page.getByRole('button', { name: 'Sim, exclua!' }).click();
    await revised.waitFor({ state: 'detached' });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).deletedAt).not.toBeNull();
  });
});
