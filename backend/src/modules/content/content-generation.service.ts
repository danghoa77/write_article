import {
  BadRequestException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentAiService } from './content-ai.service.js';
import { ContentConfigService } from './content-config.service.js';
import { ContentService } from './content.service.js';
import type {
  BatchContentBody,
  GenerateContentBody,
  PreparedContent,
} from './content.model.js';
import { validatePromptOverrides } from './prompt.types.js';
import { CharacterRotationService } from './character-rotation.service.js';
import { formatContent } from './transforms/format-content.js';

// The original n8n writer, with source-specific repetition history only.
@Injectable()
export class ContentGenerationService {
  constructor(
    private readonly content: ContentService,
    private readonly ai: ContentAiService,
    private readonly config: ContentConfigService,
    private readonly rotation: CharacterRotationService,
  ) {}

  async batch(body: BatchContentBody) {
    if (
      !body ||
      typeof body.caption !== 'string' ||
      !body.caption.trim() ||
      typeof body.content !== 'string' ||
      !body.content.trim() ||
      !Array.isArray(body.teams) ||
      !body.teams.length ||
      (body.prompt !== undefined && typeof body.prompt !== 'string')
    )
      throw new BadRequestException(
        'Provide caption, content and at least one team',
      );
    for (const team of body.teams) this.content.validateTeam(team);
    validatePromptOverrides(body.prompts);
    this.ai.preflight(body.textProvider);
    const results = await Promise.all(
      body.teams.map(async (team) => {
        let ticket:
          Awaited<ReturnType<CharacterRotationService['begin']>> | undefined;
        try {
          ticket = await this.rotation.begin(body.caption, body.content, team);
          const prompt = this.content.renderPrompt({
            team,
            caption: body.caption,
            content: body.content,
            prompt: body.prompts?.rewrite ?? this.config.defaults().prompt,
          });
          // The optional note belongs only to this caption/content pair.
          const text = await this.ai.text(
            prompt +
              this.rotation.directive(ticket) +
              (body.prompt?.trim()
                ? '\n\nAdditional instructions for this source:\n' + body.prompt
                : ''),
            body.textProvider,
          );
          const formatted = await formatContent([
            {
              json: {
                candidates: [{ content: { parts: [{ text }] } }],
                'Sport Team': `${team.sport} ${team.team}`,
              },
            },
          ]);
          const article = formatted[0].json as PreparedContent;
          if (
            article.title === 'No Title' ||
            article.caption === 'No Caption' ||
            article.content === 'No Content'
          )
            throw new UnprocessableEntityException(
              'Writer response missing Title, Caption or Content',
            );
          const rotation = await this.rotation.complete(ticket, article);
          return {
            requiresReview: false,
            reviewWarnings: [],
            rotation,
            team: team.team,
            categories: team.categories,
            success: true,
            article,
          };
        } catch (error) {
          return {
            team: team.team,
            categories: team.categories,
            success: false,
            stage: 'generate',
            statusCode:
              error instanceof HttpException ? error.getStatus() : 502,
            error:
              error instanceof HttpException
                ? error.getResponse()
                : { message: 'Writing failed' },
          };
        } finally {
          if (ticket) await this.rotation.release(ticket);
        }
      }),
    );
    return {
      success: results.every((item) => item.success),
      textProvider: body.textProvider ?? 'gemini',
      mode: 'n8n-rotation',
      results,
    };
  }

  async single(body: GenerateContentBody): Promise<PreparedContent> {
    const batch = await this.batch({ ...body, teams: [body?.team] });
    const result = batch.results[0];
    if (!result.success)
      throw new HttpException(result.error!, result.statusCode!);
    return result.article!;
  }
}
