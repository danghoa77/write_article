import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { TeamSettingsService } from './team-settings.service.js';
import { ContentConfigService } from './content-config.service.js';
import { ContentService } from './content.service.js';
import { ContentWorkflowService } from './content-workflow.service.js';
import { TrelloService } from './trello.service.js';
import { ContentGenerationService } from './content-generation.service.js';
import type {
  CompleteWorkflowBody,
  GenerateContentBody,
  PreparedContent,
  BatchContentBody,
} from './content.model.js';

@Controller('content')
export class ContentController {
  constructor(
    private readonly config: ContentConfigService,
    private readonly content: ContentService,
    private readonly workflow: ContentWorkflowService,
    private readonly trello: TrelloService,
    private readonly generation: ContentGenerationService,
    private readonly teams: TeamSettingsService,
  ) {}

  @Get('config')
  defaults() {
    return {
      ...this.config.defaults(),
      pipelinePolicy: undefined,
      pipelinePrompts: { rewrite: this.config.defaults().prompt },
      credentials: this.config.credentialStatus(),
    };
  }

  @Get('source')
  source(@Query('listId') listId?: string) {
    return this.trello.source(listId);
  }

  @Post('generate')
  generate(@Body() body: GenerateContentBody) {
    return this.generation.single(body);
  }

  @Post('generate-batch')
  generateBatch(@Body() body: BatchContentBody) {
    return this.generation.batch(body);
  }

  @Post('search-images')
  searchImages(
    @Body() body: { query: string; imageProvider: 'serper' | 'tavily' },
  ) {
    return this.content.searchImages(body?.query, body?.imageProvider);
  }

  @Post('images')
  images(
    @Body()
    body: {
      article: PreparedContent;
      imageProvider: 'serper' | 'tavily';
    },
  ) {
    return this.content.images(body?.article, body?.imageProvider);
  }

  @Post('run')
  async run(
    @Body() body: CompleteWorkflowBody,
    @Headers('authorization') authorization?: string,
  ) {
    const teams = await this.teams.resolve(body?.teams, authorization);
    return this.workflow.run({ ...body, teams });
  }
}
