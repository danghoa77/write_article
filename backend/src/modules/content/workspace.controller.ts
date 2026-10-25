import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BrowserSessionGuard } from '../../auth/browser-session.guard.js';
import {
  BrowserSessionService,
  type BrowserSession,
} from '../../auth/browser-session.service.js';
import { TeamSettingsService } from './team-settings.service.js';
import { PromptSettingsService } from './prompt-settings.service.js';
import { ContentWorkflowService } from './content-workflow.service.js';
import type { CompleteWorkflowBody, ContentTeam } from './content.model.js';
import type { PromptOverrides, PromptStage } from './prompt.types.js';
import {
  WorkspaceSettingsService,
  type WorkspaceOptions,
  type LibraryItem,
} from './workspace-settings.service.js';
import { ContentConfigService } from './content-config.service.js';
import { TrelloService } from './trello.service.js';
type WorkspaceRequest = Request & { browserSession: BrowserSession };

@Controller('workspace')
@UseGuards(BrowserSessionGuard)
export class WorkspaceController {
  constructor(
    private readonly sessions: BrowserSessionService,
    private readonly teams: TeamSettingsService,
    private readonly prompts: PromptSettingsService,
    private readonly workflow: ContentWorkflowService,
    private readonly settings: WorkspaceSettingsService,
    private readonly config: ContentConfigService,
    private readonly trello: TrelloService,
  ) {}
  @Get('settings')
  getSettings(@Req() req: WorkspaceRequest) {
    return this.settings.get(this.sessions.uid(req.browserSession));
  }
  @Patch('settings')
  saveSettings(
    @Req() req: WorkspaceRequest,
    @Body()
    body: {
      revision: number;
      settings?: Partial<WorkspaceOptions>;
      secrets?: Record<string, string | null>;
    },
  ) {
    return this.settings.update(this.sessions.uid(req.browserSession), body);
  }
  @Get('config')
  getConfig(@Req() req: WorkspaceRequest) {
    return this.settings.execute(
      this.sessions.uid(req.browserSession),
      async () => ({
        ...this.config.defaults(),
        credentials: this.config.credentialStatus(),
      }),
    );
  }
  @Get('source')
  source(@Req() req: WorkspaceRequest) {
    return this.settings.execute(
      this.sessions.uid(req.browserSession),
      async () => this.trello.source(),
    );
  }
  @Get('library')
  library(@Req() req: WorkspaceRequest) {
    return this.settings.library(this.sessions.uid(req.browserSession));
  }
  @Put('library')
  saveLibrary(
    @Req() req: WorkspaceRequest,
    @Body() body: { revision: number; items: LibraryItem[] },
  ) {
    return this.settings.saveLibrary(
      this.sessions.uid(req.browserSession),
      body,
    );
  }
  @Get('teams')
  getTeams(@Req() req: WorkspaceRequest) {
    return this.teams.get(this.sessions.uid(req.browserSession));
  }
  @Put('teams')
  saveTeams(
    @Req() req: WorkspaceRequest,
    @Body() body: { revision: number; teams: ContentTeam[] },
  ) {
    return this.teams.update(this.sessions.uid(req.browserSession), body);
  }
  @Get('prompts')
  getPrompts(@Req() req: WorkspaceRequest) {
    return this.prompts.get(this.sessions.uid(req.browserSession));
  }
  @Patch('prompts')
  savePrompts(
    @Req() req: WorkspaceRequest,
    @Body() body: { revision: number; prompts: PromptOverrides },
  ) {
    return this.prompts.update(this.sessions.uid(req.browserSession), body);
  }
  @Post('prompts/reset')
  resetPrompts(
    @Req() req: WorkspaceRequest,
    @Body() body: { revision: number; stages?: PromptStage[] },
  ) {
    return this.prompts.reset(this.sessions.uid(req.browserSession), body);
  }
  @Post('run')
  run(
    @Req() req: WorkspaceRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: CompleteWorkflowBody,
  ) {
    const uid = this.sessions.uid(req.browserSession);
    return this.sessions.run(req, res, () =>
      this.settings.execute(uid, async (settings) => {
        const teams = await this.teams.resolveForUser(
          body?.teams,
          this.sessions.uid(req.browserSession),
        );
        // Browser requests always use the verified session, never stored login credentials.
        return this.workflow.run({
          ...body,
          login: undefined,
          teams,
          slugSuffix: body.slugSuffix ?? settings.slugSuffix,
          prompt: body.prompt ?? '',
        });
      }),
    );
  }
}
