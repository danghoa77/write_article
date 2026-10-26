const { test } = require('node:test');
const a = require('node:assert/strict');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const {
  composePrompt,
  PROMPT_VERSION,
  RULE_IDS,
} = require('../dist/modules/content/prompt-composer.js');
const {
  editorialFindings,
} = require('../dist/modules/content/editorial-review.js');
const {
  CharacterSelectionService,
} = require('../dist/modules/content/character-selection.service.js');
const {
  PromptSettingsService,
} = require('../dist/modules/content/prompt-settings.service.js');
const config = new ContentConfigService();

test('all original rule groups and detailed editorial examples reach every stage', () => {
  const defaults = config.defaults();
  a.equal(RULE_IDS.length, 25);
  for (const stage of ['analysis', 'characterKnowledge', 'writer']) {
    const text = composePrompt(
      stage,
      defaults,
      {},
      new Date('2026-10-25T12:00:00Z'),
    );
    for (const id of RULE_IDS)
      a.match(text, new RegExp('(?:^|\\n)' + id + '\\. ', 'm'));
    for (const detail of [
      'Quote Adaptation',
      'Adapt family references for College Athletes',
      'posterized',
      'pick-six',
      'ROLE-CATEGORY PRESERVATION',
      'Fiction Disclosure',
      'Absolute Emotional Fidelity',
    ])
      a.ok(text.includes(detail), `${stage} lost ${detail}`);
    a.ok(text.includes('2026-10-25'));
    a.ok(text.includes('CONFIRMED WEB POLICY'));
  }
});

test('shared edits apply to all stages and priority policy is visible after the original rules', () => {
  const defaults = config.defaults();
  for (const stage of ['analysis', 'characterKnowledge', 'writer']) {
    const prompt = composePrompt(stage, defaults, {
      rules: 'MY SHARED RULES',
      [stage]: 'MY STAGE',
    });
    a.ok(prompt.startsWith('MY STAGE'));
    a.ok(prompt.includes('MY SHARED RULES'));
    a.ok(
      prompt.indexOf('MY SHARED RULES') <
        prompt.indexOf(defaults.pipelinePolicy),
    );
  }
});

const source = {
  id: 'actor',
  name: 'Original Player',
  identity: 'real',
  inCaption: true,
  role: 'player',
  status: 'active',
  careerStage: 'any',
  importance: 'any',
  requiredTraits: ['parent'],
  evidence: 'Original Player',
  narrativeRole: 'primary',
  affiliation: 'source_team',
};
const team = {
  sport: 'AFL',
  team: 'Example Club',
  players: ['Current Player'],
  headCoach: 'Current Coach',
  categories: [44],
};
const profile = (name, role, traits = []) => ({
  name,
  role,
  status: 'active',
  careerStage: 'unknown',
  importance: 'unknown',
  traits,
});
const story = {
  summary: 'Family life',
  scan: {
    storyType: 'lifestyle',
    identityCase: 'real',
    eventSpecific: 'none',
    reason: 'Parenthood background.',
  },
  characters: [source],
};
const selector = () =>
  new CharacterSelectionService(
    config,
    { preflight() {} },
    { validateTeam() {} },
  );

test('Rule 1C uses a compatible supplied coach only after no compatible player exists', () => {
  const enriched = {
    ...team,
    personnel: [profile('Current Coach', 'coach', ['parent'])],
  };
  const plan = selector().select(story, enriched, [], {
    allowRoleFallback: true,
  });
  a.equal(plan.mappings[0].targetName, 'Current Coach');
  a.equal(plan.mappings[0].profile.role, 'coach');
  a.equal(plan.mappings[0].roleException, 'life_event');
  const sameRole = selector().select(
    story,
    {
      ...enriched,
      personnel: [
        ...enriched.personnel,
        profile('Current Player', 'player', ['parent']),
      ],
    },
    [],
    { allowRoleFallback: true },
  );
  a.equal(sameRole.mappings[0].targetName, 'Current Player');
  a.equal(sameRole.mappings[0].roleException, undefined);
  a.throws(
    () =>
      selector().select(
        { ...story, scan: { ...story.scan, storyType: 'match' } },
        enriched,
        [],
        { allowRoleFallback: true },
      ),
    /compatible|tương thích/,
  );
});

test('Rule 20 falls back to an accurate generic description and keeps former framing', () => {
  const plan = selector().select(
    { ...story, characters: [{ ...source, status: 'former' }] },
    team,
    [],
    { allowGenericFallback: true },
  );
  a.equal(plan.mappings[0].action, 'generalize');
  a.match(plan.mappings[0].targetName, /former player/);
  a.equal(plan.mappings[0].profile, undefined);
});

test('explicit fatherhood requires a parent even if the model omits the constraint', async () => {
  const ai = {
    preflight() {},
    text: async () =>
      JSON.stringify({
        ...story,
        characters: [
          { ...source, requiredTraits: [], evidence: 'Original Player' },
        ],
      }),
  };
  const service = new CharacterSelectionService(config, ai, {
    validateTeam() {},
  });
  const result = await service.analyze({
    caption: 'Original Player reflects on fatherhood.',
    content: 'Original Player explains life with his children.',
    teams: [team],
  });
  a.ok(result.characters[0].requiredTraits.includes('parent'));
  const plan = service.select(result, {
    ...team,
    personnel: [profile('Current Player', 'player', ['father'])],
  });
  a.equal(plan.mappings[0].targetName, 'Current Player');
});

test('invalid model biography gets one repair while the imported role stays authoritative', async () => {
  let lookups = 0;
  const ai = {
    preflight() {},
    text: async (prompt, provider, schema) => {
      if (!schema.properties.people) return JSON.stringify(story);
      lookups++;
      if (lookups === 2) a.match(prompt, /CHARACTER_KNOWLEDGE_CONFLICT/);
      return JSON.stringify({
        people: [
          {
            ...profile('Current Player', lookups === 1 ? 'coach' : 'player', [
              'parent',
            ]),
            confidence: 'high',
            knowledgeNote: 'Synthetic parent profile.',
            position: '',
          },
        ],
        recommendations: [],
      });
    },
  };
  const service = new CharacterSelectionService(config, ai, {
    validateTeam() {},
  });
  const result = await service.plan({
    caption: 'Original Player reflects on fatherhood.',
    content: 'Original Player and his family.',
    teams: [team],
  });
  a.equal(lookups, 2);
  a.equal(result.plans[0].mappings[0].profile.role, 'player');
});

test('Rule 8A balances only equally suitable compatible candidates using RAM history', () => {
  const service = selector();
  const simple = { ...source, requiredTraits: [], importance: 'star' };
  const choices = {
    ...team,
    players: ['One', 'Two'],
    personnel: ['One', 'Two'].map((name) => ({
      ...profile(name, 'player'),
      importance: 'star',
    })),
  };
  const ranked = ['One', 'Two'].map((targetName) => ({
    sourceCharacterId: source.id,
    targetName,
    score: 90,
    reason: 'Equal narrative fit',
    confidence: 'high',
  }));
  const first = service.select(
    { ...story, characters: [simple] },
    choices,
    ranked,
  );
  service.recordSelection(first);
  const second = service.select(
    { ...story, characters: [simple] },
    choices,
    ranked,
  );
  a.notEqual(first.mappings[0].targetName, second.mappings[0].targetName);
  const stronger = service.select(
    { ...story, characters: [simple] },
    choices,
    ranked.map((item) => ({
      ...item,
      score: item.targetName === first.mappings[0].targetName ? 99 : 90,
    })),
  );
  a.equal(stronger.mappings[0].targetName, first.mappings[0].targetName);
});

test('editorial review catches collapsed paragraphs, wrong image counts and missing prefix', () => {
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) =>
      `Example Club paragraph ${i} explains the central story and preserves its emotional purpose with enough supporting detail for supporters to follow the entire narrative without losing the important relationship between the team and its community.`,
  );
  const source = paragraphs.join('\n\n');
  const good = {
    title: 'Story',
    caption: 'FICTION: Example Club story',
    content: paragraphs
      .map(
        (text) =>
          `<p>${text}</p><!--IMAGE: Example Club community supporters-->`,
      )
      .join(''),
    sportTeam: 'AFL Example Club',
  };
  a.deepEqual(editorialFindings(good, source), []);
  const bad = editorialFindings(
    {
      ...good,
      caption: 'Unlabelled news',
      content: '<p>Short summary.</p><!--IMAGE: Example Club 2026-->',
    },
    source,
  ).join(' ');
  for (const rule of ['Rule 15', 'Rules 4/5', 'Rules 4/12', 'Rule 14'])
    a.ok(bad.includes(rule));
});

test('Firebase canonical sync archives originals, bumps revision and shares exact effective prompts', async () => {
  const data = new Map();
  const ref = (path) => ({
    path,
    collection: (name) => ref(path + '/' + name),
    doc: (name) => ref(path + '/' + name),
    get: async () => ({ data: () => structuredClone(data.get(path)) }),
  });
  const db = {
    collection: (name) => ref(name),
    runTransaction: async (work) =>
      work({
        get: (r) => r.get(),
        set: (r, value) => data.set(r.path, structuredClone(value)),
      }),
  };
  const service = new PromptSettingsService({ database: () => db }, config);
  const path = 'users/test/settings/prompts';
  data.set(path, {
    revision: 1,
    prompts: { writer: 'Original custom writer' },
  });
  const result = await service.synchronizeCanonical('test', 1);
  a.equal(result.revision, 2);
  a.equal(result.version, PROMPT_VERSION);
  a.equal(result.needsSync, false);
  a.equal(
    data.get(path + '/versions/before-' + PROMPT_VERSION + '-r1').prompts
      .writer,
    'Original custom writer',
  );
  a.deepEqual(result.prompts, { rewrite: config.defaults().prompt });
  a.equal('effectivePrompts' in result, false);
  const repeated = await service.get('test');
  a.equal(repeated.revision, 2);
});
