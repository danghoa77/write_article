import type { PromptOverrides, PromptStage } from './prompt.types.js';

export const PROMPT_VERSION = 'n8n-rotation-v5';
export const RULE_IDS = [
  '0',
  '1',
  '1C',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7A',
  '7B',
  '7C',
  '8',
  '8A',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
];
export type PipelineStage = Exclude<PromptStage, 'rules'>;
export function composePrompt(
  stage: PipelineStage,
  defaults: {
    pipelinePrompts: Record<PromptStage, string>;
    pipelinePolicy?: string;
  },
  overrides: PromptOverrides = {},
  now = new Date(),
) {
  const prompts = { ...defaults.pipelinePrompts, ...overrides };
  return `${prompts[stage]}\n\nN8N RULES — FULL SOURCE:\n${prompts.rules}\n\nCONFIRMED WEB POLICY — PRIORITY AND EXECUTION:\n${defaults.pipelinePolicy ?? ''}\n\nCONTEXT DATE: ${now.toISOString().slice(0, 10)}. Current year: ${now.getUTCFullYear()}. Prompt version: ${PROMPT_VERSION}.\n`;
}
