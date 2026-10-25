import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentConfigService } from './content-config.service.js';
import { ContentHttpService } from './content-http.service.js';
import type { SourceContent } from './content.model.js';

@Injectable()
export class TrelloService {
  constructor(
    private readonly config: ContentConfigService,
    private readonly http: ContentHttpService,
  ) {}

  private url(path: string, query: Record<string, string> = {}) {
    const url = new URL(`https://api.trello.com/1/${path}`);
    for (const [key, value] of Object.entries({
      ...query,
      key: this.config.key('TRELLO_API_KEY'),
      token: this.config.key('TRELLO_API_TOKEN'),
    })) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private id(value: string) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9]+$/.test(value))
      throw new BadRequestException('invalid Trello ID');
    return value;
  }

  async source(listId?: string): Promise<SourceContent> {
    const settings = this.config.defaults().trello;
    const cards = await this.http.json(
      this.url(`lists/${this.id(listId ?? settings.listId)}/cards`, {
        fields: settings.fields,
        limit: String(settings.limit),
      }),
    );
    const card = cards?.[0];
    if (!card?.id)
      throw new UnprocessableEntityException('Trello list has no source card');
    const actions = await this.http.json(
      this.url(`cards/${this.id(card.id)}/actions`, { filter: 'commentCard' }),
    );
    const action = actions?.[0];
    if (typeof action?.data?.text !== 'string' || !action.data.text.trim()) {
      throw new UnprocessableEntityException(
        'Source card has no content comment',
      );
    }
    return {
      cardId: card.id,
      caption: action.data.card?.name ?? card.name,
      content: action.data.text,
    };
  }

  async comment(cardId: string, text: string) {
    // Trello node cardComment defaults to adding a comment using text query param.
    return this.http.json(
      this.url(`cards/${this.id(cardId)}/actions/comments`, { text }),
      { method: 'POST' },
    );
  }
}
