import { Body, Controller, Delete, Get, Param, Post, Query, ValidationPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import { CreateCompositionDto } from '@gitroom/nestjs-libraries/dtos/compositions/create.composition.dto';
import { GetCompositionsDto } from '@gitroom/nestjs-libraries/dtos/compositions/get.compositions.dto';

@ApiTags('Compositions')
@Controller('/compositions')
export class CompositionsController {
  constructor(private _compositionService: CompositionService) {}

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  startComposition(
    @GetOrgFromRequest() org: Organization,
    @Body(new ValidationPipe({ whitelist: true, transform: true })) body: CreateCompositionDto
  ) {
    return this._compositionService.startComposition(org, body);
  }

  @Get('/')
  getCompositions(@GetOrgFromRequest() org: Organization, @Query() query: GetCompositionsDto) {
    return this._compositionService.getCompositionsWithContent(org.id, query.page || 0, query.status);
  }

  @Get('/count')
  countCompositions(@GetOrgFromRequest() org: Organization, @Query() query: GetCompositionsDto) {
    return this._compositionService.countCompositions(org.id, query.status);
  }

  @Get('/:id')
  getComposition(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._compositionService.getCompositionWithContent(org.id, id);
  }

  @Post('/:id/approve')
  approveComposition(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._compositionService.approveComposition(org.id, id);
  }

  @Delete('/:id')
  deleteComposition(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._compositionService.deleteComposition(org.id, id);
  }
}
