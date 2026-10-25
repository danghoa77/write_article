import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentConfigService } from './content-config.service.js';
import { ContentHttpService } from './content-http.service.js';
import type { GenerateContentBody, PreparedContent } from './content.model.js';
import { formatContent } from './transforms/format-content.js';
import { buildImageQueries } from './transforms/image-queries.js';
import { rankImages } from './transforms/rank-images.js';
import { insertImages } from './transforms/insert-images.js';
import { chooseThumbnail } from './transforms/choose-thumbnail.js';
import { rankTavilyImages } from './transforms/rank-tavily-images.js';
import { chooseTavilyThumbnail } from './transforms/choose-tavily-thumbnail.js';

@Injectable()
export class ContentService {
  private readonly history: Record<string, unknown> = {};
  constructor(
    private readonly config: ContentConfigService,
    private readonly http: ContentHttpService,
  ) {}

  validateTeam(team: GenerateContentBody['team']) {
    if (
      !team ||
      typeof team.sport !== 'string' ||
      typeof team.team !== 'string' ||
      !Array.isArray(team.players) ||
      !team.players.every((player) => typeof player === 'string') ||
      !Array.isArray(team.categories) ||
      !team.categories.every(Number.isInteger) ||
      (team.headCoach != null && typeof team.headCoach !== 'string') ||
      (team.captain != null && typeof team.captain !== 'string')
    ) {
      throw new BadRequestException('Invalid team, players or categories');
    }
  }

  renderPrompt(body: GenerateContentBody, now = new Date()) {
    this.validateTeam(body?.team);
    if (
      typeof body.caption !== 'string' ||
      typeof body.content !== 'string' ||
      (body.prompt !== undefined && typeof body.prompt !== 'string')
    ) {
      throw new BadRequestException(
        'caption, content and optional prompt must be strings',
      );
    }
    const team = body.team;
    const values: Record<string, string> = {
      date: now.toISOString().split('T')[0],
      year: String(now.getFullYear()),
      sportTeam: `${team.sport} ${team.team}`,
      caption: body.caption,
      content: body.content,
      headCoachLine: team.headCoach
        ? `- Head Coach: ${team.headCoach}`
        : '- Head Coach: (not provided — use a generic reference per Rule 20)',
      captainLine: team.captain
        ? `- Captain: ${team.captain}`
        : '- Captain: (not provided — use a generic reference per Rule 20)',
      playersLine: team.players.length
        ? `- Known current players (candidate pool ONLY for currently-active-character stories): ${team.players.join(', ')}`
        : '- Known current players: (none provided — select a plausible current player per Rule 8, but do not invent a name)',
    };
    // Callback replacement keeps $&, backticks and template-like source content literal.
    return (body.prompt ?? this.config.defaults().prompt).replace(
      /\{\{(\w+)\}\}/g,
      (marker, name: string) => values[name] ?? marker,
    );
  }

  async generate(body: GenerateContentBody): Promise<PreparedContent> {
    const prompt = this.renderPrompt(body);
    const data = await this.http.json(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': this.config.key('GEMINI_API_KEY'),
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
      5,
      5000,
    );
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw new UnprocessableEntityException('Gemini returned no article text');
    }
    const items = await formatContent([
      {
        json: { ...data, 'Sport Team': `${body.team.sport} ${body.team.team}` },
      },
    ]);
    const article = items[0].json as PreparedContent;
    if (
      article.title === 'No Title' ||
      article.caption === 'No Caption' ||
      article.content === 'No Content'
    ) {
      throw new UnprocessableEntityException(
        'Gemini response missing Title, Caption or Content',
      );
    }
    return article;
  }

  async searchImages(query: string, provider: 'serper' | 'tavily') {
    if (typeof query !== 'string' || !query.trim())
      throw new BadRequestException('missing image query');
    if (provider === 'tavily') {
      return this.http.json('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.config.key('TAVILY_API_KEY'),
          query,
          search_depth: 'advanced',
          include_images: true,
          max_results: 4,
        }),
      });
    }
    if (provider !== 'serper')
      throw new BadRequestException('imageProvider must be serper or tavily');
    return this.http.json('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': this.config.key('SERPER_API_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        type: 'images',
        num: 15,
        engine: 'google',
      }),
    });
  }

  async images(
    article: PreparedContent,
    provider: 'serper' | 'tavily',
  ): Promise<PreparedContent> {
    if (
      !article ||
      !['title', 'caption', 'content', 'sportTeam'].every(
        (key) => typeof (article as any)[key] === 'string',
      )
    ) {
      throw new BadRequestException(
        'missing article title, caption, content or sportTeam',
      );
    }
    if (!['serper', 'tavily'].includes(provider))
      throw new BadRequestException('imageProvider must be serper or tavily');
    const queries = await buildImageQueries([{ json: article }]);
    if (!queries.length || queries.some((q: any) => !q.json.query)) {
      throw new UnprocessableEntityException(
        'Article has no usable IMAGE placeholders',
      );
    }
    const searches: any[] = [];
    for (const query of queries)
      searches.push({
        json: await this.searchImages(query.json.query, provider),
      });
    const thumbnails = await (
      provider === 'tavily' ? rankTavilyImages : rankImages
    )(searches, { history: this.history });
    const contentSearches =
      provider === 'serper'
        ? searches.map((item) => ({
            json: {
              ...item.json,
              images: (item.json.images ?? [])
                .map((image: any) =>
                  typeof image === 'string' ? image : image.imageUrl,
                )
                .filter(Boolean),
            },
          }))
        : searches;
    const converted = await insertImages(contentSearches, {
      nodes: { getInfoForSearch1: queries },
    });
    const helpers = {
      httpRequest: (options: any) => this.verifyImage(options),
    };
    const chooser =
      provider === 'tavily' ? chooseTavilyThumbnail : chooseThumbnail;
    const selected = await chooser.call(
      { helpers },
      [...converted, ...thumbnails],
      { history: this.history },
    );
    return { ...selected[0].json, sportTeam: article.sportTeam };
  }

  private async verifyImage(options: {
    url: string;
    headers: Record<string, string>;
  }) {
    let url = options.url;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const parsed = new URL(url);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(
          parsed.hostname,
        )
      ) {
        throw new Error('Invalid image host');
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: options.headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(7000),
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has('location')
      ) {
        url = new URL(response.headers.get('location')!, url).toString();
        await response.body?.cancel();
        continue;
      }
      // Read only the bytes needed for the workflow's >=800-byte accessibility check.
      const reader = response.body?.getReader();
      let length = 0;
      if (reader) {
        try {
          while (length < 800) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.length;
          }
        } finally {
          await reader.cancel();
        }
      }
      return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: { length },
      };
    }
    throw new Error('Too many image redirects');
  }
}
