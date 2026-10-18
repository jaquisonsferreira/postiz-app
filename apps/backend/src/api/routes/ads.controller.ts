import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import { AdsBoostService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.boost.service';
import {
  AdsAutoBoostDto,
  AdsBoostDto,
  AdsBoostListDto,
  AdsBudgetRuleDto,
  AdsCampaignBudgetDto,
  AdsCampaignStatusDto,
  AdsSummaryDto,
  ConnectAdsDto,
  SaveAdAccountsDto,
} from '@gitroom/nestjs-libraries/dtos/ads/ads.dto';

@ApiTags('Ads')
@Controller('/ads')
export class AdsController {
  constructor(
    private _adsService: AdsService,
    private _boostService: AdsBoostService
  ) {}

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

  @Put('/accounts/:id/rule')
  async saveRule(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: AdsBudgetRuleDto
  ) {
    await this._adsService.saveRule(org.id, id, {
      monthlyCap: body.monthlyCap ?? null,
      approvalThreshold: body.approvalThreshold ?? null,
      alertAt: body.alertAt ?? null,
    });
  }

  @Delete('/accounts/:id/rule')
  async deleteRule(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    await this._adsService.deleteRule(org.id, id);
  }

  @Get('/summary')
  getSummary(@GetOrgFromRequest() org: Organization, @Query() query: AdsSummaryDto) {
    return this._adsService.summary(org.id, query);
  }

  @Get('/budget')
  getBudget(@GetOrgFromRequest() org: Organization) {
    return this._adsService.budget(org.id);
  }

  @Post('/campaigns/:id/status')
  setCampaignStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: AdsCampaignStatusDto
  ) {
    return this._adsService.setCampaignStatus(org.id, id, body.status);
  }

  @Put('/campaigns/:id/budget')
  updateCampaignBudget(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: AdsCampaignBudgetDto
  ) {
    return this._adsService.updateCampaignBudget(org.id, id, body.amount);
  }

  @Get('/posts/:postId/boost')
  getBoostOptions(@GetOrgFromRequest() org: Organization, @Param('postId') postId: string) {
    return this._boostService.options(org.id, postId);
  }

  @Get('/boosts')
  getBoosts(@GetOrgFromRequest() org: Organization, @Query() query: AdsBoostListDto) {
    return this._boostService.list(org.id, query.status);
  }

  @Post('/boosts')
  createBoost(@GetOrgFromRequest() org: Organization, @Body() body: AdsBoostDto) {
    return this._boostService.create(org.id, body, 'manual');
  }

  @Post('/boosts/:id/approve')
  approveBoost(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._boostService.approve(org.id, id);
  }

  @Post('/boosts/:id/reject')
  rejectBoost(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._boostService.reject(org.id, id);
  }

  @Get('/auto-boosts')
  getAutoBoosts(@GetOrgFromRequest() org: Organization) {
    return this._boostService.listAutoBoosts(org.id);
  }

  @Post('/auto-boosts')
  saveAutoBoost(@GetOrgFromRequest() org: Organization, @Body() body: AdsAutoBoostDto) {
    return this._boostService.saveAutoBoost(org.id, body);
  }

  @Delete('/auto-boosts/:id')
  async deleteAutoBoost(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    await this._boostService.deleteAutoBoost(org.id, id);
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
