import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { ContentTeam } from './content.model.js';

@Injectable()
export class ContentConfigService {
  private readonly context = new AsyncLocalStorage<{
    values: Record<string, string>;
    health: Record<
      string,
      { status: string; fingerprint: string; updatedAt: string }
    >;
  }>();
  value(name: string) {
    const values = this.context.getStore()?.values;
    return values && name in values ? values[name] : process.env[name];
  }
  withValues<T>(
    values: Record<string, string>,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.context.run({ values, health: {} }, work);
  }
  observations() {
    return this.context.getStore()?.health ?? {};
  }
  fingerprint(provider: string, values?: Record<string, string>) {
    const names: Record<string, string[]> = {
      gemini: ['GEMINI_API_KEY'],
      gpt: ['OPENAI_API_KEY'],
      tavily: ['TAVILY_API_KEY'],
      serper: ['SERPER_API_KEY'],
      trello: ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'],
    };
    return createHash('sha256')
      .update(
        (names[provider] ?? [])
          .map((name) =>
            values && name in values ? values[name] : (this.value(name) ?? ''),
          )
          .join('\0'),
      )
      .digest('hex');
  }
  observe(provider: string, status: string) {
    const context = this.context.getStore();
    if (!context) return;
    const priorities: Record<string, number> = {
      ready: 0,
      rate_limit: 1,
      invalid: 2,
      quota: 3,
    };
    const old = context.health[provider];
    if (!old || priorities[status] >= priorities[old.status])
      context.health[provider] = {
        status,
        fingerprint: this.fingerprint(provider),
        updatedAt: new Date().toISOString(),
      };
  }
  private read(file: string): string {
    return readFileSync(join(__dirname, 'config', file), 'utf8');
  }

  defaults() {
    const original = this.read('rewrite-prompt.md').trimEnd();
    const normalized = original.replace(/\r\n/g, '\n');
    return {
      teams: JSON.parse(this.read('teams.json')) as ContentTeam[],
      prompt: original,
      pipelinePolicy: this.read('pipeline-policy.md').trimEnd(),
      contextWriterPolicy: this.read('context-writer-policy.md').trimEnd(),
      pipelinePrompts: {
        contextAnalysis: this.read('context-analyzer.md').trimEnd(),
        rewrite: original,
        rules: normalized
          .slice(
            normalized.indexOf('\nRules\n') + 7,
            normalized.lastIndexOf('\nOutput\n'),
          )
          .trim(),
        analysis: this.read('character-analysis.md').trimEnd(),
        writer: this.read('article-writer.md').trimEnd(),
        characterKnowledge: this.read('character-knowledge.md').trimEnd(),
      },
      trello: {
        ...JSON.parse(this.read('trello.json')),
        listId:
          process.env.TRELLO_LIST_ID ||
          JSON.parse(this.read('trello.json')).listId,
      },
    };
  }

  key(name: string): string {
    const value = this.value(name);
    if (!value?.trim())
      throw new ServiceUnavailableException(`missing ${name}`);
    return value;
  }

  credentialStatus() {
    return Object.fromEntries(
      [
        'GEMINI_API_KEY',
        'OPENAI_API_KEY',
        'SERPER_API_KEY',
        'TAVILY_API_KEY',
        'TRELLO_API_KEY',
        'TRELLO_API_TOKEN',
      ].map((key) => [key, Boolean(this.value(key)?.trim())]),
    );
  }
}
