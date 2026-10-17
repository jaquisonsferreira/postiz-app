import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3000';
const UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY as string;
const TEMPORAL_UI_URL = process.env.E2E_TEMPORAL_UI_URL || 'http://localhost:8080';

const prisma = new PrismaClient();

interface CompositionResponse {
  id: string;
  status: string;
  format: string;
  requiresApproval: boolean;
  error: string | null;
  media: { id: string; path: string }[];
  posts: { postId: string; integration: string }[];
}

const api = async (
  method: string,
  path: string,
  apiKey: string | null,
  body?: unknown
): Promise<{ status: number; json: unknown }> => {
  const response = await fetch(`${API_URL}/public/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: apiKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
};

const waitForStatus = async (
  apiKey: string,
  id: string,
  statuses: string[]
): Promise<CompositionResponse> => {
  const deadline = Date.now() + 180000;
  let last: CompositionResponse | null = null;
  while (Date.now() < deadline) {
    const { json } = await api('GET', `/compositions/${id}`, apiKey);
    last = json as CompositionResponse;
    if (statuses.includes(last.status) || last.status === 'failed') {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Composition ${id} stuck at ${last?.status}`);
};

const fileOf = (path: string): string =>
  join(UPLOAD_DIRECTORY, path.slice(path.indexOf('/uploads/') + '/uploads/'.length));

const eventually = async (check: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Condition not met in 30s');
};

const runningWorkflows = async (postId: string): Promise<number> => {
  const query = encodeURIComponent(`postId="${postId}" AND ExecutionStatus="Running"`);
  const response = await fetch(
    `${TEMPORAL_UI_URL}/api/v1/namespaces/default/workflows?query=${query}`
  );
  const json = (await response.json()) as { executions?: unknown[] };
  return json.executions?.length || 0;
};

describe('Composições pela API pública', () => {
  const apiKey = `e2e-${randomUUID()}`;
  const otherApiKey = `e2e-${randomUUID()}`;
  let orgId = '';
  let otherOrgId = '';
  let linkedinId = '';
  let xId = '';
  let foreignIntegrationId = '';
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const createIntegration = (organizationId: string, providerIdentifier: string) =>
    prisma.integration.create({
      data: {
        internalId: randomUUID(),
        organizationId,
        name: `E2E ${providerIdentifier}`,
        providerIdentifier,
        type: 'social',
        token: 'e2e-token',
        tokenExpiration: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

  beforeAll(async () => {
    orgId = (await prisma.organization.create({ data: { name: 'E2E Pauta', apiKey } })).id;
    otherOrgId = (
      await prisma.organization.create({ data: { name: 'E2E Outra', apiKey: otherApiKey } })
    ).id;
    linkedinId = (await createIntegration(orgId, 'linkedin-page')).id;
    xId = (await createIntegration(orgId, 'x')).id;
    foreignIntegrationId = (await createIntegration(otherOrgId, 'linkedin-page')).id;
  });

  afterAll(async () => {
    const orgs = [orgId, otherOrgId];
    await prisma.post.deleteMany({ where: { organizationId: { in: orgs }, parentPostId: { not: null } } });
    await prisma.post.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.composition.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.media.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.integration.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  it('recusa requisições sem chave de API', async () => {
    const { status } = await api('POST', '/compositions', null, {});
    expect(status).toBe(401);
  });

  it('recusa payload inválido', async () => {
    const { status } = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'carousel',
      slides: [{ headline: 'Só um slide' }],
      targets: [{ integrationId: linkedinId, content: 'x' }],
    });
    expect(status).toBe(400);
  });

  it('recusa canal de outra organização', async () => {
    const { status } = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'text',
      targets: [{ integrationId: foreignIntegrationId, content: 'x' }],
    });
    expect(status).toBe(400);
  });

  it('recusa na hora configurações inválidas do provider com a mensagem do campo', async () => {
    const { status, json } = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'text',
      targets: [{ integrationId: xId, content: 'Sem configuração de respostas' }],
    });
    expect(status).toBe(400);
    expect(JSON.stringify(json)).toContain('who_can_reply_post');
    expect(await prisma.composition.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it('recusa na hora configurações inválidas mesmo quando a composição exige aprovação', async () => {
    const { status, json } = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: xId, content: 'Sem configuração de respostas' }],
    });
    expect(status).toBe(400);
    expect(JSON.stringify(json)).toContain('who_can_reply_post');
  });

  it('trata página negativa na listagem como a primeira', async () => {
    const { status, json } = await api('GET', '/compositions?page=-1', apiKey);
    expect(status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
  });

  it('trata página não finita na listagem como a primeira', async () => {
    const { status } = await api('GET', '/compositions?page=Infinity', apiKey);
    expect(status).toBe(200);
  });

  it('recusa aprovar quando um rascunho foi apagado no painel', async () => {
    const created = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [
        { integrationId: linkedinId, content: 'Canal mantido' },
        { integrationId: xId, content: 'Canal apagado', settings: { who_can_reply_post: 'everyone' } },
      ],
    });
    const { id } = created.json as { id: string };
    const ready = await waitForStatus(apiKey, id, ['awaiting_approval']);
    const removed = ready.posts.find((p) => p.integration === xId)!;
    await prisma.post.update({ where: { id: removed.postId }, data: { deletedAt: new Date() } });

    const approved = await api('POST', `/compositions/${id}/approve`, apiKey);
    expect(approved.status).toBe(400);
    expect(JSON.stringify(approved.json)).toContain(xId);
    const kept = ready.posts.find((p) => p.integration === linkedinId)!;
    expect((await prisma.post.findUniqueOrThrow({ where: { id: kept.postId } })).state).toBe('DRAFT');
    expect((await api('GET', `/compositions/${id}`, apiKey)).json).toMatchObject({
      status: 'awaiting_approval',
    });

    expect((await api('DELETE', `/compositions/${id}`, apiKey)).status).toBe(200);
  });

  it('aceita payload grande dentro dos limites do DTO', async () => {
    const created = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [
        {
          integrationId: linkedinId,
          content: 'x'.repeat(2000),
          comments: Array.from({ length: 20 }, () => 'y'.repeat(10000)),
        },
      ],
    });
    expect(created.status).toBe(201);
    const { id } = created.json as { id: string };
    expect((await api('DELETE', `/compositions/${id}`, apiKey)).status).toBe(200);
  });

  it('cria, aprova e exclui um carrossel', async () => {
    const created = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'carousel',
      requiresApproval: true,
      brand: { name: 'connectabil', handle: '@connectabil', primaryColor: '#6D4AFF' },
      slides: [
        { kicker: 'Reforma Tributária', headline: '5 pontos que sua empresa precisa acompanhar' },
        { kicker: 'Ponto 01', headline: 'O cronograma de transição', body: 'Entre 2026 e 2033.' },
        { kicker: 'Próximo passo', headline: 'Quer ajuda na transição?' },
      ],
      targets: [
        {
          integrationId: linkedinId,
          content: 'A Reforma Tributária já começou.\n\nSalve este post.',
          settings: { post_as_images_carousel: true, carousel_name: 'Reforma Tributária' },
        },
      ],
    });
    expect(created.status).toBe(201);
    const { id } = created.json as { id: string };

    const ready = await waitForStatus(apiKey, id, ['awaiting_approval']);
    expect(ready.error).toBeNull();
    expect(ready.status).toBe('awaiting_approval');
    expect(ready.media).toHaveLength(3);
    for (const media of ready.media) {
      const metadata = await sharp(readFileSync(fileOf(media.path))).metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', 1080, 1350]);
    }

    expect(ready.posts).toHaveLength(1);
    const draft = await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } });
    expect(draft.state).toBe('DRAFT');
    expect(draft.integrationId).toBe(linkedinId);
    expect(draft.content).toBe('<p>A Reforma Tributária já começou.</p><p></p><p>Salve este post.</p>');
    expect((JSON.parse(draft.image as string) as { id: string }[]).map((m) => m.id)).toEqual(
      ready.media.map((m) => m.id)
    );
    expect(new Date(draft.publishDate).toISOString()).toBe(future);

    const approved = await api('POST', `/compositions/${id}/approve`, apiKey);
    expect(approved.status).toBe(201);
    expect((approved.json as CompositionResponse).status).toBe('scheduled');
    const queued = await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } });
    expect(queued.state).toBe('QUEUE');
    await eventually(async () => (await runningWorkflows(queued.id)) === 1);

    const approvedAgain = await api('POST', `/compositions/${id}/approve`, apiKey);
    expect(approvedAgain.status).toBe(400);

    const fromOtherOrg = await api('GET', `/compositions/${id}`, otherApiKey);
    expect(fromOtherOrg.status).toBe(404);

    const deleted = await api('DELETE', `/compositions/${id}`, apiKey);
    expect(deleted.status).toBe(200);
    const removed = await prisma.post.findUniqueOrThrow({ where: { id: queued.id } });
    expect(removed.deletedAt).not.toBeNull();
    await eventually(async () => (await runningWorkflows(queued.id)) === 0);
    expect((await api('GET', `/compositions/${id}`, apiKey)).status).toBe(404);
  });

  it('registra no status a falha de renderização e permite excluir', async () => {
    const created = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'image',
      slides: [
        {
          headline: 'Fundo em endereço interno',
          background: { type: 'url', url: 'https://169.254.169.254/latest/meta-data.png' },
        },
      ],
      targets: [{ integrationId: linkedinId, content: 'Imagem' }],
    });
    expect(created.status).toBe(201);
    const { id } = created.json as { id: string };

    const failed = await waitForStatus(apiKey, id, ['failed']);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Could not download https://169.254.169.254/latest/meta-data.png');
    expect(failed.posts).toEqual([]);

    expect((await api('DELETE', `/compositions/${id}`, apiKey)).status).toBe(200);
    expect((await api('GET', `/compositions/${id}`, apiKey)).status).toBe(404);
  });

  it('agenda direto um fio de texto sem aprovação e exclui', async () => {
    const created = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'text',
      targets: [
        {
          integrationId: xId,
          content: 'Fio 1/2',
          comments: ['Fio 2/2'],
          settings: { who_can_reply_post: 'everyone' },
        },
      ],
    });
    expect(created.status).toBe(201);
    const { id } = created.json as { id: string };

    const scheduled = await waitForStatus(apiKey, id, ['scheduled']);
    expect(scheduled.error).toBeNull();
    expect(scheduled.media).toEqual([]);
    const thread = await prisma.post.findMany({
      where: { organizationId: orgId, integrationId: xId, deletedAt: null },
    });
    thread.sort((a, b) => (a.parentPostId === null ? -1 : b.parentPostId === null ? 1 : 0));
    expect(thread.map((p) => [p.state, p.content])).toEqual([
      ['QUEUE', '<p>Fio 1/2</p>'],
      ['QUEUE', '<p>Fio 2/2</p>'],
    ]);
    expect(thread[1].parentPostId).toBe(thread[0].id);

    expect((await api('DELETE', `/compositions/${id}`, apiKey)).status).toBe(200);
    expect(
      await prisma.post.count({ where: { organizationId: orgId, integrationId: xId, deletedAt: null } })
    ).toBe(0);
  });

  it('agenda um post por canal com os ids reais e exclui todos', async () => {
    const created = await api('POST', '/compositions', apiKey, {
      date: future,
      format: 'text',
      targets: [
        { integrationId: linkedinId, content: 'No LinkedIn' },
        { integrationId: xId, content: 'No X', settings: { who_can_reply_post: 'everyone' } },
      ],
    });
    expect(created.status).toBe(201);
    const { id } = created.json as { id: string };

    const scheduled = await waitForStatus(apiKey, id, ['scheduled']);
    expect(scheduled.posts.map((p) => p.integration)).toEqual([linkedinId, xId]);
    const rows = await prisma.post.findMany({
      where: { id: { in: scheduled.posts.map((p) => p.postId) } },
    });
    expect(rows.map((r) => [r.integrationId, r.state, r.content]).sort()).toEqual(
      [
        [linkedinId, 'QUEUE', '<p>No LinkedIn</p>'],
        [xId, 'QUEUE', '<p>No X</p>'],
      ].sort()
    );

    expect((await api('DELETE', `/compositions/${id}`, apiKey)).status).toBe(200);
    expect(
      await prisma.post.count({
        where: { id: { in: scheduled.posts.map((p) => p.postId) }, deletedAt: null },
      })
    ).toBe(0);
  });
});
