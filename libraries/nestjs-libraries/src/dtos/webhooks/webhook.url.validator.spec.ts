import { isBlockedIp, isSafePublicHttpsUrl } from './webhook.url.validator';

describe('webhook.url.validator', () => {
  describe('isBlockedIp', () => {
    it.each([
      '127.0.0.1',
      '169.254.169.254',
      '10.0.0.5',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '::FFFF:A00:5',
    ])('bloqueia %s', (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '2606:4700:4700::1111', '::ffff:808:808'])(
      'permite %s',
      (ip) => {
        expect(isBlockedIp(ip)).toBe(false);
      }
    );
  });

  describe('isSafePublicHttpsUrl', () => {
    it.each([
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:a9fe:a9fe]/latest/meta-data',
    ])('rejeita %s', async (url) => {
      expect(await isSafePublicHttpsUrl(url)).toBe(false);
    });
  });
});
