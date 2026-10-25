const { test, afterEach } = require('node:test');
const a = require('node:assert/strict');
const {
  WorkspaceSettingsService,
} = require('../dist/modules/content/workspace-settings.service.js');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const {
  ContentHttpService,
} = require('../dist/modules/content/content-http.service.js');
const originalFetch = global.fetch;
const originalKey = process.env.WORKSPACE_ENCRYPTION_KEY;
afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.WORKSPACE_ENCRYPTION_KEY;
  else process.env.WORKSPACE_ENCRYPTION_KEY = originalKey;
});
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
    database: () => ({
      collection: (name) => ref(name),
      runTransaction: async (fn) =>
        fn({
          get: (r) => r.get(),
          set: (r, v) => data.set(r.path, structuredClone(v)),
        }),
    }),
  };
}
function fixture() {
  process.env.WORKSPACE_ENCRYPTION_KEY = 'test-only-unique-encryption-key';
  const firebase = fakeFirebase(),
    config = new ContentConfigService();
  return {
    firebase,
    config,
    service: new WorkspaceSettingsService(firebase, config),
  };
}
test('provider keys are encrypted at rest, never returned, and isolated by account', async () => {
  const { service, firebase, config } = fixture();
  const saved = await service.update('a', {
    revision: 0,
    secrets: { GEMINI_API_KEY: 'private-user-a' },
  });
  a.equal(saved.credentials.GEMINI_API_KEY.configured, true);
  a.equal(JSON.stringify(saved).includes('private-user-a'), false);
  a.equal(
    JSON.stringify([...firebase.data.values()]).includes('private-user-a'),
    false,
  );
  a.equal((await service.get('b')).credentials.GEMINI_API_KEY.saved, false);
  a.equal(
    await service.execute('a', async () => config.key('GEMINI_API_KEY')),
    'private-user-a',
  );
  a.equal(config.value('GEMINI_API_KEY'), process.env.GEMINI_API_KEY);
});
test('parallel user executions keep distinct provider keys and models', async () => {
  const { service, config } = fixture();
  await service.update('a', {
    revision: 0,
    secrets: { GEMINI_API_KEY: 'a-key' },
    settings: { geminiModel: 'a-model' },
  });
  await service.update('b', {
    revision: 0,
    secrets: { GEMINI_API_KEY: 'b-key' },
    settings: { geminiModel: 'b-model' },
  });
  const rows = await Promise.all(
    ['a', 'b'].map((uid) =>
      service.execute(uid, async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, uid === 'a' ? 10 : 1),
        );
        return [config.key('GEMINI_API_KEY'), config.value('GEMINI_MODEL')];
      }),
    ),
  );
  a.deepEqual(rows, [
    ['a-key', 'a-model'],
    ['b-key', 'b-model'],
  ]);
});
test('explicit credential deletion disables inherited environment key and persists after reload', async () => {
  const { service, config } = fixture();
  await service.update('a', { revision: 0, secrets: { GEMINI_API_KEY: null } });
  a.equal(
    (await service.get('a')).credentials.GEMINI_API_KEY.configured,
    false,
  );
  await a.rejects(
    () => service.execute('a', async () => config.key('GEMINI_API_KEY')),
    (error) => error.getStatus() === 503,
  );
});
test('quota and invalid keys persist red status; successful use or key replacement clears it', async () => {
  const { service, config } = fixture(),
    http = new ContentHttpService(config);
  await service.update('a', {
    revision: 0,
    secrets: { TAVILY_API_KEY: 'old-key', SERPER_API_KEY: 'search-key' },
  });
  global.fetch = async () =>
    new Response(JSON.stringify({ detail: 'Insufficient credits' }), {
      status: 432,
    });
  await a.rejects(
    () =>
      service.execute('a', () => http.json('https://api.tavily.com/search')),
    (error) => error.getResponse().failureKind === 'quota',
  );
  a.equal((await service.get('a')).providers.tavily.status, 'quota');
  global.fetch = async () =>
    new Response(JSON.stringify({ message: 'Invalid API key' }), {
      status: 403,
    });
  await a.rejects(() =>
    service.execute('a', () => http.json('https://google.serper.dev/images')),
  );
  a.equal((await service.get('a')).providers.serper.status, 'invalid');
  await service.update('a', {
    revision: 1,
    secrets: { TAVILY_API_KEY: 'new-key' },
  });
  a.equal((await service.get('a')).providers.tavily.status, 'unverified');
  global.fetch = async () => new Response('{"results":[]}', { status: 200 });
  await service.execute('a', () => http.json('https://api.tavily.com/search'));
  a.equal((await service.get('a')).providers.tavily.status, 'ready');
});
test('429 rate limiting is distinguished from exhausted credits', async () => {
  const { service, config } = fixture(),
    http = new ContentHttpService(config);
  await service.update('a', {
    revision: 0,
    secrets: { TAVILY_API_KEY: 'test-key' },
  });
  global.fetch = async () =>
    new Response('{"message":"Too many requests"}', { status: 429 });
  await a.rejects(() =>
    service.execute('a', () => http.json('https://api.tavily.com/search')),
  );
  a.equal((await service.get('a')).providers.tavily.status, 'rate_limit');
});

test('saving the identical exhausted key does not reset its red status', async () => {
  const { service, config } = fixture();
  await service.update('a', {
    revision: 0,
    secrets: { TAVILY_API_KEY: 'same-key' },
  });
  await service.execute('a', async () => config.observe('tavily', 'quota'));
  await service.update('a', {
    revision: 1,
    secrets: { TAVILY_API_KEY: 'same-key' },
  });
  a.equal((await service.get('a')).providers.tavily.status, 'quota');
});
test('a late failure for an old key cannot mark its replacement red', async () => {
  const { service, config } = fixture();
  await service.update('a', {
    revision: 0,
    secrets: { TAVILY_API_KEY: 'old-key' },
  });
  await service.execute('a', async () => {
    await service.update('a', {
      revision: 1,
      secrets: { TAVILY_API_KEY: 'new-key' },
    });
    config.observe('tavily', 'quota');
  });
  a.equal((await service.get('a')).providers.tavily.status, 'unverified');
});
test('same batch retains a quota failure even if another parallel call succeeds', async () => {
  const { service, config } = fixture();
  await service.update('a', {
    revision: 0,
    secrets: { TAVILY_API_KEY: 'a-key' },
  });
  await service.execute('a', async () => {
    config.observe('tavily', 'quota');
    config.observe('tavily', 'ready');
  });
  a.equal((await service.get('a')).providers.tavily.status, 'quota');
});
test('workspace settings persist default slug and category create/edit/delete with revision protection', async () => {
  const { service } = fixture();
  a.equal((await service.get('a')).settings.slugSuffix, 'danghoa123');
  const saved = await service.update('a', {
    revision: 0,
    settings: {
      categories: [{ id: 49, name: 'Custom category' }],
    },
  });
  a.deepEqual(saved.settings.categories, [{ id: 49, name: 'Custom category' }]);
  await service.update('a', {
    revision: 1,
    settings: { categories: [{ id: 50, name: 'Renamed' }] },
  });
  await service.update('a', { revision: 2, settings: { categories: [] } });
  a.deepEqual((await service.get('a')).settings.categories, []);
  a.equal('note' in (await service.get('a')).settings, false);
  await a.rejects(
    () =>
      service.update('a', {
        revision: 1,
        settings: { slugSuffix: 'outdated' },
      }),
    (error) => error.getStatus() === 409,
  );
});
test('unknown secret names, invalid categories and global notes are rejected before saving', async () => {
  const { service, firebase } = fixture();
  for (const body of [
    { secrets: { FIREBASE_SERVICE_ACCOUNT_JSON: 'not-allowed' } },
    {
      settings: {
        categories: [
          { id: 44, name: 'A' },
          { id: 44, name: 'B' },
        ],
      },
    },
    { settings: { note: 'Notes belong to individual source stories' } },
    { settings: { categories: [{ id: -1, name: 'Bad' }] } },
  ])
    await a.rejects(
      () => service.update('a', { revision: 0, ...body }),
      (error) => error.getStatus() === 400,
    );
  a.equal(firebase.data.size, 0);
});
test('content library supports create, edit, delete, account isolation and conflicts', async () => {
  const { service } = fixture();
  const item = {
    id: 'sample-1',
    title: 'Saved story',
    caption: 'Caption',
    content: 'Story content',
  };
  await service.saveLibrary('a', { revision: 0, items: [item] });
  await service.saveLibrary('a', {
    revision: 1,
    items: [{ ...item, caption: 'Changed caption' }],
  });
  a.equal((await service.library('a')).items[0].caption, 'Changed caption');
  a.deepEqual((await service.library('b')).items, []);
  await a.rejects(
    () => service.saveLibrary('a', { revision: 1, items: [] }),
    (error) => error.getStatus() === 409,
  );
  await service.saveLibrary('a', { revision: 2, items: [] });
  a.deepEqual((await service.library('a')).items, []);
});

test('content notes stay with each saved story and legacy samples have an empty note', async () => {
  const { service, firebase } = fixture();
  const first = { id: 'first', title: 'First', caption: 'Caption A', content: 'Content A', note: 'Rule A' };
  const second = { id: 'second', title: 'Second', caption: 'Caption B', content: 'Content B', note: 'Rule B' };
  await service.saveLibrary('a', { revision: 0, items: [first, second] });
  a.deepEqual((await service.library('a')).items, [first, second]);
  await service.saveLibrary('a', { revision: 1, items: [{ ...first, note: 'Edited A' }, second] });
  a.equal((await service.library('a')).items[0].note, 'Edited A');
  a.equal((await service.library('a')).items[1].note, 'Rule B');
  for (const note of [123, null, 'x'.repeat(30001)]) {
    await a.rejects(() => service.saveLibrary('a', { revision: 2, items: [{ ...first, note }] }),
      error => error.getStatus() === 400);
  }
  firebase.data.set('users/legacy/settings/library', {
    items: [{ id: 'old', title: 'Old sample', caption: 'Caption', content: 'Content' }], revision: 1,
  });
  a.equal((await service.library('legacy')).items[0].note, '');
  firebase.data.set('users/legacy/settings/workspace', { settings: { note: 'Old global rule' } });
  a.equal('note' in (await service.get('legacy')).settings, false);
  await service.update('legacy', { revision: 0, settings: { slugSuffix: 'custom' } });
  a.equal('note' in firebase.data.get('users/legacy/settings/workspace').settings, false);
});
test('workspace routes enforce session ownership and keep the original source Trello request', async () => {
  const { firebase, config } = fixture();
  const { Test } = require('@nestjs/testing'),
    { AppModule } = require('../dist/app.module.js'),
    {
      FirebaseService,
    } = require('../dist/modules/firebase/firebase.service.js'),
    {
      ContentWorkflowService,
    } = require('../dist/modules/content/content-workflow.service.js');
  const { AuthService } = require('../dist/auth/auth.service.js');
  const request = require('supertest');
  const auth = new AuthService();
  auth.login = async () => {
    auth.set('upstream', Date.now() + 3600000);
    return 'upstream';
  };
  const calls = [];
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseService)
    .useValue(firebase)
    .overrideProvider(AuthService)
    .useValue(auth)
    .overrideProvider(ContentWorkflowService)
    .useValue({
      run: async (body) => {
        calls.push(body);
        return { success: true, results: [] };
      },
    })
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  const originalSecret = process.env.BROWSER_SESSION_SECRET;
  process.env.BROWSER_SESSION_SECRET = 'workspace-route-test';
  try {
    const http = request(app.getHttpServer());
    await http.get('/api/workspace/settings').expect(401);
    await http.get('/api/workspace/library').expect(401);
    const login = await http
      .post('/api/auth/browser/login')
      .send({ username: 'owner', password: 'test' })
      .expect(201);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const saved = await http
      .patch('/api/workspace/settings')
      .set('Cookie', cookie)
      .send({
        revision: 0,
        secrets: {
          GEMINI_API_KEY: 'owner-key',
          TRELLO_API_KEY: 'trello-test',
          TRELLO_API_TOKEN: 'token-test',
        },
      })
      .expect(200);
    a.equal(JSON.stringify(saved.body).includes('owner-key'), false);
    global.fetch = async (raw) => {
      const url = new URL(raw);
      a.equal(url.searchParams.get('key'), 'trello-test');
      a.equal(url.searchParams.get('token'), 'token-test');
      if (url.pathname.includes('/lists/')) {
        a.equal(
          url.pathname,
          '/1/lists/' + config.defaults().trello.listId + '/cards',
        );
        a.equal(url.searchParams.get('fields'), 'name');
        a.equal(url.searchParams.get('limit'), '1');
        return new Response('[{"id":"card123","name":"Original caption"}]');
      }
      return new Response(
        '[{"data":{"text":"Original content","card":{"name":"Original caption"}}}]',
      );
    };
    const source = await http
      .get('/api/workspace/source')
      .set('Cookie', cookie)
      .expect(200);
    a.equal(source.body.content, 'Original content');
    await http
      .post('/api/workspace/run')
      .set('Cookie', cookie)
      .send({
        teams: [{ team: 'Adelaide Crows', sport: 'AFL' }],
        imageProvider: 'tavily',
      })
      .expect(201);
    a.equal(calls[0].slugSuffix, 'danghoa123');
    a.equal(calls[0].prompt, '');
    for (const [caption, prompt] of [['Caption A', 'Rule A'], ['Caption B', 'Rule B'], ['Caption C', undefined]]) {
      await http.post('/api/workspace/run').set('Cookie', cookie).send({
        caption, content: 'Content for ' + caption, prompt,
        teams: [{ team: 'Adelaide Crows', sport: 'AFL' }], imageProvider: 'tavily',
      }).expect(201);
    }
    a.deepEqual(calls.slice(1).map(body => body.prompt), ['Rule A', 'Rule B', '']);
    await http
      .put('/api/workspace/library')
      .set('Cookie', cookie)
      .send({
        revision: 0,
        items: [
          {
            id: 'my-story',
            title: 'My story',
            caption: 'Caption',
            content: 'Content',
          },
        ],
      })
      .expect(200);
    a.ok(
      [...firebase.data.keys()].every((path) =>
        path.startsWith('users/tinfos%3Aowner/'),
      ),
    );
  } finally {
    await app.close();
    if (originalSecret === undefined) delete process.env.BROWSER_SESSION_SECRET;
    else process.env.BROWSER_SESSION_SECRET = originalSecret;
  }
});
