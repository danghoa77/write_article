import type { SourceCharacter, StoryScan } from './content.model.js';

// Compare source quotations across HTML, Markdown, typography and Unicode forms.
// Words must still be contiguous: this never accepts a paraphrase or outside fact.
export function evidenceText(value: string) {
  const entities: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    lt: '<',
    gt: '>',
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    ndash: '-',
    mdash: '-',
  };
  return value
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity: string) => {
      if (entity.startsWith('#')) {
        const code =
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }
      return entities[entity.toLowerCase()] ?? all;
    })
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function grounded(source: string, excerpt: string) {
  const quote = evidenceText(excerpt);
  return !!quote && ` ${evidenceText(source)} `.includes(` ${quote} `);
}

export const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['storyType', 'identityCase', 'eventSpecific', 'reason'],
  properties: {
    storyType: {
      type: 'string',
      enum: ['sad_news', 'lifestyle', 'match', 'recognition', 'other'],
    },
    identityCase: {
      type: 'string',
      enum: ['none', 'fictional', 'real', 'mixed', 'uncertain'],
    },
    eventSpecific: { type: 'string', enum: ['none', 'personal', 'match'] },
    reason: { type: 'string' },
  },
};

export const SCAN_CONTRACT = `
SCAN CONTRACT: First scan the caption and content, then extract characters, then identify the actual requirements for choosing people. Return scan with storyType (sad_news, lifestyle, match, recognition, other), identityCase (none, fictional, real, mixed, uncertain), eventSpecific (personal, match, none), and a short factual reason in Vietnamese.
Personal death, bereavement, serious illness, marriage/divorce and a specific family event are eventSpecific=personal. Actual match scores/results/performances are eventSpecific=match. General leadership, recognition, parenting background or sporting prominence alone use none. A roster establishes eligibility, never that a particular event happened.
An unnamed person stays unnamed; copy their description verbatim. A fictional name stays fictional. A named actual athlete remains real even in a fictional event. Missing biographical details do not make a named person fictional. Treat an unestablished identity as unspecified and preserve it. Do not infer identity from tone alone.
Use short CONTIGUOUS source quotations for evidence. Copy each name/anonymous description verbatim from source. No ellipses, assembled quotations, translated evidence or explanations inside evidence. Required traits must be necessary to the story, not incidental age/statistics. Mark references separately from essential acting characters.
`;

export function completeScan(
  source: string,
  people: SourceCharacter[],
  supplied?: StoryScan,
): StoryScan {
  const types = new Set(people.map((p) => p.identity));
  const identityCase: StoryScan['identityCase'] = !people.length
    ? 'none'
    : types.size > 1
      ? 'mixed'
      : types.has('real')
        ? 'real'
        : types.has('fictional')
          ? 'fictional'
          : 'uncertain';
  // Deterministic floor for sensitive events, including older saved analysis prompts.
  const personal =
    /\b(?:passed away|dies|died|death|dead|bereave\w*|grieving|cancer|diagnosed|divorce\w*|wedding|miscarriage)\b/i.test(
      source,
    );
  return {
    storyType: supplied?.storyType ?? (personal ? 'sad_news' : 'other'),
    identityCase,
    eventSpecific: personal ? 'personal' : (supplied?.eventSpecific ?? 'none'),
    reason:
      supplied?.reason ??
      'Phân loại theo nhân vật và dữ kiện có trong nội dung nguồn.',
  };
}
