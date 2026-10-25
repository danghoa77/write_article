import {
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CharacterSelectionService } from './character-selection.service.js';
import { ContentAiService } from './content-ai.service.js';
import { ContentConfigService } from './content-config.service.js';
import type {
  BatchContentBody,
  GenerateContentBody,
  PreparedContent,
  StoryAnalysis,
  TeamPlan,
} from './content.model.js';
import { formatContent } from './transforms/format-content.js';

@Injectable()
export class ContentGenerationService {
  constructor(
    private readonly selector: CharacterSelectionService,
    private readonly ai: ContentAiService,
    private readonly config: ContentConfigService,
  ) {}

  async batch(body: BatchContentBody) {
    const {
      analysis,
      plans,
      failures = [],
      planIndexes = plans.map((_, index) => index),
    } = await this.selector.plan(
      body,
      Array.isArray(body?.teams) && body.teams.length > 1,
    );
    const results: any[] = new Array(body.teams.length);
    for (const failure of failures) {
      const team = body.teams[failure.index];
      results[failure.index] = {
        team: team.team,
        categories: team.categories,
        success: false,
        stage: 'plan',
        statusCode: failure.statusCode,
        error: failure.error,
      };
    }
    let next = 0;
    const workers = Array.from(
      { length: Math.min(body.concurrency ?? 2, plans.length) },
      async () => {
        while (next < plans.length) {
          const planIndex = next++;
          const index = planIndexes[planIndex];
          const plan = plans[planIndex];
          try {
            results[index] = {
              team: plan.team.team,
              categories: plan.team.categories,
              success: true,
              article: await this.write(body, analysis, plan),
            };
          } catch (error) {
            results[index] = {
              team: plan.team.team,
              categories: plan.team.categories,
              success: false,
              statusCode:
                error instanceof HttpException ? error.getStatus() : 502,
              error:
                error instanceof HttpException
                  ? error.getResponse()
                  : { message: 'Writing failed' },
            };
          }
        }
      },
    );
    await Promise.all(workers);
    return {
      success: results.every((item) => item.success),
      textProvider: body.textProvider ?? 'gemini',
      analysis,
      plans,
      results,
    };
  }

  async single(body: GenerateContentBody): Promise<PreparedContent> {
    const batch = await this.batch({ ...body, teams: [body?.team] });
    const result = batch.results[0];
    if (!result.success)
      throw new HttpException(result.error, result.statusCode);
    return result.article;
  }

  private async write(
    body: BatchContentBody,
    analysis: StoryAnalysis,
    plan: TeamPlan,
  ): Promise<PreparedContent> {
    const instructions =
      body.prompts?.writer ?? this.config.defaults().pipelinePrompts.writer;
    // Source data, character map and optional style are kept out of template evaluation.
    const prompt =
      instructions +
      '\nOUTPUT CONTRACT: Return only Title: <one line>\\nCaption: <one line>\\nContent:\\n<HTML article with <!--IMAGE: query--> placeholders>. No JSON or extra sections. Follow lockedCharacterMap consistently.\n' +
      '\nCONTEXT JSON:\n' +
      JSON.stringify({
        source: { caption: body.caption, content: body.content },
        targetTeam: {
          sport: plan.team.sport,
          team: plan.team.team,
          categories: plan.team.categories,
        },
        story: analysis,
        lockedCharacterMap: plan.mappings,
        stylePreferences: body.prompt ?? '',
      });
    const text = await this.ai.text(prompt, body.textProvider);
    const formatted = await formatContent([
      {
        json: {
          candidates: [{ content: { parts: [{ text }] } }],
          'Sport Team': `${plan.team.sport} ${plan.team.team}`,
        },
      },
    ]);
    const article = formatted[0].json as PreparedContent;
    if (
      article.title === 'No Title' ||
      article.caption === 'No Caption' ||
      article.content === 'No Content'
    ) {
      throw new UnprocessableEntityException(
        'Writer output missing Title, Caption or Content',
      );
    }
    const contains = (text: string, name: string) =>
      text.toLowerCase().includes(name.toLowerCase());
    const outputText = `${article.title} ${article.caption} ${article.content}`;
    const allowed = new Set(
      plan.mappings.map((item) => item.targetName.toLowerCase()),
    );
    const rosterNames = [
      ...plan.team.players,
      ...(plan.team.personnel ?? []).map((item) => item.name),
      ...(plan.team.headCoach ? [plan.team.headCoach] : []),
    ];
    for (const name of rosterNames) {
      if (!allowed.has(name.toLowerCase()) && contains(outputText, name)) {
        throw new UnprocessableEntityException(
          'Writer introduced an unselected roster member',
        );
      }
    }
    for (const mapping of plan.mappings.filter(
      (item) => item.source.identity === 'fictional',
    )) {
      if (
        !contains(outputText, mapping.source.name) ||
        (mapping.source.inCaption &&
          !contains(article.caption, mapping.source.name))
      ) {
        throw new UnprocessableEntityException(
          'Writer changed a preserved fictional character',
        );
      }
    }
    for (const mapping of plan.mappings.filter(
      (item) => item.action === 'replace',
    )) {
      if (
        mapping.source.inCaption &&
        !contains(article.caption, mapping.targetName)
      ) {
        throw new UnprocessableEntityException(
          'Caption does not follow selected character mapping',
        );
      }
      if (
        !mapping.source.inCaption &&
        contains(article.caption, mapping.targetName)
      ) {
        throw new UnprocessableEntityException(
          'Writer introduced a named character into an anonymous caption',
        );
      }
      if (
        mapping.source.name.toLowerCase() !==
          mapping.targetName.toLowerCase() &&
        contains(
          `${article.title} ${article.caption} ${article.content}`,
          mapping.source.name,
        )
      ) {
        throw new UnprocessableEntityException(
          'Writer retained an original name that must be replaced',
        );
      }
    }
    return article;
  }
}
