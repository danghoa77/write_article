import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { ArticlesModule } from '../articles/articles.module.js';
import { ContentConfigService } from './content-config.service.js';
import { ContentController } from './content.controller.js';
import { ContentHttpService } from './content-http.service.js';
import { ContentService } from './content.service.js';
import { ContentWorkflowService } from './content-workflow.service.js';
import { TrelloService } from './trello.service.js';
import { ContentAiService } from './content-ai.service.js';
import { CharacterSelectionService } from './character-selection.service.js';
import { ContentGenerationService } from './content-generation.service.js';
import { FirebaseModule } from '../firebase/firebase.module.js';
import { PromptSettingsService } from './prompt-settings.service.js';
import { PromptsController } from './prompts.controller.js';
import { TeamSettingsService } from './team-settings.service.js';
import { TeamsController } from './teams.controller.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceSettingsService } from './workspace-settings.service.js';

@Module({
  imports: [AuthModule, ArticlesModule, FirebaseModule],
  controllers: [
    ContentController,
    PromptsController,
    TeamsController,
    WorkspaceController,
  ],
  providers: [
    ContentConfigService,
    ContentHttpService,
    ContentService,
    ContentWorkflowService,
    TrelloService,
    ContentAiService,
    CharacterSelectionService,
    ContentGenerationService,
    PromptSettingsService,
    TeamSettingsService,
    WorkspaceSettingsService,
  ],
})
export class ContentModule {}
