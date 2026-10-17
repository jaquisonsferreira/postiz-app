import { randomUUID } from 'crypto';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3000';

const prisma = new PrismaService();

interface CompositionItem {
  id: string;
  status: string;
  format: string;
  title: string;
  slides: { kicker?: string; headline?: string; body?: string }[];
  targets: { integrationId: string; content: string }[];
  media: { id: string; path: string }[];
  posts: { postId: string; integration: string }[];
}

const call = async (
  auth: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
};

const waitForStatus = async (auth: string, id: string, status: string): Promise<CompositionItem> => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const { json } = await call(auth, 'GET', `/compositions/${id}`);
    const item = json as CompositionItem;
    if (item.status === status || item.status === 'failed') {
      return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Composition ${id} never reached ${status}`);
};

describe('Composições no app', () => {
  const email = `e2e-${randomUUID()}@pauta.test`;
  let auth = '';
  let orgId = '';
  let channelId = '';

  beforeAll(async () => {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Senha12345', company: 'E2E App', provider: 'LOCAL' }),
    });
    auth = response.headers.get('auth') || /auth=([^;]+)/.exec(response.headers.get('set-cookie') || '')?.[1] || '';
    const user = await prisma.user.findFirstOrThrow({
      where: { email },
      select: { organizations: { select: { organizationId: true } } },
    });
    orgId = user.organizations[0].organizationId;
    channelId = (
      await prisma.integration.create({
        data: {
          internalId: randomUUID(),
          organizationId: orgId,
          name: 'E2E LinkedIn',
          providerIdentifier: 'linkedin-page',
          type: 'social',
          token: 'e2e-token',
          tokenExpiration: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.post.deleteMany({ where: { organizationId: orgId, parentPostId: { not: null } } });
    await prisma.post.deleteMany({ where: { organizationId: orgId } });
    await prisma.composition.deleteMany({ where: { organizationId: orgId } });
    await prisma.media.deleteMany({ where: { organizationId: orgId } });
    await prisma.integration.deleteMany({ where: { organizationId: orgId } });
    await prisma.$disconnect();
  });

  it('recusa sem sessão', async () => {
    expect((await call('', 'GET', '/compositions')).status).toBe(401);
  });

  it('cria, lista na fila de aprovação, mostra o conteúdo e exclui', async () => {
    const created = await call(auth, 'POST', '/compositions', {
      date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      format: 'carousel',
      requiresApproval: true,
      slides: [
        { kicker: 'Reforma Tributária', headline: '5 pontos para acompanhar' },
        { kicker: 'Ponto 01', headline: 'O cronograma', body: 'Entre 2026 e 2033.' },
      ],
      targets: [{ integrationId: channelId, content: 'Legenda do carrossel' }],
    });
    expect(created.status).toBe(201);
    const { id } = created.json as { id: string };

    const ready = await waitForStatus(auth, id, 'awaiting_approval');
    expect(ready.status).toBe('awaiting_approval');
    expect(ready.title).toBe('5 pontos para acompanhar');
    expect(ready.slides[1].body).toBe('Entre 2026 e 2033.');
    expect(ready.targets).toEqual([{ integrationId: channelId, content: 'Legenda do carrossel' }]);
    expect(ready.media).toHaveLength(2);

    const pending = await call(auth, 'GET', '/compositions?status=awaiting_approval');
    expect((pending.json as CompositionItem[]).map((c) => c.id)).toContain(id);
    const scheduled = await call(auth, 'GET', '/compositions?status=scheduled');
    expect((scheduled.json as CompositionItem[]).map((c) => c.id)).not.toContain(id);
    expect(
      ((await call(auth, 'GET', '/compositions/count?status=awaiting_approval')).json as { total: number }).total
    ).toBe(1);

    expect((await call(auth, 'DELETE', `/compositions/${id}`)).status).toBe(200);
    expect((await call(auth, 'GET', `/compositions/${id}`)).status).toBe(404);
    expect(
      ((await call(auth, 'GET', '/compositions/count?status=awaiting_approval')).json as { total: number }).total
    ).toBe(0);
  });

  it('aprova uma composição e ela sai da fila', async () => {
    const created = await call(auth, 'POST', '/compositions', {
      date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: channelId, content: 'Post de texto' }],
    });
    const { id } = created.json as { id: string };
    await waitForStatus(auth, id, 'awaiting_approval');

    const approved = await call(auth, 'POST', `/compositions/${id}/approve`);
    expect(approved.status).toBe(201);
    expect((approved.json as CompositionItem).status).toBe('scheduled');
    expect(
      ((await call(auth, 'GET', '/compositions/count?status=awaiting_approval')).json as { total: number }).total
    ).toBe(0);

    expect((await call(auth, 'DELETE', `/compositions/${id}`)).status).toBe(200);
  });

  it('não mostra composições de outra organização', async () => {
    const other = await prisma.organization.create({ data: { name: 'Outra' }, select: { id: true } });
    const foreign = await prisma.composition.create({
      data: {
        organizationId: other.id,
        format: 'text',
        publishDate: new Date(),
        payload: '{"targets":[]}',
      },
      select: { id: true },
    });

    expect((await call(auth, 'GET', `/compositions/${foreign.id}`)).status).toBe(404);
    expect((await call(auth, 'DELETE', `/compositions/${foreign.id}`)).status).toBe(404);

    await prisma.composition.delete({ where: { id: foreign.id } });
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
