import { AdsActivity } from '@gitroom/orchestrator/activities/ads.activity';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';

describe('AdsActivity', () => {
  it('sincroniza todas as contas de anúncio e devolve quantas falharam', async () => {
    const syncAll = jest.fn(async () => ({ synced: 2, failed: 1 }));
    const activity = new AdsActivity({ syncAll } as unknown as AdsService);

    await expect(activity.syncAdAccounts()).resolves.toEqual({ synced: 2, failed: 1 });
    expect(syncAll).toHaveBeenCalledTimes(1);
  });
});
