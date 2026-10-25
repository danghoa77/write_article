import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentConfigService } from './content-config.service.js';
import { ContentHttpService } from './content-http.service.js';
import type { TextProvider } from './content.model.js';

@Injectable()
export class ContentAiService {
  constructor(
    private readonly config: ContentConfigService,
    private readonly http: ContentHttpService,
  ) {}

  preflight(provider: TextProvider = 'gemini') {
    if (!['gpt', 'gemini'].includes(provider))
      throw new BadRequestException('textProvider must be gpt or gemini');
    this.config.key(provider === 'gpt' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY');
    if (provider === 'gpt') this.config.key('OPENAI_MODEL');
  }

  async text(
    prompt: string,
    provider: TextProvider = 'gemini',
    schema?: Record<string, unknown>,
  ): Promise<string> {
    this.preflight(provider);
    let text: string | undefined;
    if (provider === 'gpt') {
      const result = await this.http.json(
        'https://api.openai.com/v1/responses',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.key('OPENAI_API_KEY')}`,
          },
          body: JSON.stringify({
            model: this.config.key('OPENAI_MODEL'),
            store: false,
            input: prompt,
            ...(schema
              ? {
                  text: {
                    format: {
                      type: 'json_schema',
                      name: 'story_analysis',
                      strict: true,
                      schema,
                    },
                  },
                }
              : {}),
          }),
        },
      );
      if (result.status === 'incomplete' || result.error)
        throw new UnprocessableEntityException('GPT response incomplete');
      text = result.output
        ?.filter((item: any) => item.type === 'message')
        .flatMap((item: any) => item.content ?? [])
        .filter((part: any) => part.type === 'output_text')
        .map((part: any) => part.text)
        .join('');
    } else {
      const model =
        (this.config.value?.('GEMINI_MODEL') ?? process.env.GEMINI_MODEL) ||
        'gemini-3.5-flash-lite';
      const result = await this.http.json(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': this.config.key('GEMINI_API_KEY'),
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            ...(schema
              ? {
                  generationConfig: {
                    responseMimeType: 'application/json',
                    responseJsonSchema: schema,
                  },
                }
              : {}),
          }),
        },
        5,
        5000,
      );
      text = result.candidates?.[0]?.content?.parts
        ?.filter((part: any) => !part.thought && typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('');
    }
    if (!text?.trim())
      throw new UnprocessableEntityException(
        `${provider} returned no text or refused the request`,
      );
    return text;
  }
}
