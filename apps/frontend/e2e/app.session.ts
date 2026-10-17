import { Browser, BrowserContext, chromium, Page } from 'playwright-core';
import { randomUUID } from 'crypto';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export const FRONTEND_URL = process.env.E2E_FRONTEND_URL || 'http://localhost:4200';
export const API_URL = process.env.E2E_API_URL || 'http://localhost:3000';

export const prisma = new PrismaService();

export interface AppSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  auth: string;
  orgId: string;
  close: () => Promise<void>;
}

// Each spec gets its own user and organization, registered through the API
// like a real sign up, and a browser already holding the session cookie
export const openAppSession = async (): Promise<AppSession> => {
  const email = `e2e-${randomUUID()}@pauta.test`;
  const response = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Senha12345', company: 'E2E Pauta', provider: 'LOCAL' }),
  });
  const auth = /auth=([^;]+)/.exec(response.headers.get('set-cookie') || '')?.[1];
  if (!auth) {
    throw new Error(`Could not register ${email}: ${response.status}`);
  }
  const user = await prisma.user.findFirstOrThrow({
    where: { email },
    select: { organizations: { select: { organizationId: true } } },
  });
  const orgId = user.organizations[0].organizationId;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([
    { name: 'auth', value: auth, url: FRONTEND_URL },
    { name: 'i18next', value: 'pt', url: FRONTEND_URL },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  return {
    browser,
    context,
    page,
    auth,
    orgId,
    close: async () => {
      await browser.close();
      await prisma.post.deleteMany({ where: { organizationId: orgId, parentPostId: { not: null } } });
      await prisma.post.deleteMany({ where: { organizationId: orgId } });
      await prisma.composition.deleteMany({ where: { organizationId: orgId } });
      await prisma.media.deleteMany({ where: { organizationId: orgId } });
      await prisma.integration.deleteMany({ where: { organizationId: orgId } });
    },
  };
};

export const createChannel = (organizationId: string, providerIdentifier: string, name: string) =>
  prisma.integration.create({
    data: {
      internalId: randomUUID(),
      organizationId,
      name,
      providerIdentifier,
      type: 'social',
      token: 'e2e-token',
      picture: '',
      tokenExpiration: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
