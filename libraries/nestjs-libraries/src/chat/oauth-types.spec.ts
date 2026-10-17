import type * as http from 'node:http';
import { publicBackendUrl } from '@gitroom/nestjs-libraries/chat/oauth-types';
import { createOAuthMiddleware } from '@gitroom/nestjs-libraries/chat/oauth-middleware';

describe('publicBackendUrl', () => {
  it.each([
    ['https://pauta.oriflow.io/api', 'https://pauta.oriflow.io/api/mcp-oauth-dynamic'],
    ['https://pauta.oriflow.io/api/', 'https://pauta.oriflow.io/api/mcp-oauth-dynamic'],
    ['https://api.postiz.com', 'https://api.postiz.com/mcp-oauth-dynamic'],
    ['https://api.postiz.com/', 'https://api.postiz.com/mcp-oauth-dynamic'],
  ])('mantém o caminho do backend %s', (backendUrl, expected) => {
    expect(publicBackendUrl('/mcp-oauth-dynamic', backendUrl)).toBe(expected);
  });
});

describe('createOAuthMiddleware com o backend em /api', () => {
  it('aponta o WWW-Authenticate para os metadados com o /api do recurso', async () => {
    const middleware = createOAuthMiddleware({
      oauth: {
        resource: publicBackendUrl('/mcp-oauth-dynamic', 'https://pauta.oriflow.io/api'),
        authorizationServers: [
          publicBackendUrl('/mcp-oauth-dynamic', 'https://pauta.oriflow.io/api'),
        ],
      },
      mcpPath: '/mcp-oauth-dynamic',
    });
    const headers: Record<string, string> = {};
    const res = {
      writeHead: (_status: number, written: Record<string, string>) =>
        Object.assign(headers, written),
      end: () => undefined,
    } as unknown as http.ServerResponse;

    const result = await middleware(
      { method: 'POST', headers: {} } as http.IncomingMessage,
      res,
      new URL('https://pauta.oriflow.io/mcp-oauth-dynamic')
    );

    expect(result.proceed).toBe(false);
    expect(headers['WWW-Authenticate']).toContain(
      'resource_metadata="https://pauta.oriflow.io/.well-known/oauth-protected-resource/api/mcp-oauth-dynamic"'
    );
  });
});
