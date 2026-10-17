import {
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
