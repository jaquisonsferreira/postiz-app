import { AdsManager } from '@gitroom/nestjs-libraries/integrations/ads/ads.manager';

describe('AdsManager', () => {
  it('lista cada provedor com o que ele aceita impulsionar', () => {
    const providers = new AdsManager().getAllProviders();

    expect(providers.map((provider) => provider.identifier)).toEqual(['meta-ads', 'google-ads']);
    expect(providers[0].boost).toEqual(
      expect.objectContaining({
        promotes: ['meta-post', 'meta-instagram-media'],
        budgetTypes: ['daily', 'lifetime'],
      })
    );
    expect(providers[1].boost).toEqual(
      expect.objectContaining({ promotes: ['youtube-video'], needsTexts: true })
    );
  });
});
