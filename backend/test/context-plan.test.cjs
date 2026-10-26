const { test } = require('node:test');
const a = require('node:assert/strict');
const {
  ContextPlanService,
} = require('../dist/modules/content/context-plan.service.js');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const config = new ContentConfigService();
const team = {
  team: 'Target Club',
  sport: 'AFL',
  categories: [44],
  players: ['Young Player', 'Senior Player', 'Other Senior'],
  headCoach: 'Current Coach',
  personnel: [
    {
      name: 'Young Player',
      role: 'player',
      status: 'active',
      careerStage: 'rookie',
      importance: 'supporting',
      traits: [],
    },
    {
      name: 'Senior Player',
      role: 'player',
      status: 'active',
      careerStage: 'veteran',
      importance: 'star',
      traits: ['parent', 'married'],
    },
    {
      name: 'Other Senior',
      role: 'player',
      status: 'active',
      careerStage: 'veteran',
      importance: 'star',
      traits: ['parent', 'married'],
    },
    {
      name: 'Current Coach',
      role: 'coach',
      status: 'active',
      careerStage: 'veteran',
      importance: 'star',
      traits: ['parent', 'married'],
    },
  ],
};
const character = (patch = {}) => ({
  id: 'main',
  name: 'Original Star',
  description: 'a star player',
  identity: 'real',
  inCaption: true,
  role: 'player',
  positionOrFunction: null,
  temporalStatus: 'active',
  narrativeRole: 'primary',
  narrativeWeight: 'star',
  requiredTraits: [],
  ...patch,
});
const analysis = (patch = {}) => ({
  storyType: 'milestone',
  hasIndividualFocus: true,
  sourceTeam: 'Original Club',
  lifeEvent: 'none',
  narrativeAction: 'Recognising a player',
  keyBeats: ['Recognition'],
  hasDirectQuotes: false,
  characters: [character()],
  ...patch,
});
const choice = (id, score = 95, patch = {}) => ({
  candidateId: id,
  historicalName: null,
  score,
  confidence: 'high',
  reason: 'Phù hợp vai trò và tầm ảnh hưởng.',
  knownTraits: [],
  position: null,
  ...patch,
});
const service = () => new ContextPlanService({ preflight() {} }, config);
const rows = (candidates) => [
  { teamIndex: 0, characterId: 'main', candidates },
];

test('anonymous player and unnamed head coach retain role without selecting any real name', () => {
  const s = service(),
    pool = s.candidates(team, 0);
  for (const role of ['player', 'head_coach']) {
    const result = s.choose(
      analysis({
        characters: [character({ name: null, identity: 'anonymous', role })],
      }),
      team,
      0,
      pool,
      rows([choice(pool[1].id)]),
    );
    a.equal(result.mappings[0].action, 'preserve_anonymous');
    a.match(
      result.mappings[0].target,
      role === 'player' ? /player/ : /head coach/,
    );
  }
});
test('fictional names stay fictional even if recommendations propose a real athlete', () => {
  const s = service(),
    pool = s.candidates(team, 0);
  const result = s.choose(
    analysis({
      characters: [
        character({ name: 'Invented Person', identity: 'fictional' }),
      ],
    }),
    team,
    0,
    pool,
    rows([choice(pool[1].id)]),
  );
  a.equal(result.mappings[0].action, 'preserve_fictional');
  a.equal(result.mappings[0].target, 'Invented Person');
});
test('ranking chooses compatible star, never a rookie/supporting figure or head coach for a player story', () => {
  const s = service(),
    p = s.candidates(team, 0);
  const r = s.choose(
    analysis(),
    team,
    0,
    p,
    rows([choice(p[0].id, 100), choice(p[3].id, 99), choice(p[1].id, 90)]),
  );
  a.equal(r.mappings[0].target, 'Senior Player');
});
test('unknown status and unknown role produce explicit generic fallback, not an active-player guess', () => {
  const s = service(),
    p = s.candidates(team, 0);
  for (const patch of [{ role: 'unknown' }, { temporalStatus: 'unknown' }]) {
    const r = s.choose(
      analysis({ characters: [character(patch)] }),
      team,
      0,
      p,
      rows([choice(p[1].id)]),
    );
    a.equal(r.mappings[0].action, 'generic');
  }
});
test('former figures cannot be selected from current lineup; confident historical knowledge is labelled', () => {
  const s = service(),
    p = s.candidates(team, 0),
    story = analysis({
      characters: [
        character({ temporalStatus: 'former', narrativeWeight: 'veteran' }),
      ],
    });
  let r = s.choose(
    story,
    team,
    0,
    p,
    rows([
      choice(p[1].id),
      choice('', 94, { historicalName: 'Senior Player' }),
    ]),
  );
  a.equal(r.mappings[0].action, 'generic');
  r = s.choose(
    story,
    team,
    0,
    p,
    rows([
      choice('', 95, {
        historicalName: 'Historic Player',
        reason: 'Cựu cầu thủ thực sự từng thi đấu cho đội.',
      }),
    ]),
  );
  a.equal(r.mappings[0].target, 'Historic Player');
  a.equal(r.mappings[0].knowledgeSource, 'model_knowledge');
});
test('staff stories do not silently become head-coach stories', () => {
  const s = service(),
    p = s.candidates(team, 0);
  const r = s.choose(
    analysis({
      characters: [
        character({
          role: 'coach_staff',
          positionOrFunction: 'offensive coordinator',
        }),
      ],
    }),
    team,
    0,
    p,
    rows([choice(p[3].id)]),
  );
  a.equal(r.mappings[0].action, 'generic');
});
test('life events prefer compatible player; coach exception requires background and absence of compatible players', () => {
  const s = service(),
    p = s.candidates(team, 0),
    story = analysis({
      lifeEvent: 'new_baby',
      characters: [character({ requiredTraits: ['parent'] })],
    });
  let r = s.choose(
    story,
    team,
    0,
    p,
    rows([choice(p[3].id, 100), choice(p[1].id, 92)]),
  );
  a.equal(r.mappings[0].target, 'Senior Player');
  r = s.choose(story, team, 0, p, rows([choice(p[3].id, 100)]));
  a.equal(r.mappings[0].target, 'Current Coach');
  a.equal(r.mappings[0].roleException, 'life_event');
  const bare = { ...team, personnel: [] },
    barePool = s.candidates(bare, 0);
  r = s.choose(story, bare, 0, barePool, rows([choice(barePool[3].id)]));
  a.equal(r.mappings[0].action, 'generic');
});
test('equal-fit candidates rotate only after a successful record, with account-scoped RAM history', async () => {
  const s = service(),
    p = s.candidates(team, 0),
    proposed = rows([choice(p[1].id, 95), choice(p[2].id, 95)]);
  await config.withValues({ CONTENT_HISTORY_SCOPE: 'a' }, async () => {
    const first = s.choose(analysis(), team, 0, p, proposed);
    a.equal(first.mappings[0].target, 'Senior Player');
    s.record(first);
    a.equal(
      s.choose(analysis(), team, 0, p, proposed).mappings[0].target,
      'Other Senior',
    );
    a.equal(
      s.choose(
        analysis(),
        team,
        0,
        p,
        rows([choice(p[1].id, 99), choice(p[2].id, 80)]),
      ).mappings[0].target,
      'Senior Player',
    );
  });
  await config.withValues({ CONTENT_HISTORY_SCOPE: 'b' }, async () =>
    a.equal(
      s.choose(analysis(), team, 0, p, proposed).mappings[0].target,
      'Senior Player',
    ),
  );
});
test('a candidate cannot replace two distinct source people and another team ID is never accepted', () => {
  const s = service(),
    p = s.candidates(team, 0),
    story = analysis({
      characters: [
        character(),
        character({ id: 'second', name: 'Second Person' }),
      ],
    });
  const r = s.choose(story, team, 0, p, [
    ...rows([choice(p[1].id)]),
    {
      teamIndex: 0,
      characterId: 'second',
      candidates: [choice(p[1].id), choice('t9p2')],
    },
  ]);
  a.equal(r.mappings[1].action, 'generic');
});
test('parse failure returns a visible fallback with one Gemini call and does not masquerade as no character', async () => {
  let calls = 0;
  const s = new ContextPlanService(
    {
      preflight() {},
      async text(_prompt, provider, schema) {
        calls++;
        a.equal(provider, 'gemini');
        a.ok(schema.properties.characters);
        return 'not json';
      },
    },
    config,
  );
  const r = await s.prepare({
    caption: 'Source',
    content: 'Story',
    teams: [team, team],
  });
  a.equal(calls, 1);
  a.equal(r.status, 'fallback');
  a.equal(r.analysis, null);
  a.match(r.warnings[0], /ANALYZER_INVALID_RESPONSE/);
});
test('source names absent from input are downgraded with warning, never the old unsupported-evidence exception', async () => {
  const response = { ...analysis(), recommendations: [], warnings: [] };
  const s = new ContextPlanService(
    {
      preflight() {},
      async text() {
        return JSON.stringify(response);
      },
    },
    config,
  );
  const r = await s.prepare({
    caption: 'An unnamed player',
    content: 'An injury story',
    teams: [team],
  });
  a.equal(r.status, 'ready');
  a.equal(r.analysis.characters[0].name, null);
  a.match(r.warnings[0], /SOURCE_NAME_UNGROUNDED/);
});
test('context parser distinguishes role/focus/naming and rejects malformed enums or duplicate rows', () => {
  const s = service(),
    valid = { ...analysis(), recommendations: [], warnings: [] };
  a.equal(
    s.parse('```json\n' + JSON.stringify(valid) + '\n```', 1)
      .hasIndividualFocus,
    true,
  );
  for (const patch of [
    { storyType: 'invalid' },
    { characters: [character({ temporalStatus: 'retired' })] },
    { keyBeats: Array(7).fill('x') },
    {
      recommendations: [{ teamIndex: 9, characterId: 'main', candidates: [] }],
    },
  ])
    a.throws(() => s.parse(JSON.stringify({ ...valid, ...patch }), 1));
});
test('writer receives selected identities only; unknown or anonymous stories receive no full roster', () => {
  const s = service(),
    p = s.candidates(team, 0);
  const anon = s.choose(
    analysis({
      characters: [character({ name: null, identity: 'anonymous' })],
    }),
    team,
    0,
    p,
    [],
  );
  a.deepEqual(s.writerTeam(team, anon).players, []);
  a.equal(s.writerTeam(team, anon).headCoach, null);
  const selected = s.choose(analysis(), team, 0, p, rows([choice(p[1].id)]));
  a.deepEqual(s.writerTeam(team, selected).players, ['Senior Player']);
});
test('post-write consistency check flags names added to anonymous story or wrong caption without another model call', () => {
  const s = service(),
    p = s.candidates(team, 0),
    anon = s.choose(
      analysis({
        characters: [character({ name: null, identity: 'anonymous' })],
      }),
      team,
      0,
      p,
      [],
    );
  a.match(
    s.review(
      {
        title: 'Senior Player hurt',
        caption: 'FICTION: Senior Player hurt',
        content: '<p>An unnamed player</p>',
      },
      anon,
      [team],
    )[0],
    /Senior Player/,
  );
  const named = s.choose(analysis(), team, 0, p, rows([choice(p[1].id)]));
  a.ok(
    s.review(
      {
        title: 'Story',
        caption: 'FICTION: Original Star hurt',
        content: '<p>Original Star</p>',
      },
      named,
      [team],
    ).length > 0,
  );
});

test('captain metadata is attached to the existing roster candidate, without inventing a new active player', () => {
  const s = service();
  const p = s.candidates(
    { ...team, captain: 'Senior Player, Not In Roster' },
    0,
  );
  a.equal(p.find((x) => x.name === 'Senior Player').captain, true);
  a.equal(
    p.some((x) => x.name === 'Not In Roster'),
    false,
  );
});
test('former source person stays themselves for their own team unless that person is supplied as current', () => {
  const s = service(),
    story = analysis({
      sourceTeam: team.team,
      characters: [character({ temporalStatus: 'former' })],
    });
  const r = s.choose(story, team, 0, s.candidates(team, 0), []);
  a.equal(r.mappings[0].target, 'Original Star');
  const current = { ...team, players: ['Original Star'] };
  a.equal(
    s.choose(story, current, 0, s.candidates(current, 0), []).mappings[0]
      .action,
    'generic',
  );
});
test('position and narrative labels are not treated as unfulfilled personal-life conditions', async () => {
  const response = {
    ...analysis({
      characters: [
        character({
          temporalStatus: 'former',
          requiredTraits: ['veteran', 'legendary quarterback'],
        }),
      ],
    }),
    warnings: [],
    recommendations: rows([
      choice('', 95, { historicalName: 'Historic Player' }),
    ]),
  };
  const s = new ContextPlanService(
    {
      preflight() {},
      async text() {
        return JSON.stringify(response);
      },
    },
    config,
  );
  const r = await s.prepare({
    caption: 'Original Star reflects',
    content: 'Original Star remembers',
    teams: [team],
  });
  a.equal(r.teams[0].mappings[0].target, 'Historic Player');
  a.deepEqual(r.analysis.characters[0].requiredTraits, []);
  a.ok(r.warnings.some((w) => w.includes('TRAIT_NORMALIZED')));
  a.ok(r.recommendations);
});
test('simple empty-string wire values normalize to null, avoiding nullable-union schema complexity', () => {
  const s = service();
  const r = s.parse(
    JSON.stringify({
      ...analysis(),
      sourceTeam: '',
      characters: [
        character({ name: '', identity: 'anonymous', positionOrFunction: '' }),
      ],
      recommendations: [],
      warnings: [],
    }),
    1,
  );
  a.equal(r.sourceTeam, null);
  a.equal(r.characters[0].name, null);
});

test('anonymous family members retain their relationship rather than becoming team personnel', () => {
  const s = service();
  const r = s.choose(
    analysis({
      characters: [
        character({
          name: null,
          identity: 'anonymous',
          role: 'other',
          description: "the player's wife",
        }),
      ],
    }),
    team,
    0,
    s.candidates(team, 0),
    [],
  );
  a.equal(r.mappings[0].target, "the player's wife");
});
test('generic fallback cannot keep a named source person in another team version', () => {
  const s = service();
  const r = s.choose(analysis(), team, 0, s.candidates(team, 0), []);
  a.ok(
    s
      .review(
        {
          title: 'Original Star',
          caption: 'FICTION: Original Star',
          content: '<p>Original Star</p>',
        },
        r,
        [team],
      )
      .some((w) => w.includes('Original Star')),
  );
});

test('collective supporters do not turn into a singular unnamed team figure', () => {
  const s = service();
  const r = s.choose(
    analysis({
      characters: [
        character({
          name: null,
          identity: 'anonymous',
          role: 'other',
          description: 'the teammates and supporters',
        }),
      ],
    }),
    team,
    0,
    s.candidates(team, 0),
    [],
  );
  a.match(r.mappings[0].target, /teammates/);
  a.equal(r.mappings[0].target.includes('team figure'), false);
});
test('model notes are separate from runtime warnings and final choices', async () => {
  const response = {
    ...analysis({ characters: [] }),
    recommendations: [],
    warnings: ['An uncertain model note'],
  };
  const s = new ContextPlanService(
    {
      preflight() {},
      async text() {
        return JSON.stringify(response);
      },
    },
    config,
  );
  const r = await s.prepare({
    caption: 'Fans',
    content: 'Fans gather',
    teams: [team],
  });
  a.deepEqual(r.warnings, []);
  a.deepEqual(r.modelWarnings, response.warnings);
});
