import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service.js';
import { ArticlesService } from '../articles/articles.service.js';
import { ContentConfigService } from './content-config.service.js';
import { ContentService } from './content.service.js';
import { TrelloService } from './trello.service.js';
import { ContentAiService } from './content-ai.service.js';
import { ContentGenerationService } from './content-generation.service.js';
import type {
  CompleteWorkflowBody,
  ContentTeam,
  SourceContent,
  PreparedContent,
} from './content.model.js';

@Injectable()
export class ContentWorkflowService {
  private running = false;
  constructor(
    private readonly config: ContentConfigService,
    private readonly content: ContentService,
    private readonly trello: TrelloService,
    private readonly articles: ArticlesService,
    private readonly auth: AuthService,
    private readonly generation: ContentGenerationService,
    private readonly ai: ContentAiService,
  ) {}

  async run(
    body: Omit<CompleteWorkflowBody, 'teams'> & { teams?: ContentTeam[] },
  ) {
    if (!body || !['serper', 'tavily'].includes(body.imageProvider)) {
      throw new BadRequestException('imageProvider must be serper or tavily');
    }
    if (
      (body.prompt !== undefined && typeof body.prompt !== 'string') ||
      (body.slugSuffix !== undefined && typeof body.slugSuffix !== 'string')
    ) {
      throw new BadRequestException('prompt and slugSuffix must be strings');
    }
    const teams = body.teams ?? this.config.defaults().teams;
    if (!Array.isArray(teams) || !teams.length)
      throw new BadRequestException('teams must not be empty');
    for (const team of teams) this.content.validateTeam(team);
    if (
      (body.caption !== undefined || body.content !== undefined) &&
      (typeof body.caption !== 'string' || typeof body.content !== 'string')
    ) {
      throw new BadRequestException('Provide both shared caption and content');
    }
    this.ai.preflight(body.textProvider);
    if (
      body.login !== undefined &&
      (typeof body.login?.username !== 'string' ||
        !body.login.username.trim() ||
        typeof body.login.password !== 'string' ||
        !body.login.password)
    ) {
      throw new BadRequestException('login requires username and password');
    }
    if (!body.login && !this.auth.get())
      throw new UnauthorizedException('missing token');
    // Fail before creating any drafts when a required credential is missing.
    for (const key of [
      'TRELLO_API_KEY',
      'TRELLO_API_TOKEN',
      body.imageProvider === 'tavily' ? 'TAVILY_API_KEY' : 'SERPER_API_KEY',
    ])
      this.config.key(key);
    if (this.running)
      throw new ConflictException(
        'A workflow is already running on this instance',
      );
    this.running = true;
    const results: any[] = [];
    try {
      // Optional inline login avoids requiring two requests to hit one Vercel instance.
      if (body.login)
        await this.auth.login(body.login.username, body.login.password);
      const source: SourceContent =
        body.caption !== undefined
          ? { cardId: '', caption: body.caption, content: body.content! }
          : await this.trello.source(body.listId);
      const batch = await this.generation.batch({
        caption: source.caption,
        content: source.content,
        teams,
        textProvider: body.textProvider,
        prompt: body.prompt,
        prompts: body.prompts,
        concurrency: body.concurrency,
      });
      if (!batch.success && teams.length === 1) {
        throw new HttpException(
          {
            code: 'CONTENT_BATCH_FAILED',
            stage: 'generate-batch',
            results: batch.results,
          },
          batch.results.find((item: any) => !item.success)?.statusCode ?? 502,
        );
      }
      await Promise.all(
        teams.map(async (team, index) => {
          const written = batch.results[index];
          if (written.success === false) {
            results[index] = {
              team: team.team,
              sport: team.sport,
              success: false,
              stage: written.stage ?? 'generate',
              published: false,
              statusCode: written.statusCode,
              error: written.error,
            };
            return;
          }
          if (written.requiresReview) {
            results[index] = {
              team: team.team,
              sport: team.sport,
              success: false,
              stage: 'review',
              published: false,
              article: written.article,
              requiresReview: true,
              rotation: written.rotation,
              reviewWarnings: written.reviewWarnings,
              error: {
                code: 'CHARACTER_REVIEW_REQUIRED',
                message:
                  'Bản viết chưa theo đúng chỉ thị nhân vật. Xem bản thử trước khi đăng.',
              },
            };
            return;
          }
          try {
            results[index] = {
              ...(await this.runTeam(team, written.article!, body)),
              sport: team.sport,
              success: true,
              rotation: written.rotation,
            };
          } catch (error) {
            if (teams.length === 1) throw error;
            const details =
              error instanceof HttpException
                ? error.getResponse()
                : { message: 'Workflow step failed' };
            results[index] = {
              ...(typeof details === 'object' ? details : { message: details }),
              team: team.team,
              sport: team.sport,
              success: false,
              statusCode:
                error instanceof HttpException ? error.getStatus() : 502,
            };
          }
        }),
      );
      const succeeded = results.filter((result) => result.success).length;
      return {
        success: succeeded === teams.length,
        partialSuccess: succeeded > 0 && succeeded < teams.length,
        summary: {
          total: teams.length,
          succeeded,
          failed: teams.length - succeeded,
        },
        sourceCardId: source.cardId || null,
        imageProvider: body.imageProvider,
        textProvider: body.textProvider ?? 'gemini',
        results,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        const details = error.getResponse();
        throw new HttpException(
          {
            ...(typeof details === 'object' ? details : { message: details }),
            completedResults: results,
          },
          error.getStatus(),
        );
      }
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async runTeam(
    team: ContentTeam,
    generated: PreparedContent,
    body: CompleteWorkflowBody,
  ) {
    let stage = 'create';
    let postId: string | undefined;
    let published = false;
    try {
      postId = await this.articles.createPost();
      stage = 'images';
      const prepared = await this.content.images(generated, body.imageProvider);
      if (!prepared.thumbnailUrl)
        throw new UnprocessableEntityException('No accessible thumbnail found');
      const slug = this.articles.generateSlug({
        title: prepared.title,
        postId,
        suffix: body.slugSuffix,
      });
      stage = 'update';
      await this.articles.updatePost(postId, {
        categories: team.categories,
        title: prepared.title,
        content: prepared.content,
        slug,
        featured_image: prepared.thumbnailUrl,
        featured_image_thumbnail: prepared.thumbnailUrl,
      });
      stage = 'publish';
      const publication = await this.articles.publishPost(postId);
      published = true;
      stage = 'trello-comment';
      // data4 finds the publish response by slug and reads trello[0].cardId.
      const publishedPost = publication?.slug === slug ? publication : null;
      const cardId = publishedPost?.trello?.[0]?.cardId;
      if (typeof cardId !== 'string' || !cardId) {
        throw new UnprocessableEntityException(
          'Publish response missing matching slug or trello[0].cardId; article may already be published',
        );
      }
      await this.trello.comment(cardId, prepared.caption);
      return {
        team: team.team,
        postId,
        slug,
        cardId,
        title: prepared.title,
        caption: prepared.caption,
        published: true,
        commented: true,
      };
    } catch (error) {
      const details =
        error instanceof HttpException
          ? error.getResponse()
          : { message: 'Workflow step failed' };
      throw new HttpException(
        {
          stage,
          team: team.team,
          postId,
          published,
          completedBeforeFailure: published
            ? ['generate', 'create', 'images', 'update', 'publish']
            : undefined,
          error: details,
          message:
            'Workflow stopped; completed external operations were not rolled back. Do not retry blindly.',
        },
        error instanceof HttpException ? error.getStatus() : 502,
      );
    }
  }
}
