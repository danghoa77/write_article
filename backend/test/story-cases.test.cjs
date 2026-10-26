const { test } = require('node:test');
const a = require('node:assert/strict');
const {
  CharacterSelectionService,
} = require('../dist/modules/content/character-selection.service.js');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const { grounded } = require('../dist/modules/content/story-scan.js');
const config = { defaults: () => new ContentConfigService().defaults() };
const team = {
  sport: 'AFL',
  team: 'Target Club',
  categories: [44],
  players: ['Target One', 'Target Two'],
  captain: 'Target Two',
  headCoach: 'Target Coach',
};
const person = {
  id: 'main',
  name: 'Source Player',
  identity: 'real',
  inCaption: true,
  role: 'player',
  status: 'any',
  careerStage: 'any',
  importance: 'any',
  requiredTraits: [],
  evidence: 'Source Player',
  narrativeRole: 'primary',
  affiliation: 'source_team',
};
const scan = {
  storyType: 'lifestyle',
  identityCase: 'real',
  eventSpecific: 'none',
  reason: 'Câu chuyện về một cầu thủ.',
};
const story = {
  summary: 'A player visits the club.',
  sourceTeam: '',
  scan,
  characters: [person],
};
const body = {
  caption: 'Source Player visits the club.',
  content: 'Source Player meets supporters.',
  teams: [team],
};
const make = (text) =>
  new CharacterSelectionService(
    config,
    { preflight() {}, text },
    { validateTeam() {} },
  );

test('evidence accepts Unicode, HTML entities and Markdown while retaining contiguous source words', () => {
  a.equal(
    grounded(
      'The player’s <strong>family</strong> &amp; friends — together.',
      "The player's family & friends - together",
    ),
    true,
  );
  a.equal(
    grounded('José visits the club.', 'Jose\u0301 visits the club'),
    true,
  );
  a.equal(
    grounded(
      '**Source Player** — visits the club.',
      'Source Player visits the club',
    ),
    true,
  );
  a.equal(
    grounded('Source Player visits the club.', 'Player visits the'),
    true,
  );
  a.equal(
    grounded('Source Player visits the club.', 'Source Player won a trophy'),
    false,
  );
  a.equal(grounded('Source Player visits the club.', 'SourcePlayer'), false);
  a.equal(grounded('Source Player visits the club.', 'our'), false);
});

test('repairs paraphrased evidence once without accepting an invented quote', async () => {
  let calls = 0;
  const service = make(async (prompt) => {
    calls++;
    if (calls === 2) a.match(prompt, /ANALYSIS REPAIR/);
    return JSON.stringify({
      ...story,
      characters: [
        {
          ...person,
          evidence:
            calls === 1
              ? 'Source Player greets the supporters'
              : 'Source Player meets supporters',
        },
      ],
    });
  });
  const result = await service.analyze(body);
  a.equal(calls, 2);
  a.equal(result.scan.identityCase, 'real');
  a.equal(result.characters[0].inCaption, true);
});

test('unsupported names still fail after one bounded repair with actionable details', async () => {
  let calls = 0;
  await a.rejects(
    () =>
      make(async () => {
        calls++;
        return JSON.stringify({
          ...story,
          characters: [{ ...person, name: 'Invented Athlete' }],
        });
      }).analyze(body),
    (error) =>
      error.getResponse().code === 'ANALYSIS_EVIDENCE_INVALID' &&
      error.getResponse().character === 'Invented Athlete',
  );
  a.equal(calls, 2);
});

test('provider failure does not trigger analysis repair or provider switching', async () => {
  let calls = 0;
  await a.rejects(
    () =>
      make(async () => {
        calls++;
        throw new Error('quota');
      }).analyze(body),
    /quota/,
  );
  a.equal(calls, 1);
});

test('anonymous and fictional cases preserve identities and never require a real substitute', async () => {
  for (const [identity, name, expected] of [
    ['unspecified', 'An unnamed player', 'uncertain'],
    ['fictional', 'Invented Hero', 'fictional'],
  ]) {
    const data = {
      ...story,
      characters: [{ ...person, identity, name, evidence: name }],
    };
    const result = await make(async () => JSON.stringify(data)).plan({
      ...body,
      caption: name + ' visits.',
      content: name + ' meets fans.',
    });
    a.equal(result.analysis.scan.identityCase, expected);
    a.equal(result.plans[0].mappings[0].action, 'preserve');
    a.equal(result.plans[0].mappings[0].targetName, name);
  }
  const empty = await make(async () =>
    JSON.stringify({ ...story, characters: [] }),
  ).plan(body);
  a.equal(empty.analysis.scan.identityCase, 'none');
});

test('preserve mode keeps real primary, supporting and reference names without knowledge calls', async () => {
  let calls = 0;
  const data = {
    ...story,
    characters: [
      person,
      {
        ...person,
        id: 'ref',
        name: 'Old Legend',
        narrativeRole: 'reference',
        affiliation: 'external',
      },
    ],
  };
  const result = await make(async () => {
    calls++;
    return JSON.stringify(data);
  }).plan({
    ...body,
    content: 'Source Player meets Old Legend.',
    characterMode: 'preserve',
  });
  a.equal(calls, 1);
  a.deepEqual(
    result.plans[0].mappings.map((p) => [p.action, p.targetName]),
    [
      ['preserve', 'Source Player'],
      ['preserve', 'Old Legend'],
    ],
  );
});

test('manual selection wins over ranking while role and trait constraints remain mandatory', () => {
  const service = make(async () => '');
  const options = {
    characterMode: 'manual',
    characterSelections: [
      {
        sport: team.sport,
        team: team.team,
        sourceName: person.name,
        targetName: 'Target Two',
      },
    ],
  };
  a.equal(
    service.select(story, team, [], options).mappings[0].targetName,
    'Target Two',
  );
  a.throws(
    () =>
      service.select(
        { ...story, characters: [{ ...person, requiredTraits: ['parent'] }] },
        team,
        [],
        options,
      ),
    (error) => error.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
  a.throws(
    () =>
      service.select(story, team, [], { ...options, characterSelections: [] }),
    (error) => error.getResponse().code === 'MANUAL_CHARACTER_REQUIRED',
  );
  a.throws(
    () =>
      service.select(story, team, [], {
        ...options,
        characterSelections: [
          { ...options.characterSelections[0], targetName: 'Outside Player' },
        ],
      }),
    /lineup/,
  );
  a.throws(
    () =>
      service.select(story, team, [], {
        ...options,
        characterSelections: [
          { ...options.characterSelections[0], targetName: team.headCoach },
        ],
      }),
    (error) => error.getResponse().code === 'CHARACTER_REVIEW_REQUIRED',
  );
});

test('personal-event scan requires separate event facts before mapping to a different real person', async () => {
  const data = {
    ...story,
    scan: { ...scan, storyType: 'sad_news', eventSpecific: 'personal' },
  };
  const request = {
    ...body,
    caption: 'Source Player has passed away.',
    characterMode: 'manual',
    characterSelections: [
      {
        sport: team.sport,
        team: team.team,
        sourceName: person.name,
        targetName: 'Target Two',
      },
    ],
  };
  await a.rejects(
    () => make(async () => JSON.stringify(data)).plan(request),
    (error) => error.getResponse().code === 'STORY_FACTS_REQUIRED',
  );
  const result = await make(async () => JSON.stringify(data)).plan({
    ...request,
    teamFacts: [
      {
        sport: team.sport,
        team: team.team,
        facts: 'Source supplied separately by the editor for Target Two.',
      },
    ],
  });
  a.equal(result.plans.length, 1);
  const kept = await make(async () => JSON.stringify(data)).plan({
    ...body,
    caption: request.caption,
    characterMode: 'preserve',
  });
  a.equal(kept.plans[0].mappings[0].action, 'preserve');
});

test('roster eligibility alone cannot transfer a match result', async () => {
  const data = {
    ...story,
    scan: { ...scan, storyType: 'match', eventSpecific: 'match' },
  };
  await a.rejects(
    () =>
      make(async () => JSON.stringify(data)).plan({
        ...body,
        characterMode: 'manual',
        characterSelections: [
          {
            sport: team.sport,
            team: team.team,
            sourceName: person.name,
            targetName: 'Target One',
          },
        ],
      }),
    (error) => error.getResponse().code === 'STORY_FACTS_REQUIRED',
  );
});

test('options validate modes, duplicate overrides, unselected teams and empty facts', async () => {
  for (const patch of [
    { characterMode: 'anything' },
    { teamFacts: [{ sport: 'AFL', team: 'Other', facts: 'x' }] },
    { teamFacts: [{ sport: 'AFL', team: team.team, facts: '' }] },
    {
      characterSelections: [
        { sport: 'AFL', team: team.team, sourceName: 'a', targetName: 'b' },
        { sport: 'AFL', team: team.team, sourceName: 'a', targetName: 'c' },
      ],
    },
  ]) {
    await a.rejects(
      () =>
        make(async () => {
          throw new Error('Should not call AI');
        }).plan({ ...body, ...patch }),
      (error) => error.getStatus() === 400,
    );
  }
});
