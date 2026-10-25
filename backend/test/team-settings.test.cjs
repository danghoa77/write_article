const { test } = require('node:test');
const a = require('node:assert/strict');
const {
  TeamSettingsService,
} = require('../dist/modules/content/team-settings.service.js');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const {
  ContentService,
} = require('../dist/modules/content/content.service.js');
const {
  CharacterSelectionService,
} = require('../dist/modules/content/character-selection.service.js');
const {
  ContentWorkflowService,
} = require('../dist/modules/content/content-workflow.service.js');
const config = new ContentConfigService();
const content = new ContentService(config, {});
const selection = new CharacterSelectionService(config, {}, content);
const picks = [
  { team: 'Adelaide Crows', sport: 'AFL' },
  { team: 'Denver Broncos', sport: 'NFL' },
  { team: 'New England Patriots', sport: 'NFL' },
];

function fakeFirebase() {
  const data = new Map();
  const ref = (path) => ({
    path,
    collection: (name) => ref(path + '/' + name),
    doc: (name) => ref(path + '/' + name),
    get: async () => ({ data: () => structuredClone(data.get(path)) }),
  });
  return {
    data,
    user: async (token) => {
      if (token === 'bad')
        throw new (require('@nestjs/common').UnauthorizedException)('Expired');
      return { uid: token };
    },
    database: () => ({
      collection: (name) => ref(name),
      runTransaction: async (fn) =>
        fn({
          get: (reference) => reference.get(),
          set: (reference, value) =>
            data.set(reference.path, structuredClone(value)),
        }),
    }),
  };
}
const settings = (firebase = fakeFirebase()) =>
  new TeamSettingsService(firebase, config, content, selection);

test('deleting every lineup persists an empty catalog without resurrecting defaults', async () => {
  const service = settings();
  await service.update('a', { revision: 0, teams: [] });
  a.deepEqual((await service.get('a')).teams, []);
  a.deepEqual(await service.resolveForUser(undefined, 'a'), []);
});

test('mixed AFL/NFL selections resolve complete imported rosters, coach and categories in request order', async () => {
  const teams = await settings().resolve(picks);
  a.deepEqual(
    teams.map((team) => team.team),
    picks.map((team) => team.team),
  );
  a.deepEqual(
    teams.map((team) => team.categories),
    [[44], [48], [45]],
  );
  a.deepEqual(
    teams.map((team) => team.headCoach),
    ['Matthew Nicks', 'Sean Payton', 'Mike Vrabel'],
  );
  a.ok(teams.every((team) => team.players.length > 30));
  const normalized = await settings().resolve([
    { team: '  denver  BRONCOS ', sport: 'nfl football' },
  ]);
  a.equal(normalized[0].team, 'Denver Broncos');
});

test('unknown, wrong-sport, duplicate or malformed selections fail before any workflow call', async () => {
  for (const input of [
    [],
    [null],
    [2],
    [{ team: 'Denver Broncos', sport: 'AFL' }],
    [...picks, { team: 'Denver Broncos', sport: 'NFL Football' }],
    [{ ...picks[0], headCoach: 'Override' }],
    [{ ...picks[0], players: [] }],
  ]) {
    await a.rejects(
      () => settings().resolve(input),
      (error) => error.getStatus() === 400,
    );
  }
});

test('saved lineup survives service recreation, is isolated by user and is resolved by team and sport', async () => {
  const firebase = fakeFirebase();
  const service = settings(firebase);
  const before = await service.get('a');
  a.equal(before.revision, 0);
  a.equal(firebase.data.size, 0);
  const teams = structuredClone(before.teams);
  teams.find((team) => team.team === 'Denver Broncos').players = [
    'Imported Player',
  ];
  await service.update('a', { revision: 0, teams });
  const saved = await settings(firebase).resolve(picks, 'Bearer a');
  a.deepEqual(saved[1].players, ['Imported Player']);
  a.ok((await service.resolve(picks, 'Bearer b'))[1].players.length > 30);
  a.deepEqual(
    (await service.resolve(picks))[1].players,
    config.defaults().teams[4].players,
  );
  await a.rejects(
    () => service.update('a', { revision: 0, teams }),
    (error) => error.getStatus() === 409,
  );
  await a.rejects(
    () => service.resolve(picks, 'Bearer bad'),
    (error) => error.getStatus() === 401,
  );
  await a.rejects(
    () => service.resolve(picks, 'bad'),
    (error) => error.getStatus() === 401,
  );
});

test('incomplete or conflicting saved lineups are rejected without persisting', async () => {
  const firebase = fakeFirebase();
  const service = settings(firebase);
  const team = config.defaults().teams[0];
  for (const teams of [
    [{ ...team, players: [] }],
    [{ ...team, categories: [] }],
    [team, team],
    [
      {
        ...team,
        personnel: [
          {
            name: team.players[0],
            role: 'player',
            status: 'former',
            careerStage: 'veteran',
            importance: 'star',
            traits: [],
          },
        ],
      },
    ],
  ]) {
    await a.rejects(
      () => service.update('a', { revision: 0, teams }),
      (error) => error.getStatus() === 400,
    );
  }
  a.equal(firebase.data.size, 0);
});

function workflow(options = {}) {
  const updates = new Map();
  const events = [];
  const comments = [];
  let counter = 0;
  let sourceReads = 0;
  const service = new ContentWorkflowService(
    config,
    {
      validateTeam: (team) => content.validateTeam(team),
      images: async (article) => ({
        ...article,
        thumbnailUrl: 'https://images.test/photo.jpg',
      }),
    },
    {
      source: async () => {
        sourceReads++;
        return {
          cardId: 'source-card',
          caption: 'Shared caption',
          content: 'Shared content',
        };
      },
      comment: async (id, caption) => {
        comments.push({ id, caption });
        events.push('comment:' + id);
      },
    },
    {
      createPost: async () => 'post-' + ++counter,
      generateSlug: ({ postId }) => 'slug-' + postId,
      updatePost: async (id, body) => {
        events.push('update:' + id);
        if (body.title === options.updateFail) throw Error('Update failed');
        updates.set(id, body);
      },
      publishPost: async (id) => {
        a.ok(updates.has(id));
        events.push('publish:' + id);
        return {
          slug: updates.get(id).slug,
          trello: [{ cardId: 'card-' + id }],
        };
      },
    },
    { get: () => 'session' },
    {
      batch: async (body) => {
        a.equal(body.caption, 'Shared caption');
        a.equal(body.content, 'Shared content');
        return {
          success: !options.writeFail,
          results: body.teams.map((team) =>
            team.team === options.writeFail
              ? {
                  success: false,
                  statusCode: 422,
                  error: { message: 'Writing failed' },
                }
              : {
                  success: true,
                  article: {
                    title: team.team,
                    caption: 'Caption ' + team.team,
                    content: '<p>' + team.team + '</p>',
                  },
                },
          ),
        };
      },
    },
    { preflight: () => {} },
  );
  return { service, updates, events, comments, sourceReads: () => sourceReads };
}

test('one batch reads source once and publishes each sport/team to its own returned Trello card', async () => {
  const teams = await settings().resolve(picks);
  const run = workflow();
  const original = process.env.TRELLO_API_KEY;
  const originalToken = process.env.TRELLO_API_TOKEN;
  const originalImage = process.env.TAVILY_API_KEY;
  process.env.TRELLO_API_KEY =
    process.env.TRELLO_API_TOKEN =
    process.env.TAVILY_API_KEY =
      'mock';
  try {
    const result = await run.service.run({
      teams,
      imageProvider: 'tavily',
      concurrency: 3,
    });
    a.equal(run.sourceReads(), 1);
    a.deepEqual(result.summary, { total: 3, succeeded: 3, failed: 0 });
    a.equal(result.success, true);
    a.deepEqual(
      run.comments,
      teams.map((team, i) => ({
        id: 'card-post-' + (i + 1),
        caption: 'Caption ' + team.team,
      })),
    );
    a.deepEqual(
      [...run.updates.values()].map((body) => body.categories),
      [[44], [48], [45]],
    );
    for (let i = 1; i <= 3; i++)
      a.ok(
        run.events.indexOf('update:post-' + i) <
          run.events.indexOf('publish:post-' + i),
      );
  } finally {
    for (const [key, value] of Object.entries({
      TRELLO_API_KEY: original,
      TRELLO_API_TOKEN: originalToken,
      TAVILY_API_KEY: originalImage,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('batch continues other teams after a writing or update failure and reports exact failed stage', async () => {
  const teams = await settings().resolve(picks);
  for (const option of [
    { writeFail: 'Denver Broncos' },
    { updateFail: 'Denver Broncos' },
  ]) {
    const run = workflow(option);
    run.service.config = { key: () => 'mock' };
    const result = await run.service.run({ teams, imageProvider: 'tavily' });
    a.equal(result.success, false);
    a.equal(result.partialSuccess, true);
    a.deepEqual(result.summary, { total: 3, succeeded: 2, failed: 1 });
    a.equal(result.results[1].team, 'Denver Broncos');
    a.equal(result.results[1].stage, option.writeFail ? 'generate' : 'update');
    a.equal(result.results[2].published, true);
    a.equal(run.comments.length, 2);
    a.equal(
      [...run.updates.values()].some((body) => body.title === 'Denver Broncos'),
      false,
    );
  }
});

test('routes protect saved lineups and resolve minimal team selections before invoking workflow', async () => {
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('../dist/app.module.js');
  const {
    FirebaseService,
  } = require('../dist/modules/firebase/firebase.service.js');
  const request = require('supertest');
  const calls = [];
  const fixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseService)
    .useValue(fakeFirebase())
    .overrideProvider(ContentWorkflowService)
    .useValue({
      run: async (body) => {
        calls.push(body);
        return { success: true };
      },
    })
    .compile();
  const app = fixture.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  try {
    const api = request(app.getHttpServer());
    await api.get('/api/content/teams').expect(401);
    const saved = await api
      .get('/api/content/teams')
      .set('Authorization', 'Bearer a')
      .expect(200);
    saved.body.teams[0].players = ['My lineup'];
    await api
      .put('/api/content/teams')
      .set('Authorization', 'Bearer a')
      .send({ revision: 0, teams: saved.body.teams })
      .expect(200);
    await api
      .post('/api/content/run')
      .set('Authorization', 'Bearer a')
      .send({ teams: picks, imageProvider: 'tavily' })
      .expect(201);
    a.deepEqual(calls[0].teams[0].players, ['My lineup']);
    a.deepEqual(
      calls[0].teams.map((team) => team.categories),
      [[44], [48], [45]],
    );
    await api
      .post('/api/content/run')
      .send({
        teams: [{ team: 'Unknown', sport: 'NFL' }],
        imageProvider: 'tavily',
      })
      .expect(400);
    a.equal(calls.length, 1);
  } finally {
    await app.close();
  }
});
