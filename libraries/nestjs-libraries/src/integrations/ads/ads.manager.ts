import { Injectable } from '@nestjs/common';
import { AdsProvider } from '@gitroom/nestjs-libraries/integrations/ads/ads.interface';
import { MetaAdsProvider } from '@gitroom/nestjs-libraries/integrations/ads/meta.ads.provider';
import { GoogleAdsProvider } from '@gitroom/nestjs-libraries/integrations/ads/google.ads.provider';

export const adsProviderList: AdsProvider[] = [
  new MetaAdsProvider(),
  new GoogleAdsProvider(),
];

@Injectable()
export class AdsManager {
  getAllProviders() {
    return adsProviderList.map((provider) => ({
      identifier: provider.identifier,
      name: provider.name,
      configured: provider.isConfigured(),
    }));
  }

  getProvider(identifier: string): AdsProvider | undefined {
    return adsProviderList.find((provider) => provider.identifier === identifier);
  }
}
