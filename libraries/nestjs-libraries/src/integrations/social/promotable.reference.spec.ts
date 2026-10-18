import { Integration } from '@prisma/client';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

const integration = (fields: Partial<Integration>) => fields as Integration;

describe('promotable reference of a published post', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives Facebook page posts as the story id Meta Ads boosts', async () => {
    const provider = new FacebookProvider();
    const page = integration({ internalId: '900' });

    expect(await provider.promotableReference('token', '900_800', page)).toEqual({
      type: 'meta-post',
      id: '900_800',
    });
    expect(await provider.promotableReference('token', '800', page)).toEqual({
      type: 'meta-post',
      id: '900_800',
    });
  });

  it('gives Instagram media with the page and the account it was published from', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '900' })));
    const provider = new InstagramProvider();

    const reference = await provider.promotableReference(
      'page-token___user-token',
      'media-1',
      integration({ internalId: 'ig-1' })
    );

    const asked = new URL(String(spy.mock.calls[0][0]));
    expect(asked.pathname).toBe('/v25.0/me');
    expect(asked.searchParams.get('access_token')).toBe('page-token');
    expect(reference).toEqual({
      type: 'meta-instagram-media',
      id: 'media-1',
      pageId: '900',
      instagramUserId: 'ig-1',
    });
  });

  it('gives YouTube videos with the channel picture to use as the ad logo', async () => {
    const provider = new YoutubeProvider();

    expect(
      await provider.promotableReference(
        'token',
        'yt123',
        integration({ picture: 'https://cdn.example/channel.png' })
      )
    ).toEqual({
      type: 'youtube-video',
      id: 'yt123',
      logoUrl: 'https://cdn.example/channel.png',
    });
  });
});
