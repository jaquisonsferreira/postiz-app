import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import {
  AdsSummaryDto,
  ConnectAdsDto,
  SaveAdAccountsDto,
} from '@gitroom/nestjs-libraries/dtos/ads/ads.dto';

@ApiTags('Ads')
@Controller('/ads')
export class AdsController {
  constructor(private _adsService: AdsService) {}

  @Get('/providers')
  getProviders() {
    return this._adsService.providers();
  }

  @Get('/accounts')
  getAccounts(@GetOrgFromRequest() org: Organization) {
    return this._adsService.listAccounts(org.id);
  }

  @Post('/accounts')
  saveAccounts(@GetOrgFromRequest() org: Organization, @Body() body: SaveAdAccountsDto) {
    return this._adsService.saveAccounts(org.id, body.connection, body.externalIds);
  }

  @Post('/accounts/:id/sync')
  async syncAccount(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    await this._adsService.syncAccount(org.id, id);
  }

  @Delete('/accounts/:id')
  async deleteAccount(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    await this._adsService.deleteAccount(org.id, id);
  }

  @Get('/summary')
  getSummary(@GetOrgFromRequest() org: Organization, @Query() query: AdsSummaryDto) {
    return this._adsService.summary(org.id, query);
  }

  @Get('/:provider/url')
  getAuthUrl(@GetOrgFromRequest() org: Organization, @Param('provider') provider: string) {
    return this._adsService.generateAuthUrl(org.id, provider);
  }

  @Post('/:provider/connect')
  connect(
    @GetOrgFromRequest() org: Organization,
    @Param('provider') provider: string,
    @Body() body: ConnectAdsDto
  ) {
    return this._adsService.connect(org.id, provider, body);
  }
}
