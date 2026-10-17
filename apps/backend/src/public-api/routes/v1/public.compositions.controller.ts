import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import { CreateCompositionDto } from '@gitroom/nestjs-libraries/dtos/compositions/create.composition.dto';

@ApiTags('Public API')
@Controller('/public/v1/compositions')
export class PublicCompositionsController {
  constructor(private _compositionService: CompositionService) {}

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  startComposition(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateCompositionDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._compositionService.startComposition(org, body);
  }

  @Get('/')
  getCompositions(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._compositionService.getCompositions(org.id, page);
  }

  @Get('/:id')
  getComposition(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    Sentry.metrics.count('public_api-request', 1);
    return this._compositionService.getComposition(org.id, id);
  }

  @Post('/:id/approve')
  approveComposition(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    Sentry.metrics.count('public_api-request', 1);
    return this._compositionService.approveComposition(org.id, id);
  }

  @Delete('/:id')
  deleteComposition(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    Sentry.metrics.count('public_api-request', 1);
    return this._compositionService.deleteComposition(org.id, id);
  }
}
