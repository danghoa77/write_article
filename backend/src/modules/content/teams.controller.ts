import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { FirebaseIdentityGuard } from '../firebase/firebase-identity.guard.js';
import { TeamSettingsService } from './team-settings.service.js';
import type { ContentTeam } from './content.model.js';

@Controller('content/teams')
@UseGuards(FirebaseIdentityGuard)
export class TeamsController {
  constructor(private readonly settings: TeamSettingsService) {}

  @Get()
  get(@Req() request: any) {
    return this.settings.get(request.firebaseUser.uid);
  }

  @Put()
  update(
    @Req() request: any,
    @Body() body: { revision: number; teams: ContentTeam[] },
  ) {
    return this.settings.update(request.firebaseUser.uid, body);
  }
}
