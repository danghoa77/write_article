const { test, afterEach } = require('node:test');
const a = require('node:assert/strict');
const {
  ContentAiService,
} = require('../dist/modules/content/content-ai.service.js');
const {
  CharacterSelectionService,
} = require('../dist/modules/content/character-selection.service.js');
const {
  ContentGenerationService,
} = require('../dist/modules/content/content-generation.service.js');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const {
  ContentHttpService,
} = require('../dist/modules/content/content-http.service.js');
const originalFetch = global.fetch;
afterEach(() => (global.fetch = originalFetch));
const config = {
  defaults: () => new ContentConfigService().defaults(),
  key: (name) => 'test-' + name,
};
const team = {
  sport: 'AFL',
  team: 'Target Team',
  categories: [44],
  players: ['Target One', 'Target Two'],
  headCoach: 'Target Coach',
};
const source = {
  id: 'p1',
  name: 'Original Star',
  identity: 'real',
  inCaption: true,
  role: 'player',
  status: 'active',
  careerStage: 'any',
  importance: 'any',
  requiredTraits: [],
  evidence: 'Original Star',
};
const story = { summary: 'Original Star celebrates', characters: [source] };
const body = {
  caption: 'Original Star celebrates',
  content: 'Original Star celebrates with fans.',
  teams: [team],
  textProvider: 'gemini',
};
const selector = (ai) =>
  new CharacterSelectionService(config, ai, { validateTeam: () => {} });
const storyAI = {
  preflight: () => {},
  text: async () => JSON.stringify(story),
};
function output(name = 'Target One') {
  return `Title: A Team Celebration\nCaption: FICTION: ${name} celebrates\nContent:\n<p>${name} celebrates with fans.</p><!--IMAGE: ${name} celebrates-->`;
}

test('named real characters map only to compatible input-team candidates', () => {
  const plan = selector(storyAI).select(story, team);
  a.equal(plan.mappings[0].targetName, 'Target One');
  a.equal(plan.mappings[0].action, 'replace');
});
test('no characters yields empty mapping without inventing a player', () => {
  a.deepEqual(
    selector(storyAI).select({ summary: 'A team story', characters: [] }, team)
      .mappings,
    [],
  );
});
test('fictional or unspecified identities are preserved instead of cast as real players', () => {
  for (const identity of ['fictional', 'unspecified']) {
    const plan = selector(storyAI).select(
      { summary: 'Story', characters: [{ ...source, identity }] },
      team,
    );
    a.equal(plan.mappings[0].targetName, 'Original Star');
    a.equal(plan.mappings[0].action, 'preserve');
  }
});
test('coach remains coach and former player requires explicit former profile', () => {
  a.equal(
    selector(storyAI).select(
      { summary: 'Story', characters: [{ ...source, role: 'coach' }] },
      team,
    ).mappings[0].targetName,
    'Target Coach',
  );
  a.throws(
    () =>
      selector(storyAI).select(
        { summary: 'Story', characters: [{ ...source, status: 'former' }] },
        team,
      ),
    /Không chọn được/,
  );
  const enriched = {
    ...team,
    personnel: [
      {
        name: 'Former Legend',
        role: 'player',
        status: 'former',
        careerStage: 'veteran',
        importance: 'star',
        traits: [],
      },
    ],
  };
  a.equal(
    selector(storyAI).select(
      { summary: 'Story', characters: [{ ...source, status: 'former' }] },
      enriched,
    ).mappings[0].targetName,
    'Former Legend',
  );
});
test('private-life or career constraints never inferred from bare player names', () => {
  const constrained = {
    ...source,
    careerStage: 'veteran',
    requiredTraits: ['parent'],
  };
  a.throws(
    () =>
      selector(storyAI).select(
        { summary: 'Story', characters: [constrained] },
        team,
      ),
    /Không chọn được/,
  );
  const enriched = {
    ...team,
    personnel: [
      {
        name: 'Target Two',
        role: 'player',
        status: 'active',
        careerStage: 'veteran',
        importance: 'supporting',
        traits: ['parent'],
      },
    ],
  };
  a.equal(
    selector(storyAI).select(
      { summary: 'Story', characters: [constrained] },
      enriched,
    ).mappings[0].targetName,
    'Target Two',
  );
});
test('two original people cannot collapse onto one target person', () => {
  const result = selector(storyAI).select(
    {
      summary: 'Story',
      characters: [source, { ...source, id: 'p2', name: 'Second Source' }],
    },
    team,
  );
  a.equal(new Set(result.mappings.map((x) => x.targetName)).size, 2);
});
test('source analysis is grounded in source evidence and computes caption membership', async () => {
  const ai = {
    preflight: () => {},
    text: async () =>
      JSON.stringify({
        ...story,
        characters: [{ ...source, inCaption: false }],
      }),
  };
  const result = await selector(ai).analyze(body);
  a.equal(result.characters[0].inCaption, true);
  await a.rejects(
    () =>
      selector({
        preflight: () => {},
        text: async () =>
          JSON.stringify({
            ...story,
            characters: [{ ...source, evidence: 'invented source quote' }],
          }),
      }).analyze(body),
    /unsupported character evidence/,
  );
});
test('GPT uses Responses API and strict JSON schema while writer output stays text', async () => {
  const calls = [];
  const ai = new ContentAiService(config, {
    json: async (url, init) => {
      calls.push([url, JSON.parse(init.body), init.headers]);
      return {
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '{}' }] },
        ],
      };
    },
  });
  await ai.text('Analyze', 'gpt', {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  });
  await ai.text('Write', 'gpt');
  a.equal(calls[0][0], 'https://api.openai.com/v1/responses');
  a.equal(calls[0][1].text.format.type, 'json_schema');
  a.equal(calls[0][1].text.format.strict, true);
  a.equal(calls[0][1].store, false);
  a.equal(calls[1][1].text, undefined);
  a.equal(calls[0][2].Authorization, 'Bearer test-OPENAI_API_KEY');
});
test('Gemini has schema for analysis only and preserves original default model', async () => {
  const calls = [];
  const ai = new ContentAiService(config, {
    json: async (url, init) => {
      calls.push([url, JSON.parse(init.body)]);
      return { candidates: [{ content: { parts: [{ text: '{}' }] } }] };
    },
  });
  await ai.text('Analyze', 'gemini', { type: 'object' });
  await ai.text('Write', 'gemini');
  a.ok(calls[0][0].includes('gemini-3.5-flash-lite'));
  a.equal(calls[0][1].generationConfig.responseMimeType, 'application/json');
  a.equal(calls[1][1].generationConfig, undefined);
});
test('GPT quota errors identify OPENAI_API_KEY and never auto-switch providers', async () => {
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    a.equal(url, 'https://api.openai.com/v1/responses');
    return new Response('{"error":{"code":"insufficient_quota"}}', {
      status: 429,
    });
  };
  await a.rejects(
    () =>
      new ContentAiService(config, new ContentHttpService()).text(
        'Write',
        'gpt',
      ),
    (e) => e.getResponse().apiKeyEnv === 'OPENAI_API_KEY',
  );
  a.equal(calls, 1);
});
test('multi-team source is analyzed once; same caption/content feeds separate locked maps', async () => {
  let analyses = 0;
  let writes = 0;
  const ai = {
    preflight: () => {},
    text: async (prompt, provider, schema) => {
      if (schema) {
        analyses++;
        return JSON.stringify(story);
      }
      writes++;
      const context = JSON.parse(prompt.split('\nCONTEXT JSON:\n')[1]);
      a.equal(context.source.caption, body.caption);
      return output(context.lockedCharacterMap[0].targetName);
    },
  };
  const second = {
    ...team,
    team: 'Second Team',
    players: ['Other Player'],
    headCoach: undefined,
  };
  const service = new ContentGenerationService(selector(ai), ai, config);
  const result = await service.batch({ ...body, teams: [team, second] });
  a.equal(analyses, 1);
  a.equal(writes, 2);
  a.equal(result.results[0].article.caption, 'FICTION: Target One celebrates');
  a.equal(
    result.results[1].article.caption,
    'FICTION: Other Player celebrates',
  );
  a.deepEqual(result.results[0].categories, [44]);
});
test('bounded writing concurrency and result order survive individual failures', async () => {
  let active = 0,
    max = 0;
  const teams = Array.from({ length: 5 }, (_, i) => ({
    ...team,
    team: 'Team ' + i,
  }));
  const ai = {
    text: async (prompt) => {
      const context = JSON.parse(prompt.split('\nCONTEXT JSON:\n')[1]);
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (context.targetTeam.team === 'Team 2') throw Error('one failure');
      return 'Title: Team Celebration\nCaption: FICTION: Fans celebrate\nContent:\n<p>Fans celebrate.</p>';
    },
  };
  const sel = {
    plan: async () => ({
      analysis: { summary: 'Story', characters: [] },
      plans: teams.map((team) => ({ team, mappings: [] })),
    }),
  };
  const result = await new ContentGenerationService(sel, ai, config).batch({
    ...body,
    teams,
    concurrency: 2,
  });
  a.equal(max, 2);
  a.equal(result.success, false);
  a.deepEqual(
    result.results.map((x) => x.team),
    teams.map((x) => x.team),
  );
  a.equal(result.results[2].success, false);
  a.equal(result.results[3].success, true);
});
test('writer may not introduce real roster names into an anonymous story', async () => {
  const ai = { text: async () => output('Target One') };
  const service = new ContentGenerationService(
    {
      plan: async () => ({
        analysis: { summary: 'Story', characters: [] },
        plans: [{ team, mappings: [] }],
      }),
    },
    ai,
    config,
  );
  const result = await service.batch(body);
  a.equal(result.success, false);
  a.match(result.results[0].error.message, /unselected roster/);
});
test('writer must preserve fictional identity and caption/content replacement consistency', async () => {
  const sel = {
    plan: async () => ({
      analysis: story,
      plans: [
        {
          team,
          mappings: [{ source, action: 'replace', targetName: 'Target One' }],
        },
      ],
    }),
  };
  const service = new ContentGenerationService(
    sel,
    { text: async () => output('Target Two') },
    config,
  );
  a.equal((await service.batch(body)).success, false);
  const fictional = { ...source, identity: 'fictional' };
  const preserve = {
    plan: async () => ({
      analysis: story,
      plans: [
        {
          team,
          mappings: [
            { source: fictional, action: 'preserve', targetName: source.name },
          ],
        },
      ],
    }),
  };
  const ok = await new ContentGenerationService(
    preserve,
    { text: async () => output('Original Star') },
    config,
  ).batch(body);
  a.equal(ok.success, true);
});
test('unresolved background knowledge still fails before writing any article', async () => {
  let written = false;
  const ai = {
    preflight: () => {},
    text: async (p, provider, schema) => {
      if (schema?.properties?.people) return JSON.stringify({ people: [] });
      if (schema)
        return JSON.stringify({
          ...story,
          characters: [{ ...source, requiredTraits: ['parent'] }],
        });
      written = true;
      return output();
    },
  };
  await a.rejects(
    () => new ContentGenerationService(selector(ai), ai, config).batch(body),
    (e) => e.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
  a.equal(written, false);
});

test('one team with unresolved character facts does not block writing other teams', async () => {
  let analysisCalls = 0;
  const writtenTeams = [];
  const ai = {
    preflight: () => {},
    text: async (prompt, provider, schema) => {
      if (schema?.properties?.people) return JSON.stringify({ people: [] });
      if (schema) {
        analysisCalls++;
        return JSON.stringify({
          ...story,
          characters: [{ ...source, careerStage: 'veteran' }],
        });
      }
      const context = JSON.parse(prompt.split('\nCONTEXT JSON:\n')[1]);
      writtenTeams.push(context.targetTeam.team);
      return output(context.lockedCharacterMap[0].targetName);
    },
  };
  const complete = (name) => ({
    ...team,
    team: name,
    personnel: [
      {
        name: 'Target One',
        role: 'player',
        status: 'active',
        careerStage: 'veteran',
        importance: 'star',
        traits: [],
      },
    ],
  });
  const teams = [
    complete('First'),
    { ...team, team: 'Missing facts' },
    complete('Last'),
  ];
  const result = await new ContentGenerationService(
    selector(ai),
    ai,
    config,
  ).batch({ ...body, teams });
  a.equal(analysisCalls, 1);
  a.equal(result.success, false);
  a.deepEqual(
    result.results.map((row) => row.team),
    teams.map((team) => team.team),
  );
  a.deepEqual(
    result.results.map((row) => row.success),
    [true, false, true],
  );
  a.equal(result.results[1].stage, 'plan');
  a.equal(result.results[1].error.code, 'CHARACTER_REVIEW_REQUIRED');
  a.deepEqual(writtenTeams, ['First', 'Last']);
});

function knowledgeAI(characters, people) {
  const calls = [];
  return {
    calls,
    preflight: () => {},
    text: async (prompt, provider, schema) => {
      calls.push({ prompt, provider, schema });
      return JSON.stringify(
        schema?.properties?.people
          ? { people }
          : { summary: 'Source story', characters },
      );
    },
  };
}
const remembered = (overrides = {}) => ({
  name: 'Target Two',
  role: 'player',
  status: 'active',
  careerStage: 'veteran',
  importance: 'star',
  traits: ['parent'],
  confidence: 'high',
  knowledgeNote:
    'Known established career and publicly known parenthood from learned knowledge.',
  ...overrides,
});

test('missing veteran/parent data invokes model knowledge and chooses within imported current lineup', async () => {
  const need = {
    ...source,
    careerStage: 'veteran',
    requiredTraits: ['parent'],
  };
  const ai = knowledgeAI([need], [remembered()]);
  const result = await selector(ai).plan({
    ...body,
    teams: [{ ...team, season: '2026', lineupAsOf: '2026-10-25' }],
  });
  a.equal(ai.calls.length, 2);
  const mapping = result.plans[0].mappings[0];
  a.equal(mapping.targetName, 'Target Two');
  a.equal(mapping.profile.knowledgeSource, 'model_knowledge');
  a.deepEqual(mapping.profile.traits, ['parent']);
  a.ok(ai.calls[1].prompt.includes('2026-10-25'));
});
test('model knowledge may select a genuine former player absent from current lineup', async () => {
  const former = { ...source, status: 'former', careerStage: 'veteran' };
  const ai = knowledgeAI(
    [former],
    [
      remembered({
        name: 'Former Legend',
        status: 'former',
        traits: [],
        knowledgeNote: 'Previously played for target team before retirement.',
      }),
    ],
  );
  const result = await selector(ai).plan(body);
  a.equal(result.plans[0].mappings[0].targetName, 'Former Legend');
  a.equal(
    result.plans[0].mappings[0].profile.knowledgeSource,
    'model_knowledge',
  );
});
test('model cannot add an active player outside the imported lineup', async () => {
  const ai = knowledgeAI(
    [{ ...source, requiredTraits: ['parent'] }],
    [remembered({ name: 'Outside Player' })],
  );
  await a.rejects(() => selector(ai).plan(body), /outside imported lineup/);
});
test('model cannot replace the current imported head coach', async () => {
  const ai = knowledgeAI(
    [{ ...source, role: 'coach', requiredTraits: ['parent'] }],
    [remembered({ name: 'Old Coach', role: 'coach' })],
  );
  await a.rejects(() => selector(ai).plan(body), /outside imported lineup/);
});
test('model cannot recast a current roster member as a former player', async () => {
  const ai = knowledgeAI(
    [{ ...source, status: 'former' }],
    [remembered({ name: 'Target One', status: 'former' })],
  );
  await a.rejects(
    () => selector(ai).plan(body),
    /conflicts with supplied personnel/,
  );
});
test('explicit input career metadata wins over conflicting model memory', async () => {
  const enriched = {
    ...team,
    personnel: [
      {
        name: 'Target Two',
        role: 'player',
        status: 'active',
        careerStage: 'rookie',
        importance: 'unknown',
        traits: [],
      },
    ],
  };
  const ai = knowledgeAI(
    [{ ...source, careerStage: 'veteran', requiredTraits: ['parent'] }],
    [remembered()],
  );
  await a.rejects(
    () => selector(ai).plan({ ...body, teams: [enriched] }),
    /conflicts with supplied personnel/,
  );
});
test('uncertain model background is not fabricated into a compatible profile', async () => {
  const ai = knowledgeAI(
    [{ ...source, requiredTraits: ['parent'] }],
    [remembered({ confidence: 'uncertain' })],
  );
  await a.rejects(
    () => selector(ai).plan(body),
    (e) => e.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
});
test('anonymous and fictional people do not trigger background lookup', async () => {
  for (const characters of [
    [],
    [{ ...source, identity: 'fictional' }],
    [{ ...source, identity: 'unspecified' }],
  ]) {
    const ai = knowledgeAI(characters, [remembered()]);
    const result = await selector(ai).plan(body);
    a.equal(ai.calls.length, 1);
    a.equal(
      result.plans[0].mappings.some((x) => x.action === 'replace'),
      false,
    );
  }
});
test('complete supplied profiles skip background lookup', async () => {
  const enriched = {
    ...team,
    personnel: [
      {
        name: 'Target Two',
        role: 'player',
        status: 'active',
        careerStage: 'veteran',
        importance: 'star',
        traits: ['parent'],
      },
    ],
  };
  const ai = knowledgeAI([{ ...source, requiredTraits: ['parent'] }], []);
  const result = await selector(ai).plan({ ...body, teams: [enriched] });
  a.equal(ai.calls.length, 1);
  a.equal(result.plans[0].mappings[0].targetName, 'Target Two');
});
test('a general current narrative cannot use a former member just because traits match', () => {
  const enriched = {
    ...team,
    personnel: [
      {
        name: 'Former Legend',
        role: 'player',
        status: 'former',
        careerStage: 'veteran',
        importance: 'star',
        traits: ['parent'],
      },
    ],
  };
  a.throws(
    () =>
      selector(storyAI).select(
        {
          summary: 'Story',
          characters: [
            { ...source, status: 'any', requiredTraits: ['parent'] },
          ],
        },
        enriched,
      ),
    (e) => e.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
});
test('normalizing a supplied current profile does not mutate user input', () => {
  const profile = {
    name: 'Target One',
    role: 'player',
    status: 'unknown',
    careerStage: 'unknown',
    importance: 'unknown',
    traits: [],
  };
  const enriched = { ...team, personnel: [profile] };
  selector(storyAI).select(story, enriched);
  a.equal(profile.status, 'unknown');
});

test('established player role accepts veteran knowledge without allowing rookies', () => {
  const enriched = {
    ...team,
    personnel: [
      {
        name: 'Target One',
        role: 'player',
        status: 'active',
        careerStage: 'veteran',
        importance: 'star',
        traits: [],
      },
    ],
  };
  const selection = selector(storyAI);
  a.equal(
    selection.select(
      {
        summary: 'Injury story',
        characters: [
          { ...source, careerStage: 'established', importance: 'star' },
        ],
      },
      enriched,
    ).mappings[0].targetName,
    'Target One',
  );
  a.throws(
    () =>
      selection.select(
        {
          summary: 'Rookie story',
          characters: [
            { ...source, careerStage: 'rookie', importance: 'star' },
          ],
        },
        enriched,
      ),
    (e) => e.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
});
test('incidental current coach uses imported headCoach regardless of own prominence', () => {
  const enriched = {
    ...team,
    personnel: [
      {
        name: 'Target Coach',
        role: 'coach',
        status: 'active',
        careerStage: 'veteran',
        importance: 'star',
        traits: [],
      },
    ],
  };
  const plan = selector(storyAI).select(
    {
      summary: 'Player injury, coach mentioned',
      characters: [
        {
          ...source,
          role: 'coach',
          careerStage: 'established',
          importance: 'supporting',
        },
      ],
    },
    enriched,
  );
  a.equal(plan.mappings[0].targetName, 'Target Coach');
});
