const { test, afterEach } = require('node:test');
const a = require('node:assert/strict');
const {
  ContentAiService,
} = require('../dist/modules/content/content-ai.service.js');
const {
  CharacterSelectionService,
} = require('../dist/modules/content/character-selection.service.js');
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

test('caption star requirements override a weak model classification and make the player primary', async () => {
  const caption =
    'CONFIRMED: Ohio State star Jeremiah Smith has been recognised.';
  const person = {
    ...source,
    name: 'Jeremiah Smith',
    importance: 'any',
    narrativeRole: 'reference',
    affiliation: 'unknown',
    evidence: 'Jeremiah Smith',
  };
  const ai = {
    preflight: () => {},
    text: async () =>
      JSON.stringify({ summary: 'Recognition', characters: [person] }),
  };
  const result = await selector(ai).analyze({
    ...body,
    caption,
    content: 'Jeremiah Smith has influence.',
  });
  a.equal(result.characters[0].importance, 'star');
  a.equal(result.characters[0].narrativeRole, 'primary');
  a.equal(result.characters[0].affiliation, 'source_team');
});

test('caption star maps to an imported captain while record-holder comparisons remain context', () => {
  const sourceStar = {
    ...source,
    name: 'Jeremiah Smith',
    importance: 'star',
    narrativeRole: 'primary',
    affiliation: 'source_team',
  };
  const comparison = {
    ...source,
    id: 'record',
    name: 'Braylon Edwards',
    inCaption: false,
    status: 'former',
    narrativeRole: 'reference',
    affiliation: 'external',
  };
  const captainTeam = {
    ...team,
    team: 'Adelaide Crows',
    players: ['First Roster Player', 'Jordan Dawson'],
    captain: 'Jordan Dawson',
  };
  const plan = selector(storyAI).select(
    {
      summary: 'Star recognition; historical record comparison',
      characters: [sourceStar, comparison],
    },
    captainTeam,
  );
  a.equal(plan.mappings[0].targetName, 'Jordan Dawson');
  a.ok(plan.mappings[0].profile.traits.includes('captain'));
  a.match(plan.mappings[0].selectionReason, /Đội trưởng/);
  a.equal(plan.mappings[1].action, 'context');
  a.equal(plan.mappings[1].profile, undefined);
});

test('captain metadata cannot add a current person outside the imported player list', () => {
  const plan = selector(storyAI).select(
    { ...story, characters: [] },
    { ...team, captain: 'Outside Captain' },
  );
  a.equal(plan.team.players.includes('Outside Captain'), false);
  a.throws(
    () =>
      selector(storyAI).select(
        { ...story, characters: [{ ...source, importance: 'star' }] },
        { ...team, captain: 'Outside Captain' },
      ),
    (error) => error.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
});

test('an eligible original protagonist stays themselves when adapting to the same team', () => {
  const captainTeam = {
    ...team,
    players: ['Other Captain', 'Jeremiah Smith'],
    captain: 'Other Captain, Jeremiah Smith',
  };
  const plan = selector(storyAI).select(
    {
      ...story,
      characters: [
        {
          ...source,
          name: 'Jeremiah Smith',
          importance: 'star',
          narrativeRole: 'primary',
        },
      ],
    },
    captainTeam,
  );
  a.equal(plan.mappings[0].targetName, 'Jeremiah Smith');
});

test('multiple prominent candidates require justified ranking rather than roster order', () => {
  const focus = { ...source, importance: 'star', narrativeRole: 'primary' };
  const profiles = ['Target One', 'Target Two'].map((name) => ({
    name,
    role: 'player',
    status: 'active',
    careerStage: 'unknown',
    importance: 'star',
    traits: [],
  }));
  const enriched = { ...team, personnel: profiles };
  const story = { summary: 'Leadership recognition', characters: [focus] };
  a.throws(
    () => selector(storyAI).select(story, enriched),
    (error) => error.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
  const recommendations = [
    {
      sourceCharacterId: focus.id,
      targetName: 'Target One',
      score: 70,
      reason: 'Prominent player.',
      confidence: 'high',
    },
    {
      sourceCharacterId: focus.id,
      targetName: 'Target Two',
      score: 95,
      reason: 'Leadership aligns with the recognition theme.',
      confidence: 'high',
    },
  ];
  for (const players of [team.players, [...team.players].reverse()]) {
    const plan = selector(storyAI).select(
      story,
      { ...enriched, players },
      recommendations,
    );
    a.equal(plan.mappings[0].targetName, 'Target Two');
    a.equal(plan.mappings[0].suitabilityScore, 95);
  }
});

test('external reference characters do not trigger a former-player knowledge lookup', async () => {
  let calls = 0;
  const reference = {
    ...source,
    name: 'Braylon Edwards',
    inCaption: false,
    status: 'former',
    narrativeRole: 'reference',
    affiliation: 'external',
    evidence: 'Braylon Edwards',
  };
  const ai = {
    preflight: () => {},
    text: async () => {
      calls++;
      return JSON.stringify({ summary: 'Comparison', characters: [reference] });
    },
  };
  const result = await selector(ai).plan({
    ...body,
    caption: 'A club reflects on receiving records.',
    content: 'Braylon Edwards is mentioned as a historical comparison.',
  });
  a.equal(calls, 1);
  a.equal(result.plans[0].mappings[0].action, 'context');
});

test('supplied captain leadership remains eligible even if model labels sporting prominence as supporting', () => {
  const captainTeam = {
    ...team,
    captain: 'Target Two',
    personnel: [
      {
        name: 'Target Two',
        role: 'player',
        status: 'active',
        careerStage: 'established',
        importance: 'supporting',
        traits: [],
      },
    ],
  };
  const plan = selector(storyAI).select(
    {
      ...story,
      characters: [{ ...source, importance: 'star', narrativeRole: 'primary' }],
    },
    captainTeam,
  );
  a.equal(plan.mappings[0].targetName, 'Target Two');
});

test('an unresolved model ranking gets one constrained repair without guessing a roster entry', async () => {
  const focus = { ...source, importance: 'star', narrativeRole: 'primary' };
  let supplements = 0;
  const people = ['Target One', 'Target Two'].map((name) =>
    remembered({ name, traits: [] }),
  );
  const ai = {
    preflight: () => {},
    text: async (prompt, provider, schema) => {
      if (!schema?.properties?.people)
        return JSON.stringify({ ...story, characters: [focus] });
      supplements++;
      if (supplements === 2)
        a.ok(
          JSON.parse(prompt.split('\nCONTEXT JSON:\n')[1]).selectionFeedback,
        );
      return JSON.stringify({
        people,
        recommendations:
          supplements === 1
            ? []
            : [
                {
                  sourceCharacterId: focus.id,
                  targetName: 'Target Two',
                  score: 95,
                  confidence: 'high',
                  reason: 'Compatible leadership and prominence.',
                },
              ],
      });
    },
  };
  const result = await selector(ai).plan(body);
  a.equal(supplements, 2);
  a.equal(result.plans[0].mappings[0].targetName, 'Target Two');
});
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
  const result = await selector(ai).plan(body);
  a.equal(result.plans[0].mappings[0].action, 'generalize');
  a.equal(result.plans[0].mappings[0].profile, undefined);
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
