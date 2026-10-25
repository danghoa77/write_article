import { BadRequestException } from '@nestjs/common';

export const PROMPT_STAGES = [
  'analysis',
  'characterKnowledge',
  'writer',
] as const;
export type PromptStage = (typeof PROMPT_STAGES)[number];
export type PromptOverrides = Partial<Record<PromptStage, string>>;

export function validatePromptOverrides(
  value: unknown,
): asserts value is PromptOverrides {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('prompts must be an object');
  for (const [stage, text] of Object.entries(value)) {
    if (!PROMPT_STAGES.includes(stage as PromptStage))
      throw new BadRequestException(`Unknown prompt stage: ${stage}`);
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      Buffer.byteLength(text, 'utf8') > 120_000
    ) {
      throw new BadRequestException(
        `${stage}: prompt must be nonempty text, at most 120000 UTF-8 bytes`,
      );
    }
  }
}
