const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const {
  ContentHttpService,
} = require('../dist/modules/content/content-http.service.js');
const {
  ContentService,
} = require('../dist/modules/content/content.service.js');
const {
  ContentWorkflowService,
} = require('../dist/modules/content/content-workflow.service.js');
const { TrelloService } = require('../dist/modules/content/trello.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const fetchOriginal = global.fetch;
afterEach(() => {
  global.fetch = fetchOriginal;
});
const team = {
  sport: 'AFL',
  team: 'Adelaide Crows',
  categories: [44],
  headCoach: 'Coach Name',
  captain: 'Captain Name',
  players: ['Player One', 'Player Two'],
};
const config = {
  defaults: () => new ContentConfigService().defaults(),
  key: (name) => 'fake-' + name,
};
const generated = {
  title: 'Sample Title',
  caption: 'FICTION: Sample Caption',
  content: '<p>Player One plays AFL.</p><!--IMAGE: Player One action-->',
  sportTeam: 'AFL Adelaide Crows',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const articleText =
  'Title: Sample Title\nCaption: FICTION: Sample Caption\nContent:\n' +
  generated.content;

test('config copies five active teams, source list and separate original prompt', () => {
  const data = config.defaults();
  assert.equal(data.teams.length, 5);
  assert.deepEqual(
    data.teams.map((x) => x.categories),
    [[44], [45], [46], [47], [48]],
  );
  assert.equal(data.trello.limit, 1);
  assert.ok(data.prompt.includes('{{headCoachLine}}'));
  assert.ok(data.prompt.includes('FICTION: '));
  assert.equal(JSON.stringify(data).includes('tvly-'), false);
});
test('prompt interpolates data literally without running input expressions', () => {
  const service = new ContentService(config, {});
  const prompt = service.renderPrompt(
    {
      team,
      caption: 'literal ${process.env.SECRET} $&',
      content: '<p>Input</p>',
    },
    new Date('2026-10-25T00:00:00Z'),
  );
  assert.ok(prompt.includes('2026-10-25'));
  assert.ok(prompt.includes('literal ${process.env.SECRET} $&'));
  assert.ok(prompt.includes('- Head Coach: Coach Name'));
  assert.ok(prompt.includes('Player One, Player Two'));
  assert.equal(/\{\{\w+\}\}/.test(prompt), false);
});
test('Gemini URL, headers, body and retry options match active node', async () => {
  const http = {
    json: async (url, init, attempts, delay) => {
      assert.equal(
        url,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      );
      assert.deepEqual(init.headers, {
        'Content-Type': 'application/json',
        'X-goog-api-key': 'fake-GEMINI_API_KEY',
      });
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body), ['contents']);
      assert.equal(attempts, 5);
      assert.equal(delay, 5000);
      return { candidates: [{ content: { parts: [{ text: articleText }] } }] };
    },
  };
  const result = await new ContentService(config, http).generate({
    team,
    caption: 'Source caption',
    content: 'Source content',
  });
  assert.deepEqual(result, generated);
});
test('Gemini missing output is rejected rather than posting placeholder text', async () => {
  await assert.rejects(
    () =>
      new ContentService(config, {
        json: async () => ({ candidates: [] }),
      }).generate({ team, caption: 'Caption', content: 'Content' }),
    /no article text/,
  );
});
test('Serper and Tavily keep their original HTTP bodies and headers', async () => {
  const calls = [];
  const service = new ContentService(config, {
    json: async (...args) => {
      calls.push(args);
      return { images: [] };
    },
  });
  await service.searchImages('player action', 'serper');
  await service.searchImages('player action', 'tavily');
  assert.equal(calls[0][0], 'https://google.serper.dev/images');
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    q: 'player action',
    type: 'images',
    num: 15,
    engine: 'google',
  });
  assert.deepEqual(calls[0][1].headers, {
    'X-API-KEY': 'fake-SERPER_API_KEY',
    'Content-Type': 'application/json',
  });
  assert.equal(calls[1][0], 'https://api.tavily.com/search');
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    api_key: 'fake-TAVILY_API_KEY',
    query: 'player action',
    search_depth: 'advanced',
    include_images: true,
    max_results: 4,
  });
  assert.deepEqual(calls[1][1].headers, { 'Content-Type': 'application/json' });
});
for (const provider of ['serper', 'tavily'])
  test(
    provider + ' results insert images and produce verified thumbnail',
    async () => {
      const image =
        'https://images.example.test/player.jpg?width=1200&height=800';
      global.fetch = async (url, options) => {
        assert.equal(url, image);
        assert.equal(options.method, 'GET');
        return new Response(new Uint8Array(900), {
          headers: { 'content-type': 'image/jpeg' },
        });
      };
      const data =
        provider === 'serper'
          ? {
              searchParameters: { q: 'Player One action AFL' },
              images: [
                {
                  imageUrl: image,
                  imageWidth: 1200,
                  imageHeight: 800,
                  title: 'Player One',
                },
              ],
            }
          : { query: 'Player One action AFL', images: [image], results: [] };
      const service = new ContentService(config, { json: async () => data });
      const result = await service.images(generated, provider);
      assert.ok(result.content.includes('<img src="' + image + '"'));
      assert.equal(result.content.includes('[object Object]'), false);
      assert.equal(result.thumbnailUrl, image);
      assert.equal(result.caption, generated.caption);
    },
  );
test('missing placeholders and invalid providers are rejected before paid calls', async () => {
  const service = new ContentService(config, {
    json: async () => assert.fail('must not call API'),
  });
  await assert.rejects(() =>
    service.images(
      { ...generated, content: '<p>No placeholder</p>' },
      'serper',
    ),
  );
  await assert.rejects(() => service.searchImages('query', 'unknown'));
});
for (const [status, code] of [
  [429, 'PROVIDER_QUOTA_OR_RATE_LIMIT'],
  [432, 'PROVIDER_QUOTA_OR_RATE_LIMIT'],
  [401, 'PROVIDER_CREDENTIAL_INVALID'],
  [403, 'PROVIDER_CREDENTIAL_INVALID'],
])
  test(
    'provider ' +
      status +
      ' reports key name, never leaks secret and skips retry',
    async () => {
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return json({ error: 'secret-key-value' }, status);
      };
      await assert.rejects(
        () =>
          new ContentHttpService().json(
            'https://api.tavily.com/search',
            {},
            5,
            0,
          ),
        (error) => {
          const response = error.getResponse();
          assert.equal(response.code, code);
          assert.equal(response.apiKeyEnv, 'TAVILY_API_KEY');
          assert.equal(
            JSON.stringify(response).includes('secret-key-value'),
            false,
          );
          return true;
        },
      );
      assert.equal(calls, 1);
    },
  );
test('Gemini quota response identifies GEMINI_API_KEY', async () => {
  global.fetch = async () =>
    json({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429);
  await assert.rejects(
    () =>
      new ContentHttpService().json(
        'https://generativelanguage.googleapis.com/model',
      ),
    (e) => e.getResponse().apiKeyEnv === 'GEMINI_API_KEY',
  );
});
test('transient provider failure retries within the original maxTries', async () => {
  let count = 0;
  global.fetch = async () =>
    ++count < 3 ? json({ error: 'temporary' }, 503) : json({ ok: true });
  assert.deepEqual(
    await new ContentHttpService().json(
      'https://google.serper.dev/images',
      {},
      3,
      0,
    ),
    { ok: true },
  );
  assert.equal(count, 3);
});
test('Trello reads first card comment and posts caption to specified published card', async () => {
  const calls = [];
  const service = new TrelloService(config, {
    json: async (url, init) => {
      calls.push([new URL(url), init]);
      return calls.length === 1
        ? [{ id: 'source123', name: 'Caption' }]
        : calls.length === 2
          ? [{ data: { card: { name: 'Caption' }, text: 'Content' } }]
          : { id: 'comment123' };
    },
  });
  assert.deepEqual(await service.source(), {
    cardId: 'source123',
    caption: 'Caption',
    content: 'Content',
  });
  await service.comment('published123', 'FICTION: Rewritten');
  assert.equal(calls[0][0].searchParams.get('fields'), 'name');
  assert.equal(calls[1][0].searchParams.get('filter'), 'commentCard');
  assert.equal(calls[2][0].pathname, '/1/cards/published123/actions/comments');
  assert.equal(calls[2][0].searchParams.get('text'), 'FICTION: Rewritten');
  assert.equal(calls[2][1].method, 'POST');
});
function runner(options = {}) {
  const calls = [];
  const auth = new AuthService();
  auth.set('session');
  const articles = {
    createPost: async () => {
      calls.push('create');
      return 'post123';
    },
    generateSlug: () => 'sample-slug',
    updatePost: async (id, body) => {
      calls.push('update');
      assert.equal(body.featured_image, body.featured_image_thumbnail);
      if (options.updateFail) throw Error('update failed');
      return { body: { success: true } };
    },
    publishPost: async () => {
      calls.push('publish');
      return options.noCard
        ? { slug: 'sample-slug' }
        : { slug: 'sample-slug', trello: [{ cardId: 'published123' }] };
    },
  };
  const content = {
    validateTeam: () => {},
    generate: async () => {
      calls.push('generate');
      return generated;
    },
    images: async (_, provider) => {
      calls.push('images-' + provider);
      return { ...generated, thumbnailUrl: 'https://images.test/player.jpg' };
    },
  };
  const trello = {
    source: async () => ({
      cardId: 'source123',
      caption: 'Caption',
      content: 'Content',
    }),
    comment: async (id, text) => {
      calls.push('comment');
      assert.equal(id, 'published123');
      assert.equal(text, generated.caption);
    },
  };
  return {
    calls,
    auth,
    service: new ContentWorkflowService(
      config,
      content,
      trello,
      articles,
      auth,
      {
        batch: async (body) => {
          options.inspectBatch?.(body);
          calls.push('generate');
          return {
            success: true,
            analysis: options.analysis,
            results: [{ article: generated, requiresReview: options.reviewRequired, reviewWarnings: options.reviewRequired ? ['Identity mismatch'] : [] }],
          };
        },
      },
      { preflight: () => {} },
    ),
  };
}
test('full workflow updates before publishing and comments using publish response cardId', async () => {
  const { service, calls } = runner();
  const result = await service.run({ teams: [team], imageProvider: 'tavily' });
  assert.deepEqual(calls, [
    'generate',
    'create',
    'images-tavily',
    'update',
    'publish',
    'comment',
  ]);
  assert.equal(result.results[0].commented, true);
});
test('workflow ignores retired character controls and passes only source, note and full prompt to generation', async () => {
  const { service } = runner({
    inspectBatch: (body) => {
      assert.equal(body.characterMode, undefined);
      assert.equal(body.characterSelections, undefined);
      assert.equal(body.teamFacts, undefined);
      assert.equal(body.prompt, 'Keep the tone');
      assert.deepEqual(body.prompts, { rewrite: 'Full prompt' });
    },
  });
  const result = await service.run({
    teams: [team],
    imageProvider: 'tavily',
    characterMode: 'manual',
    characterSelections: [],
    teamFacts: [],
    prompt: 'Keep the tone',
    prompts: { rewrite: 'Full prompt' },
  });
  assert.equal('analysis' in result, false);
});

test('failed update stops before publish and returns failing stage/postId', async () => {
  const { service, calls } = runner({ updateFail: true });
  await assert.rejects(
    () => service.run({ teams: [team], imageProvider: 'serper' }),
    (e) => {
      assert.equal(e.getResponse().stage, 'update');
      assert.equal(e.getResponse().postId, 'post123');
      return true;
    },
  );
  assert.equal(calls.includes('publish'), false);
});
test('missing publish Trello data does not silently write to source card', async () => {
  const { service, calls } = runner({ noCard: true });
  await assert.rejects(
    () => service.run({ teams: [team], imageProvider: 'serper' }),
    (e) => {
      assert.equal(e.getResponse().stage, 'trello-comment');
      assert.equal(e.getResponse().published, true);
      return true;
    },
  );
  assert.equal(calls.includes('comment'), false);
});
test('missing auth token fails before external effects', async () => {
  const { service, calls, auth } = runner();
  await auth.deleteToken();
  await assert.rejects(
    () => service.run({ teams: [team], imageProvider: 'serper' }),
    /missing token/,
  );
  assert.deepEqual(calls, []);
});
test('missing credentials fail before draft creation', async () => {
  const { service, calls } = runner();
  service.config = {
    ...config,
    key: () => {
      throw Error('missing Trello credential');
    },
  };
  await assert.rejects(
    () => service.run({ teams: [team], imageProvider: 'serper' }),
    /missing Trello/,
  );
  assert.deepEqual(calls, []);
});

test('Nest route executes inline login -> source -> create -> Gemini -> images -> update -> publish -> published Trello comment', async () => {
  const { AppModule } = require('../dist/app.module.js');
  const request = require('supertest');
  const names = [
    'GEMINI_API_KEY',
    'SERPER_API_KEY',
    'TRELLO_API_KEY',
    'TRELLO_API_TOKEN',
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) process.env[name] = 'integration-test-' + name;
  const calls = [];
  let updated;
  const image = 'https://images.example.test/player.jpg?width=1200&height=800';
  global.fetch = async (raw, init = {}) => {
    const url = new URL(raw);
    if (url.pathname === '/api/auth/sign-in') {
      calls.push('login');
      return new Response('{"success":true}', {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'auth-session=integration-session; HttpOnly',
        },
      });
    }
    if (url.hostname === 'api.trello.com' && url.pathname.includes('/lists/')) {
      calls.push('source-card');
      return json([{ id: 'source123', name: 'Source Caption' }]);
    }
    if (
      url.hostname === 'api.trello.com' &&
      url.pathname.endsWith('/actions')
    ) {
      calls.push('source-comment');
      return json([
        { data: { card: { name: 'Source Caption' }, text: 'Source Content' } },
      ]);
    }
    if (url.pathname === '/api/posts' && init.method === 'POST') {
      calls.push('create');
      return json({ success: true, postId: '123456abcdef' }, 201);
    }
    if (url.hostname === 'generativelanguage.googleapis.com') {
      const payload = JSON.parse(init.body);
      if (payload.generationConfig) {
        calls.push('analyze');
        return json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: 'Source story',
                      characters: [],
                    }),
                  },
                ],
              },
            },
          ],
        });
      }
      calls.push('gemini');
      return json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: articleText.replaceAll('Player One', 'Adelaide Crows'),
                },
              ],
            },
          },
        ],
      });
    }
    if (url.hostname === 'google.serper.dev') {
      calls.push('search');
      return json({
        searchParameters: { q: 'Player One action AFL' },
        images: [
          {
            imageUrl: image,
            imageWidth: 1200,
            imageHeight: 800,
            title: 'Player One',
          },
        ],
      });
    }
    if (url.hostname === 'images.example.test') {
      calls.push('verify-image');
      return new Response(new Uint8Array(900), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    if (url.pathname === '/api/posts/123456abcdef' && init.method === 'PUT') {
      calls.push('update');
      updated = JSON.parse(init.body);
      return json({ success: true });
    }
    if (url.pathname.endsWith('/publish')) {
      calls.push('publish');
      assert.ok(updated);
      return json({
        success: true,
        slug: updated.slug,
        trello: [{ cardId: 'published123' }],
      });
    }
    if (
      url.hostname === 'api.trello.com' &&
      url.pathname === '/1/cards/published123/actions/comments'
    ) {
      calls.push('trello-comment');
      assert.equal(url.searchParams.get('text'), generated.caption);
      return json({ id: 'comment123' });
    }
    throw Error('Unexpected fake URL ' + url.hostname + url.pathname);
  };
  const {Test}=require('@nestjs/testing');
  const {CharacterRotationService}=require('../dist/modules/content/character-rotation.service.js');
  const fixture=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(CharacterRotationService).useValue({
    begin:async()=>({excluded:[]}), writerTeam:team=>team, directive:()=>'', complete:async()=>({selected:[],excluded:[],cycle:1}), release:async()=>{},
  }).compile();
  const app=fixture.createNestApplication({logger:false});
  app.setGlobalPrefix('api');
  await app.init();
  try {
    const api = request(app.getHttpServer());
    const defaults = await api.get('/api/content/config').expect(200);
    assert.equal(
      JSON.stringify(defaults.body).includes('integration-test-'),
      false,
    );
    const result = await api
      .post('/api/content/run')
      .send({
        login: { username: 'test-user', password: 'test-password' },
        teams: [team],
        imageProvider: 'serper',
        slugSuffix: 'ngocthao123-team-spark',
      })
      .expect(201);
    assert.equal(result.body.success, true);
    assert.equal(result.body.results[0].cardId, 'published123');
    assert.equal(updated.slug, 'sample-title-ngocthao123-team-spark-abcdef');
    assert.deepEqual(calls, [
      'login',
      'source-card',
      'source-comment',
      'gemini',
      'create',
      'search',
      'verify-image',
      'update',
      'publish',
      'trello-comment',
    ]);
  } finally {
    await app.close();
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  }
});

test('an article that contradicts its character directive remains reviewable and never creates/publishes/comments',async()=>{
 const {service,calls}=runner({reviewRequired:true});
 const result=await service.run({teams:[team],imageProvider:'tavily'});
 assert.equal(result.success,false);assert.equal(result.results[0].stage,'review');assert.equal(result.results[0].requiresReview,true);assert.ok(result.results[0].article);assert.deepEqual(calls,['generate']);
});
