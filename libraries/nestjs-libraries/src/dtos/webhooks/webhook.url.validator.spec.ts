import dns from 'node:dns/promises';
import {
  checkPublicHttpsUrl,
  isBlockedIp,
  isSafePublicHttpsUrl,
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

describe('isBlockedIp', () => {
  it.each(['::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:0001', '::FFFF:a9fe:a9fe', '::ffff:a00:1'])(
    'bloqueia o IPv4 privado escrito como IPv6 mapeado %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    }
  );

  it.each(['fe80::1', 'fe90::1', 'feab:1::2', 'FEBF:ffff::1', 'fc00::1', 'fdff:1::1', 'ff02::1', '0:0:0:0:0:0:0:1', '0::0'])(
    'bloqueia o IPv6 link-local, local único, multicast, loopback ou não especificado %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    }
  );

  it.each(['2001:4860:4860::8888', '2606:4700::1111'])(
    'aceita o IPv6 fora das faixas bloqueadas %s',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    }
  );

  it('aceita um IPv4 público escrito como IPv6 mapeado', () => {
    expect(isBlockedIp('::ffff:808:808')).toBe(false);
  });
});

describe('isSafePublicHttpsUrl', () => {
  it('recusa loopback em IPv6 mapeado na URL', async () => {
    expect(await isSafePublicHttpsUrl('https://[::ffff:127.0.0.1]/logo.png')).toBe(false);
    expect(await isSafePublicHttpsUrl('https://[::ffff:7f00:1]/logo.png')).toBe(false);
  });
});

describe('checkPublicHttpsUrl', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const resolveTo = (address: string) =>
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address, family: 4 }] as unknown as Awaited<ReturnType<typeof dns.lookup>>);

  it('aceita um nome que resolve para um endereço público', async () => {
    resolveTo('93.184.216.34');
    expect(await checkPublicHttpsUrl('https://cdn.example.com/logo.png')).toBe('safe');
  });

  it('bloqueia um nome que resolve para um endereço privado', async () => {
    resolveTo('10.0.0.1');
    expect(await checkPublicHttpsUrl('https://interno.example.com/logo.png')).toBe('blocked');
    expect(await isSafePublicHttpsUrl('https://interno.example.com/logo.png')).toBe(false);
  });

  it('separa uma falha temporária de DNS de um endereço bloqueado', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockRejectedValue(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }));
    expect(await checkPublicHttpsUrl('https://cdn.example.com/logo.png')).toBe('unresolved');
    expect(await isSafePublicHttpsUrl('https://cdn.example.com/logo.png')).toBe(false);
  });

  it('bloqueia na hora o que não é uma URL HTTPS pública', async () => {
    expect(await checkPublicHttpsUrl('http://cdn.example.com/logo.png')).toBe('blocked');
    expect(await checkPublicHttpsUrl('https://localhost/logo.png')).toBe('blocked');
    expect(await checkPublicHttpsUrl('https://[::ffff:7f00:1]/logo.png')).toBe('blocked');
    expect(await checkPublicHttpsUrl('https://[fe90::1]/logo.png')).toBe('blocked');
  });
});
