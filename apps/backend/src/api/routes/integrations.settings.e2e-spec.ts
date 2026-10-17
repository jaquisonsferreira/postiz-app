import { randomUUID } from 'crypto';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3000';
const prisma = new PrismaService();

describe('Configurações de canal no app', () => {
  let auth = '';
  let orgId = '';

  const channel = (providerIdentifier: string) =>
    prisma.integration.create({
      data: {
        internalId: randomUUID(),
        organizationId: orgId,
        name: providerIdentifier,
        providerIdentifier,
        type: 'social',
        token: 'e2e-token',
        tokenExpiration: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

  const schema = async (id: string) => {
    const response = await fetch(`${API_URL}/integrations/${id}/settings-schema`, { headers: { auth } });
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    const email = `e2e-${randomUUID()}@pauta.test`;
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Senha12345', company: 'E2E Schema', provider: 'LOCAL' }),
    });
    auth = /auth=([^;]+)/.exec(response.headers.get('set-cookie') || '')?.[1] || '';
    orgId = (
      await prisma.user.findFirstOrThrow({
        where: { email },
        select: { organizations: { select: { organizationId: true } } },
      })
    ).organizations[0].organizationId;
  });

  afterAll(async () => {
    await prisma.integration.deleteMany({ where: { organizationId: orgId } });
    await prisma.$disconnect();
  });

  it('devolve o schema das configurações exigidas pelo provider do canal', async () => {
    const { id } = await channel('x');
    const { status, json } = await schema(id);

    expect(status).toBe(200);
    const settings = json.settings as { properties: Record<string, { enum?: string[] }>; required?: string[] };
    expect(settings.required).toContain('who_can_reply_post');
    expect(settings.properties.who_can_reply_post.enum).toContain('everyone');
    expect(typeof json.maxLength).toBe('number');
  });

  it('indica quando o provider não exige configurações', async () => {
    const { id } = await channel('linkedin-page');
    const { json } = await schema(id);
    expect(json.settings).toBeNull();
  });

  it('não devolve schema de canal de outra organização', async () => {
    const other = await prisma.organization.create({ data: { name: 'Outra' }, select: { id: true } });
    const foreign = await prisma.integration.create({
      data: {
        internalId: randomUUID(),
        organizationId: other.id,
        name: 'x',
        providerIdentifier: 'x',
        type: 'social',
        token: 'e2e-token',
      },
      select: { id: true },
    });
    expect((await schema(foreign.id)).status).toBe(404);
    await prisma.integration.delete({ where: { id: foreign.id } });
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
