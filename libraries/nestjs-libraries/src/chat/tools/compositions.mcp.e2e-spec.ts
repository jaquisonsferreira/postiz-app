import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  PrismaRepository,
  PrismaService,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { CompositionRepository } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.repository';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3000';
const UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY as string;
const TEMPORAL_UI_URL = process.env.E2E_TEMPORAL_UI_URL || 'http://localhost:8080';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'default';

const prisma = new PrismaService();
const compositions = new CompositionRepository(new PrismaRepository<'composition'>(prisma));

interface CompositionResponse {
  id: string;
  status: string;
  format: string;
  requiresApproval: boolean;
  error: string | null;
  media: { id: string; path: string }[];
  posts: { postId: string; integration: string; previewUrl: string }[];
}

type ToolOutput = { errors?: string } & Record<string, unknown>;

const connect = async (apiKey: string): Promise<Client> => {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${API_URL}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    })
  );
  return client;
};

const call = async (
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutput> => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  }
  const structured =
    (result.structuredContent as { output: ToolOutput } | undefined) ||
    (JSON.parse((result.content as { text: string }[])[0].text) as { output: ToolOutput });
  return structured.output;
};

const create = (client: Client, body: Record<string, unknown>) =>
  call(client, 'compositionCreateTool', body);
const get = (client: Client, id: string) => call(client, 'compositionGetTool', { id });
const approve = (client: Client, id: string) => call(client, 'compositionApproveTool', { id });
const remove = (client: Client, id: string) => call(client, 'compositionDeleteTool', { id });
const list = (client: Client, args: Record<string, unknown>) =>
  call(client, 'compositionsListTool', args);

const waitForStatus = async (
  client: Client,
  id: string,
  statuses: string[]
): Promise<CompositionResponse> => {
  const deadline = Date.now() + 180000;
  let last: CompositionResponse | null = null;
  while (Date.now() < deadline) {
    last = (await get(client, id)) as unknown as CompositionResponse;
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
    `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows?query=${query}`
  );
  const json = (await response.json()) as { executions?: unknown[] };
  return json.executions?.length || 0;
};

describe('Composições pelo MCP', () => {
  const apiKey = `e2e-${randomUUID()}`;
  const otherApiKey = `e2e-${randomUUID()}`;
  let orgId = '';
  let otherOrgId = '';
  let linkedinId = '';
  let xId = '';
  let foreignIntegrationId = '';
  let mcp: Client;
  let otherMcp: Client;
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
    mcp = await connect(apiKey);
    otherMcp = await connect(otherApiKey);
  });

  afterAll(async () => {
    await mcp.close();
    await otherMcp.close();
    const orgs = [orgId, otherOrgId];
    await prisma.post.deleteMany({ where: { organizationId: { in: orgs }, parentPostId: { not: null } } });
    await prisma.post.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.composition.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.media.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.integration.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  it('recusa conexões sem chave de API', async () => {
    const response = await fetch(`${API_URL}/mcp`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('expõe as ferramentas de composição', async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'compositionCreateTool',
        'compositionsListTool',
        'compositionGetTool',
        'compositionApproveTool',
        'compositionDeleteTool',
      ])
    );
  });

  it('recusa payload inválido', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'carousel',
      slides: [{ headline: 'Só um slide' }],
      targets: [{ integrationId: linkedinId, content: 'x' }],
    });
    expect(created.errors).toContain('carousel needs between 2 and 10 slides');
  });

  it('recusa canal de outra organização', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      targets: [{ integrationId: foreignIntegrationId, content: 'x' }],
    });
    expect(created.errors).toContain(`Channel ${foreignIntegrationId} is not available`);
  });

  it('recusa na hora configurações inválidas do provider com a mensagem do campo', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      targets: [{ integrationId: xId, content: 'Sem configuração de respostas' }],
    });
    expect(created.errors).toContain('who_can_reply_post');
    expect(await prisma.composition.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it('recusa na hora configurações inválidas mesmo quando a composição exige aprovação', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: xId, content: 'Sem configuração de respostas' }],
    });
    expect(created.errors).toContain('who_can_reply_post');
  });

  it('trata página negativa na listagem como a primeira', async () => {
    const listed = await list(mcp, { page: -1 });
    expect(Array.isArray(listed.compositions)).toBe(true);
  });

  it('recusa aprovar quando um rascunho foi apagado no painel', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [
        { integrationId: linkedinId, content: 'Canal mantido' },
        { integrationId: xId, content: 'Canal apagado', settings: { who_can_reply_post: 'everyone' } },
      ],
    });
    const id = created.id as string;
    const ready = await waitForStatus(mcp, id, ['awaiting_approval']);
    const removed = ready.posts.find((p) => p.integration === xId)!;
    await prisma.post.update({ where: { id: removed.postId }, data: { deletedAt: new Date() } });

    const approved = await approve(mcp, id);
    expect(approved.errors).toContain(xId);
    const kept = ready.posts.find((p) => p.integration === linkedinId)!;
    expect((await prisma.post.findUniqueOrThrow({ where: { id: kept.postId } })).state).toBe('DRAFT');
    expect(await get(mcp, id)).toMatchObject({ status: 'awaiting_approval' });

    expect(await remove(mcp, id)).toEqual({ id });
  });

  it('aceita payload grande dentro dos limites do DTO', async () => {
    const created = await create(mcp, {
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
    expect(created).toEqual({ id: expect.any(String), status: 'pending' });
    expect(await remove(mcp, created.id as string)).toEqual({ id: created.id });
  });

  it('cria, aprova e exclui um carrossel', async () => {
    const created = await create(mcp, {
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
    expect(created.status).toBe('pending');
    const id = created.id as string;

    const ready = await waitForStatus(mcp, id, ['awaiting_approval']);
    expect(ready.error).toBeNull();
    expect(ready.status).toBe('awaiting_approval');
    expect(ready.media).toHaveLength(3);
    for (const media of ready.media) {
      const metadata = await sharp(readFileSync(fileOf(media.path))).metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', 1080, 1350]);
    }

    expect(ready.posts).toHaveLength(1);
    expect(ready.posts[0].previewUrl).toContain(`/p/${ready.posts[0].postId}?share=true`);
    const draft = await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } });
    expect(draft.state).toBe('DRAFT');
    expect(draft.integrationId).toBe(linkedinId);
    expect(draft.content).toBe('<p>A Reforma Tributária já começou.</p><p></p><p>Salve este post.</p>');
    expect((JSON.parse(draft.image as string) as { id: string }[]).map((m) => m.id)).toEqual(
      ready.media.map((m) => m.id)
    );
    expect(new Date(draft.publishDate).toISOString()).toBe(future);

    const listed = await list(mcp, { status: 'awaiting_approval' });
    expect((listed.compositions as CompositionResponse[]).map((c) => c.id)).toContain(id);

    const approved = await approve(mcp, id);
    expect(approved.status).toBe('scheduled');
    const queued = await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } });
    expect(queued.state).toBe('QUEUE');
    await eventually(async () => (await runningWorkflows(queued.id)) === 1);

    const approvedAgain = await approve(mcp, id);
    expect(approvedAgain.errors).toContain('Only a composition awaiting approval can be approved');

    expect(await get(otherMcp, id)).toEqual({ errors: 'Composition not found' });

    expect(await remove(mcp, id)).toEqual({ id });
    const removed = await prisma.post.findUniqueOrThrow({ where: { id: queued.id } });
    expect(removed.deletedAt).not.toBeNull();
    await eventually(async () => (await runningWorkflows(queued.id)) === 0);
    expect(await get(mcp, id)).toEqual({ errors: 'Composition not found' });
  });

  it('registra no status a falha de renderização e permite excluir', async () => {
    const created = await create(mcp, {
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
    const id = created.id as string;

    const failed = await waitForStatus(mcp, id, ['failed']);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Could not download https://169.254.169.254/latest/meta-data.png');
    expect(failed.posts).toEqual([]);

    expect(await remove(mcp, id)).toEqual({ id });
    expect(await get(mcp, id)).toEqual({ errors: 'Composition not found' });
  });

  it('agenda direto um fio de texto sem aprovação e exclui', async () => {
    const created = await create(mcp, {
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
    const id = created.id as string;

    const scheduled = await waitForStatus(mcp, id, ['scheduled']);
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

    expect(await remove(mcp, id)).toEqual({ id });
    expect(
      await prisma.post.count({ where: { organizationId: orgId, integrationId: xId, deletedAt: null } })
    ).toBe(0);
  });

  it('agenda um post por canal com os ids reais e exclui todos', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      targets: [
        { integrationId: linkedinId, content: 'No LinkedIn' },
        { integrationId: xId, content: 'No X', settings: { who_can_reply_post: 'everyone' } },
      ],
    });
    const id = created.id as string;

    const scheduled = await waitForStatus(mcp, id, ['scheduled']);
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

    expect(await remove(mcp, id)).toEqual({ id });
    expect(
      await prisma.post.count({
        where: { id: { in: scheduled.posts.map((p) => p.postId) }, deletedAt: null },
      })
    ).toBe(0);
  });

  it('exclui também o post de um canal que nunca foi gravado na composição', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: linkedinId, content: 'Canal gravado' }],
    });
    const id = created.id as string;
    await waitForStatus(mcp, id, ['awaiting_approval']);
    const orphan = await prisma.post.create({
      data: {
        organizationId: orgId,
        integrationId: linkedinId,
        content: '<p>Órfão</p>',
        group: `${id}-0`,
        publishDate: new Date(future),
        state: 'DRAFT',
      },
      select: { id: true },
    });

    expect(await remove(mcp, id)).toEqual({ id });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: orphan.id } })).deletedAt).not.toBeNull();
  });

  it('trata página enorme na listagem sem erro', async () => {
    const listed = await list(mcp, { page: 1e308 });
    expect(listed.compositions).toEqual([]);
  });

  it('exclui o rascunho mesmo depois de editado no painel', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: linkedinId, content: 'Será editado' }],
    });
    const id = created.id as string;
    const ready = await waitForStatus(mcp, id, ['awaiting_approval']);
    await prisma.post.update({
      where: { id: ready.posts[0].postId },
      data: { group: randomUUID() },
    });

    expect(await remove(mcp, id)).toEqual({ id });
    expect(
      (await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } })).deletedAt
    ).not.toBeNull();
  });

  it('revalida o rascunho editado no painel antes de aprovar', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: linkedinId, content: 'Curto' }],
    });
    const id = created.id as string;
    const ready = await waitForStatus(mcp, id, ['awaiting_approval']);
    await prisma.post.update({
      where: { id: ready.posts[0].postId },
      data: { content: `<p>${'x'.repeat(4000)}</p>` },
    });

    const approved = await approve(mcp, id);
    expect(approved.errors).toContain('3000');
    expect(
      (await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } })).state
    ).toBe('DRAFT');

    expect(await remove(mcp, id)).toEqual({ id });
  });
  it('não devolve à renderização uma composição que já foi agendada', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: linkedinId, content: 'Já agendada' }],
    });
    const id = created.id as string;
    await waitForStatus(mcp, id, ['awaiting_approval']);

    expect((await compositions.claimRendering(id)).count).toBe(0);
    expect(await get(mcp, id)).toMatchObject({ status: 'awaiting_approval' });

    expect(await remove(mcp, id)).toEqual({ id });
  });
  it('reserva o agendamento para uma tentativa por vez', async () => {
    const { id } = await prisma.composition.create({
      data: {
        organizationId: orgId,
        status: 'rendering',
        format: 'text',
        publishDate: new Date(future),
        payload: '{}',
      },
      select: { id: true },
    });

    expect((await compositions.claimScheduling(id, 'primeira')).count).toBe(1);
    expect((await compositions.claimScheduling(id, 'segunda')).count).toBe(0);
    expect((await compositions.holdScheduling(id, 'segunda', null)).count).toBe(0);
    expect((await compositions.savePosts(id, 'segunda', null, '[]')).count).toBe(0);
    expect((await compositions.holdScheduling(id, 'primeira', null)).count).toBe(1);
    expect((await compositions.savePosts(id, 'primeira', null, '[]')).count).toBe(1);

    await prisma.composition.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    expect((await compositions.claimScheduling(id, 'segunda')).count).toBe(1);
    expect((await compositions.holdScheduling(id, 'primeira', '[]')).count).toBe(0);
    expect((await compositions.savePosts(id, 'primeira', '[]', '[]')).count).toBe(0);
  });
  it('reserva o enfileiramento para uma tentativa por vez', async () => {
    const { id } = await prisma.composition.create({
      data: {
        organizationId: orgId,
        status: 'scheduling',
        format: 'text',
        publishDate: new Date(future),
        payload: '{}',
      },
      select: { id: true },
    });

    expect((await compositions.claimQueueing(id, 'primeira')).count).toBe(1);
    expect((await compositions.claimQueueing(id, 'segunda')).count).toBe(0);
    expect((await compositions.finishQueueing(id, 'segunda', 'scheduled')).count).toBe(0);

    await prisma.composition.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    expect((await compositions.claimQueueing(id, 'segunda')).count).toBe(1);
    expect((await compositions.finishQueueing(id, 'primeira', 'scheduled')).count).toBe(0);
    expect((await compositions.finishQueueing(id, 'segunda', 'scheduled')).count).toBe(1);
  });
  it('recusa aprovar quando o canal foi desativado durante a espera', async () => {
    const channel = await createIntegration(orgId, 'linkedin-page');
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: channel.id, content: 'Canal desativado' }],
    });
    const id = created.id as string;
    const ready = await waitForStatus(mcp, id, ['awaiting_approval']);
    await prisma.integration.update({ where: { id: channel.id }, data: { disabled: true } });

    const approved = await approve(mcp, id);
    expect(approved.errors).toEqual(expect.any(String));
    expect(
      (await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } })).state
    ).toBe('DRAFT');

    expect(await remove(mcp, id)).toEqual({ id });
  });

  it('descarta campos fora do contrato antes de guardar a composição', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      junk: 'x'.repeat(1000),
      targets: [{ integrationId: linkedinId, content: 'Sem lixo', extra: 'y' }],
    });
    const id = created.id as string;
    const stored = await prisma.composition.findUniqueOrThrow({ where: { id } });

    expect(stored.payload).not.toContain('junk');
    expect(stored.payload).not.toContain('extra');

    await waitForStatus(mcp, id, ['awaiting_approval']);
    expect(await remove(mcp, id)).toEqual({ id });
  });

  it('renova a reserva do enfileiramento só para quem a detém', async () => {
    const { id } = await prisma.composition.create({
      data: {
        organizationId: orgId,
        status: 'scheduling',
        format: 'text',
        publishDate: new Date(future),
        payload: '{}',
      },
      select: { id: true },
    });
    expect((await compositions.claimQueueing(id, 'primeira')).count).toBe(1);
    await prisma.composition.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });

    expect((await compositions.holdQueueing(id, 'segunda')).count).toBe(0);
    expect((await compositions.holdQueueing(id, 'primeira')).count).toBe(1);
    expect((await compositions.claimQueueing(id, 'segunda')).count).toBe(0);
  });
  it('recusa comentários em canal que não publica comentários', async () => {
    const pinterest = await createIntegration(orgId, 'pinterest');
    const created = await create(mcp, {
      date: future,
      format: 'text',
      targets: [{ integrationId: pinterest.id, content: 'Pin', comments: ['Comentário'] }],
    });
    expect(created.errors).toContain('comments');
  });

  it('termina a limpeza de uma exclusão que parou depois de marcar a composição', async () => {
    const created = await create(mcp, {
      date: future,
      format: 'text',
      requiresApproval: true,
      targets: [{ integrationId: linkedinId, content: 'Exclusão interrompida' }],
    });
    const id = created.id as string;
    const ready = await waitForStatus(mcp, id, ['awaiting_approval']);
    await prisma.composition.update({ where: { id }, data: { deletedAt: new Date() } });

    expect(await remove(mcp, id)).toEqual({ id });
    expect(
      (await prisma.post.findUniqueOrThrow({ where: { id: ready.posts[0].postId } })).deletedAt
    ).not.toBeNull();
  });

  it('não exclui a composição de outra organização, nem depois de marcada como excluída', async () => {
    const { id } = await prisma.composition.create({
      data: {
        organizationId: otherOrgId,
        status: 'awaiting_approval',
        format: 'text',
        publishDate: new Date(future),
        payload: JSON.stringify({ targets: [{ integrationId: foreignIntegrationId, content: 'x' }] }),
      },
      select: { id: true },
    });

    const notFound = { errors: 'Composition not found' };
    expect(await remove(mcp, id)).toEqual(notFound);
    await prisma.composition.update({ where: { id }, data: { deletedAt: new Date() } });
    expect(await remove(mcp, id)).toEqual(notFound);
    expect(await remove(mcp, randomUUID())).toEqual(notFound);
  });

  it('reserva a aprovação para uma tentativa por vez', async () => {
    const { id } = await prisma.composition.create({
      data: {
        organizationId: orgId,
        status: 'awaiting_approval',
        format: 'text',
        publishDate: new Date(future),
        payload: '{}',
      },
      select: { id: true },
    });

    expect((await compositions.claimApproval(orgId, id, 'primeira')).count).toBe(1);
    expect((await compositions.claimApproval(orgId, id, 'segunda')).count).toBe(0);
    await prisma.composition.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    expect((await compositions.holdApproval(id, 'primeira')).count).toBe(1);
    expect((await compositions.claimApproval(orgId, id, 'segunda')).count).toBe(0);

    await prisma.composition.update({
      where: { id },
      data: { updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    expect((await compositions.claimApproval(orgId, id, 'segunda')).count).toBe(1);
    expect((await compositions.holdApproval(id, 'primeira')).count).toBe(0);
    expect((await compositions.finishApproval(id, 'primeira', '[]')).count).toBe(0);
    expect((await compositions.finishApproval(id, 'segunda', '[]')).count).toBe(1);
  });
});
