import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FirebaseIdentityGuard } from '../firebase/firebase-identity.guard.js';
import { PromptSettingsService } from './prompt-settings.service.js';
import type { PromptOverrides, PromptStage } from './prompt.types.js';

@Controller('content/prompts')
@UseGuards(FirebaseIdentityGuard)
export class PromptsController {
  constructor(private readonly settings: PromptSettingsService) {}
  @Get()
  get(@Req() request: any) {
    return this.settings.get(request.firebaseUser.uid);
  }
  @Get('templates')
  templates() {
    return this.settings.templates();
  }
  @Patch()
  update(
    @Req() request: any,
    @Body() body: { revision: number; prompts: PromptOverrides },
  ) {
    return this.settings.update(request.firebaseUser.uid, body);
  }
  @Post('reset')
  reset(
    @Req() request: any,
    @Body() body: { revision: number; stages?: PromptStage[] },
  ) {
    return this.settings.reset(request.firebaseUser.uid, body);
  }
}
