import net from 'node:net';
import { AddressInfo } from 'node:net';
import { Dispatcher } from 'undici';
import {
  getSsrfSafeAxios,
  getSsrfSafeDispatcher,
  ssrfSafeDispatcher,
} from './ssrf.safe.dispatcher';

interface LocalServer {
  port: number;
  connections: () => number;
  close: () => Promise<void>;
}

const startLocalServer = async (): Promise<LocalServer> => {
  let count = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    count++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.end(
      'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => count,
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
      }),
  };
};

interface DispatcherRequestInit extends RequestInit {
  dispatcher?: Dispatcher;
}

const fetchWith = (
  url: string,
  dispatcher: Dispatcher | undefined,
  signal?: AbortSignal
): Promise<Response> => {
  const init: DispatcherRequestInit = { dispatcher, signal };
  return fetch(url, init);
};

interface ErrorLike {
  message: string;
  cause?: unknown;
}

const isErrorLike = (value: unknown): value is ErrorLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ErrorLike).message === 'string';

const errorChain = (err: unknown): string => {
  const messages: string[] = [];
  let current: unknown = err;
  while (isErrorLike(current)) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(' <- ');
};

const UNBLOCKED_IP = '203.0.113.10';
const BLOCKED_IP_URLS = [
  'https://169.254.169.254/latest/meta-data',
  'https://10.0.0.5/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
];

describe('ssrf.safe.dispatcher', () => {
  let server: LocalServer;
  const originalFlag = process.env.DISABLE_SSRF_PROTECTION;

  beforeEach(async () => {
    delete process.env.DISABLE_SSRF_PROTECTION;
    server = await startLocalServer();
  });

  afterEach(async () => {
    await server.close();
    if (originalFlag === undefined) {
      delete process.env.DISABLE_SSRF_PROTECTION;
    } else {
      process.env.DISABLE_SSRF_PROTECTION = originalFlag;
    }
  });

  describe('ssrfSafeDispatcher', () => {
    it.each(['http', 'https'])(
      'bloqueia IP literal privado via %s sem abrir conexão',
      async (protocol) => {
        const error = await fetchWith(
          `${protocol}://127.0.0.1:${server.port}/`,
          ssrfSafeDispatcher
        ).catch((err: unknown) => err);

        expect(errorChain(error)).toContain('Blocked IP');
        expect(server.connections()).toBe(0);
      }
    );

    it.each(BLOCKED_IP_URLS)('bloqueia %s', async (url) => {
      const error = await fetchWith(
        url,
        ssrfSafeDispatcher,
        AbortSignal.timeout(300)
      ).catch((err: unknown) => err);

      expect(errorChain(error)).toContain('Blocked IP');
    });

    it('bloqueia hostname que resolve para IP privado', async () => {
      const error = await fetchWith(
        `http://localhost:${server.port}/`,
        ssrfSafeDispatcher
      ).catch((err: unknown) => err);

      expect(errorChain(error)).toContain('Blocked IP');
      expect(server.connections()).toBe(0);
    });

    it('não bloqueia IP literal público', async () => {
      const error = await fetchWith(
        `http://${UNBLOCKED_IP}:80/`,
        ssrfSafeDispatcher,
        AbortSignal.timeout(300)
      ).catch((err: unknown) => err);

      expect(errorChain(error)).not.toContain('Blocked IP');
    });
  });

  describe('getSsrfSafeDispatcher', () => {
    it('retorna o dispatcher seguro por padrão', () => {
      expect(getSsrfSafeDispatcher()).toBe(ssrfSafeDispatcher);
    });

    it('permite IP privado quando DISABLE_SSRF_PROTECTION=true', async () => {
      process.env.DISABLE_SSRF_PROTECTION = 'true';

      const response = await fetchWith(
        `http://127.0.0.1:${server.port}/`,
        getSsrfSafeDispatcher()
      );

      expect(await response.text()).toBe('ok');
      expect(server.connections()).toBe(1);
    });
  });

  describe('getSsrfSafeAxios', () => {
    it.each(['http', 'https'])(
      'bloqueia IP literal privado via %s sem abrir conexão',
      async (protocol) => {
        const error = await getSsrfSafeAxios()
          .get(`${protocol}://127.0.0.1:${server.port}/`, { proxy: false })
          .catch((err: unknown) => err);

        expect(errorChain(error)).toContain('Blocked IP');
        expect(server.connections()).toBe(0);
      }
    );

    it.each(BLOCKED_IP_URLS)('bloqueia %s', async (url) => {
      const error = await getSsrfSafeAxios()
        .get(url, { proxy: false, timeout: 300 })
        .catch((err: unknown) => err);

      expect(errorChain(error)).toContain('Blocked IP');
    });

    it('bloqueia hostname que resolve para IP privado', async () => {
      const error = await getSsrfSafeAxios()
        .get(`http://localhost:${server.port}/`, { proxy: false })
        .catch((err: unknown) => err);

      expect(errorChain(error)).toContain('Blocked IP');
      expect(server.connections()).toBe(0);
    });

    it('não bloqueia IP literal público', async () => {
      const error = await getSsrfSafeAxios()
        .get(`http://${UNBLOCKED_IP}:80/`, { proxy: false, timeout: 300 })
        .catch((err: unknown) => err);

      expect(errorChain(error)).not.toContain('Blocked IP');
    });

    it('permite IP privado quando DISABLE_SSRF_PROTECTION=true', async () => {
      process.env.DISABLE_SSRF_PROTECTION = 'true';

      const { data } = await getSsrfSafeAxios().get(
        `http://127.0.0.1:${server.port}/`,
        { proxy: false }
      );

      expect(data).toBe('ok');
      expect(server.connections()).toBe(1);
    });
  });
});
