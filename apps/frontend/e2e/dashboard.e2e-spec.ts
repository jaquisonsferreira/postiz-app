import { randomUUID } from 'crypto';
import { AppSession, createChannel, FRONTEND_URL, openAppSession, prisma } from './app.session';

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe('Dashboard', () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await openAppSession();
    const channel = await createChannel(session.orgId, 'linkedin-page', 'Connectabil');
    const post = (content: string, publishDate: Date, state: 'PUBLISHED' | 'QUEUE') =>
      prisma.post.create({
        data: {
          organizationId: session.orgId,
          integrationId: channel.id,
          content: `<p>${content}</p>`,
          group: randomUUID(),
          publishDate,
          state,
        },
      });
    await post('Publicado ontem', daysFromNow(-1), 'PUBLISHED');
    await post('Publicado há 20 dias', daysFromNow(-20), 'PUBLISHED');
    await post('Próximo post agendado', daysFromNow(2), 'QUEUE');
    await prisma.composition.create({
      data: {
        organizationId: session.orgId,
        status: 'awaiting_approval',
        format: 'text',
        publishDate: daysFromNow(3),
        payload: '{"targets":[]}',
      },
    });
  });

  afterAll(async () => {
    await session.close();
    await prisma.$disconnect();
  });

  const kpi = (label: string) =>
    session.page.getByTestId('kpi').filter({ hasText: label }).getByTestId('kpi-value');

  it('mostra os números reais do período e troca o período pela URL', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/dashboard`);

    expect(await kpi('Publicados').textContent()).toBe('1');
    expect(await kpi('Agendados').textContent()).toBe('1');
    expect(await kpi('Aguardando aprovação').textContent()).toBe('1');
    expect(await kpi('Canais conectados').textContent()).toBe('1');

    await page.getByRole('button', { name: '30 dias' }).click();
    await page.waitForURL(/period=30d/);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="kpi"] [data-testid="kpi-value"]')?.textContent === '2'
    );
    expect(await kpi('Publicados').textContent()).toBe('2');

    await page.reload();
    expect(await kpi('Publicados').textContent()).toBe('2');
  });

  it('lista as próximas publicações e leva ao calendário e ao editor', async () => {
    const { page } = session;
    await page.goto(`${FRONTEND_URL}/dashboard`);
    const upcoming = page.getByTestId('upcoming-posts');
    await upcoming.getByText('Próximo post agendado').waitFor();
    expect(await upcoming.getByText('Agendado', { exact: true }).count()).toBe(1);

    await page.getByRole('link', { name: 'Ver calendário' }).click();
    await page.waitForURL(`${FRONTEND_URL}/launches`);

    await page.goto(`${FRONTEND_URL}/dashboard`);
    await page.getByRole('link', { name: 'Criar post' }).click();
    await page.waitForURL(`${FRONTEND_URL}/editor`);
  });
});
