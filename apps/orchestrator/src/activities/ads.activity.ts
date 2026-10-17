import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';

@Injectable()
@Activity()
export class AdsActivity {
  constructor(private _adsService: AdsService) {}

  @ActivityMethod()
  async syncAdAccounts() {
    return this._adsService.syncAll();
  }
}
