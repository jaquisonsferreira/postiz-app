import { HttpException, Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { ApplicationFailure } from '@temporalio/common';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsBoostService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service';
import { truncateForTemporal } from '@gitroom/nestjs-libraries/integrations/social.abstract';

@Injectable()
@Activity()
export class AdsActivity {
  constructor(
    private _adsService: AdsService,
    private _boostService: AdsBoostService
  ) {}

  @ActivityMethod()
  async syncAdAccounts() {
    return this._adsService.syncAll();
  }

  @ActivityMethod()
  async guardAdBudgets() {
    return this._adsService.guardBudgets();
  }

  @ActivityMethod()
  async autoBoostPosts() {
    return this._boostService.autoBoost();
  }

  // A refusal from the platform (a post that can't be promoted, an expired
  // login) does not change on a retry, so the workflow stops with its message
  @ActivityMethod()
  async launchBoost({ boostId }: { boostId: string }) {
    try {
      await this._boostService.launch(boostId);
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        throw ApplicationFailure.nonRetryable(
          truncateForTemporal(err.message, 2000),
          'boost_stop'
        );
      }
      throw err;
    }
  }

  @ActivityMethod()
  async failBoost({ boostId, error }: { boostId: string; error: string }) {
    await this._boostService.fail(boostId, error);
  }
}
