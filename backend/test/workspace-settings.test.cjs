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
const providerEnvNames = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'TAVILY_API_KEY',
  'SERPER_API_KEY',
];
const originalProviderEnv = Object.fromEntries(
  providerEnvNames.map((name) => [name, process.env[name]]),
);
afterEach(() => {
  global.fetch = originalFetch;
  for (const name of providerEnvNames) {
    if (originalProviderEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalProviderEnv[name];
  }
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
  for (const name of providerEnvNames) process.env[name] = '';
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
  const first = {
    id: 'first',
    title: 'First',
    caption: 'Caption A',
    content: 'Content A',
    note: 'Rule A',
  };
  const second = {
    id: 'second',
    title: 'Second',
    caption: 'Caption B',
    content: 'Content B',
    note: 'Rule B',
  };
  await service.saveLibrary('a', { revision: 0, items: [first, second] });
  a.deepEqual((await service.library('a')).items, [first, second]);
  await service.saveLibrary('a', {
    revision: 1,
    items: [{ ...first, note: 'Edited A' }, second],
  });
  a.equal((await service.library('a')).items[0].note, 'Edited A');
  a.equal((await service.library('a')).items[1].note, 'Rule B');
  for (const note of [123, null, 'x'.repeat(30001)]) {
    await a.rejects(
      () =>
        service.saveLibrary('a', { revision: 2, items: [{ ...first, note }] }),
      (error) => error.getStatus() === 400,
    );
  }
  firebase.data.set('users/legacy/settings/library', {
    items: [
      {
        id: 'old',
        title: 'Old sample',
        caption: 'Caption',
        content: 'Content',
      },
    ],
    revision: 1,
  });
  a.equal((await service.library('legacy')).items[0].note, '');
  firebase.data.set('users/legacy/settings/workspace', {
    settings: { note: 'Old global rule' },
  });
  a.equal('note' in (await service.get('legacy')).settings, false);
  await service.update('legacy', {
    revision: 0,
    settings: { slugSuffix: 'custom' },
  });
  a.equal(
    'note' in firebase.data.get('users/legacy/settings/workspace').settings,
    false,
  );
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
  const scans = [];
  const previews = [];
  const scanned = {
    summary: 'Source scan only',
    scan: {
      storyType: 'lifestyle',
      identityCase: 'none',
      eventSpecific: 'none',
      reason: 'Anonymous source.',
    },
    characters: [],
  };
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
    .overrideProvider(
      require('../dist/modules/content/character-selection.service.js')
        .CharacterSelectionService,
    )
    .useValue({
      analyze: async (body) => {
        scans.push(body);
        return scanned;
      },
    })
    .overrideProvider(
      require('../dist/modules/content/content-generation.service.js')
        .ContentGenerationService,
    )
    .useValue({
      batch: async (body) => {
        previews.push(body);
        return { success: true, analysis: scanned, plans: [], results: [] };
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
    await http
      .patch('/api/workspace/api-keys')
      .send({
        revision: 0,
        provider: 'gemini',
        action: 'add',
        label: 'Unauthorized',
        key: 'not-saved',
      })
      .expect(401);
    await http.get('/api/workspace/library').expect(401);
    await http.post('/api/workspace/analyze').send({}).expect(404);
    await http.post('/api/workspace/preview').send({}).expect(401);
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
      .post('/api/workspace/analyze')
      .set('Cookie', cookie)
      .send({})
      .expect(404);
    await http
      .post('/api/workspace/preview')
      .set('Cookie', cookie)
      .send({
        caption: 'Preview',
        content: 'Source',
        teams: [{ sport: 'AFL', team: 'Adelaide Crows' }],
        prompts: { writer: 'STALE CLIENT WRITER' },
      })
      .expect(201);
    a.equal(calls.length, 0);
    a.notEqual(previews[0].prompts.writer, 'STALE CLIENT WRITER');
    a.ok(previews[0].prompts.rewrite.includes('20. Current Roster'));
    a.deepEqual(Object.keys(previews[0].prompts), ['rewrite']);
    await http
      .post('/api/workspace/preview')
      .set('Cookie', cookie)
      .send({
        caption: 'Preview',
        content: 'Source',
        teams: [{ sport: 'AFL', team: 'Adelaide Crows' }],
        promptVersion: 'n8n-rules-v2',
        promptRevision: 999,
      })
      .expect(409);
    a.equal(previews.length, 1);
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
    for (const [caption, prompt] of [
      ['Caption A', 'Rule A'],
      ['Caption B', 'Rule B'],
      ['Caption C', undefined],
    ]) {
      await http
        .post('/api/workspace/run')
        .set('Cookie', cookie)
        .send({
          caption,
          content: 'Content for ' + caption,
          prompt,
          teams: [{ team: 'Adelaide Crows', sport: 'AFL' }],
          imageProvider: 'tavily',
        })
        .expect(201);
    }
    a.deepEqual(
      calls.slice(1).map((body) => body.prompt),
      ['Rule A', 'Rule B', ''],
    );
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
    const poolAdded = await http
      .patch('/api/workspace/api-keys')
      .set('Cookie', cookie)
      .send({
        revision: 1,
        provider: 'gemini',
        action: 'add',
        label: 'Backup account',
        key: 'route-private-backup',
      })
      .expect(200);
    a.equal(poolAdded.body.keyPools.gemini.length, 2);
    a.equal(
      JSON.stringify(poolAdded.body).includes('route-private-backup'),
      false,
    );
    await http
      .patch('/api/workspace/api-keys')
      .set('Cookie', cookie)
      .send({
        revision: 1,
        provider: 'gemini',
        action: 'delete',
        id: poolAdded.body.keyPools.gemini[1].id,
      })
      .expect(409);
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

test('eight Gemini account keys are encrypted, labelled, manually selected and isolated', async () => {
  const { service, firebase, config } = fixture();
  let revision = 0;
  for (let i = 1; i <= 8; i++) {
    const r = await service.manageKeys('pool-user', {
      revision: revision++,
      provider: 'gemini',
      action: 'add',
      label: 'Account ' + i,
      key: 'gemini-private-' + i,
    });
    a.equal(r.keyPools.gemini.length, i);
  }
  const saved = await service.get('pool-user');
  a.equal(saved.keyPools.gemini.filter((k) => k.active).length, 1);
  a.equal(
    await service.execute('pool-user', async () =>
      config.key('GEMINI_API_KEY'),
    ),
    'gemini-private-1',
  );
  a.equal(JSON.stringify(saved).includes('gemini-private-'), false);
  a.equal(
    JSON.stringify([...firebase.data.values()]).includes('gemini-private-'),
    false,
  );
  const last = saved.keyPools.gemini[7];
  await service.manageKeys('pool-user', {
    revision: revision++,
    provider: 'gemini',
    action: 'select',
    id: last.id,
  });
  a.equal(
    await service.execute('pool-user', async () =>
      config.key('GEMINI_API_KEY'),
    ),
    'gemini-private-8',
  );
  a.equal((await service.get('other-account')).keyPools.gemini.length, 0);
});

test('legacy active key migrates without loss, adding backup does not switch it', async () => {
  const { service, config } = fixture();
  await service.update('legacy', {
    revision: 0,
    secrets: { GEMINI_API_KEY: 'original-key' },
  });
  const result = await service.manageKeys('legacy', {
    revision: 1,
    provider: 'gemini',
    action: 'add',
    label: 'Backup',
    key: 'backup-key',
  });
  a.equal(result.keyPools.gemini.length, 2);
  a.equal(
    await service.execute('legacy', async () => config.key('GEMINI_API_KEY')),
    'original-key',
  );
});

test('Gemini quota state follows key when selecting away and back; reuse is explicit', async () => {
  const { service, config } = fixture();
  let revision = 0;
  await service.manageKeys('a', {
    revision: revision++,
    provider: 'gemini',
    action: 'add',
    label: 'A',
    key: 'key-a',
  });
  await service.manageKeys('a', {
    revision: revision++,
    provider: 'gemini',
    action: 'add',
    label: 'B',
    key: 'key-b',
  });
  let saved = await service.get('a');
  const [first, second] = saved.keyPools.gemini;
  await service.execute('a', async () => config.observe('gemini', 'quota'));
  await service.manageKeys('a', {
    revision: revision++,
    provider: 'gemini',
    action: 'select',
    id: second.id,
  });
  a.equal((await service.get('a')).providers.gemini.status, 'unverified');
  await service.manageKeys('a', {
    revision: revision++,
    provider: 'gemini',
    action: 'select',
    id: first.id,
  });
  a.equal((await service.get('a')).providers.gemini.status, 'quota');
  await service.manageKeys('a', {
    revision: revision++,
    provider: 'gemini',
    action: 'reuse',
    id: first.id,
  });
  a.equal((await service.get('a')).providers.gemini.status, 'unverified');
  await service.execute('a', async () => config.observe('gemini', 'ready'));
  a.equal((await service.get('a')).providers.gemini.status, 'ready');
});

test('Tavily and Serper exhausted keys stay red through selection and have no reuse reset', async () => {
  const { service, config } = fixture();
  for (const provider of ['tavily', 'serper']) {
    const uid = provider;
    await service.manageKeys(uid, {
      revision: 0,
      provider,
      action: 'add',
      label: 'A',
      key: provider + '-a',
    });
    let saved = await service.manageKeys(uid, {
      revision: 1,
      provider,
      action: 'add',
      label: 'B',
      key: provider + '-b',
    });
    const [first, second] = saved.keyPools[provider];
    await service.execute(uid, async () => config.observe(provider, 'quota'));
    await service.manageKeys(uid, {
      revision: 2,
      provider,
      action: 'select',
      id: second.id,
    });
    saved = await service.manageKeys(uid, {
      revision: 3,
      provider,
      action: 'select',
      id: first.id,
    });
    a.equal(saved.providers[provider].status, 'quota');
    await service.execute(uid, async () => config.observe(provider, 'ready'));
    a.equal((await service.get(uid)).providers[provider].status, 'quota');
    await a.rejects(
      () =>
        service.manageKeys(uid, {
          revision: 4,
          provider,
          action: 'reuse',
          id: first.id,
        }),
      (e) => e.getStatus() === 400,
    );
  }
});

test('late error on an inactive key updates only its row, not the selected replacement', async () => {
  const { service, config } = fixture();
  await service.manageKeys('a', {
    revision: 0,
    provider: 'gemini',
    action: 'add',
    label: 'A',
    key: 'old',
  });
  const saved = await service.manageKeys('a', {
    revision: 1,
    provider: 'gemini',
    action: 'add',
    label: 'B',
    key: 'new',
  });
  await service.execute('a', async () => {
    await service.manageKeys('a', {
      revision: 2,
      provider: 'gemini',
      action: 'select',
      id: saved.keyPools.gemini[1].id,
    });
    config.observe('gemini', 'quota');
  });
  const after = await service.get('a');
  a.equal(after.providers.gemini.status, 'unverified');
  a.equal(after.keyPools.gemini[0].status, 'quota');
});

test('deleting an active key disables it without silently switching or inheriting env key', async () => {
  const { service, config } = fixture();
  let saved = await service.manageKeys('a', {
    revision: 0,
    provider: 'gemini',
    action: 'add',
    label: 'A',
    key: 'first',
  });
  saved = await service.manageKeys('a', {
    revision: 1,
    provider: 'gemini',
    action: 'add',
    label: 'B',
    key: 'second',
  });
  const active = saved.keyPools.gemini.find((k) => k.active),
    other = saved.keyPools.gemini.find((k) => !k.active);
  saved = await service.manageKeys('a', {
    revision: 2,
    provider: 'gemini',
    action: 'delete',
    id: active.id,
  });
  a.equal(saved.credentials.GEMINI_API_KEY.configured, false);
  a.equal(saved.keyPools.gemini.length, 1);
  a.equal(saved.keyPools.gemini[0].active, false);
  await a.rejects(
    () => service.execute('a', async () => config.key('GEMINI_API_KEY')),
    (e) => e.getStatus() === 503,
  );
  await service.manageKeys('a', {
    revision: 3,
    provider: 'gemini',
    action: 'select',
    id: other.id,
  });
  a.equal(
    await service.execute('a', async () => config.key('GEMINI_API_KEY')),
    'second',
  );
});

test('duplicate secret, invalid operations, other-user IDs and stale revisions are rejected', async () => {
  const { service } = fixture();
  const saved = await service.manageKeys('a', {
    revision: 0,
    provider: 'gemini',
    action: 'add',
    label: 'A',
    key: 'same-secret',
  });
  await a.rejects(
    () =>
      service.manageKeys('a', {
        revision: 1,
        provider: 'gemini',
        action: 'add',
        label: 'Duplicate',
        key: 'same-secret',
      }),
    (e) => e.getStatus() === 400,
  );
  await a.rejects(
    () =>
      service.manageKeys('b', {
        revision: 0,
        provider: 'gemini',
        action: 'select',
        id: saved.keyPools.gemini[0].id,
      }),
    (e) => e.getStatus() === 400,
  );
  await a.rejects(
    () =>
      service.manageKeys('a', {
        revision: 0,
        provider: 'gemini',
        action: 'select',
        id: saved.keyPools.gemini[0].id,
      }),
    (e) => e.getStatus() === 409,
  );
  for (const body of [
    { provider: 'trello', action: 'add', label: 'No', key: 'secret' },
    { provider: 'gemini', action: 'add', label: '', key: 'x' },
    {
      provider: 'gemini',
      action: 'select',
      id: saved.keyPools.gemini[0].id,
      key: 'injected',
    },
  ])
    await a.rejects(
      () => service.manageKeys('a', { revision: 1, ...body }),
      (e) => e.getStatus() === 400,
    );
  const renamed = await service.manageKeys('a', {
    revision: 1,
    provider: 'gemini',
    action: 'rename',
    id: saved.keyPools.gemini[0].id,
    label: 'My account',
  });
  a.equal(renamed.keyPools.gemini[0].label, 'My account');
});

test('legacy replacement API also retains key history and reselecting exhausted keys stays red', async () => {
  const { service, config } = fixture();
  await service.update('a', {
    revision: 0,
    secrets: { TAVILY_API_KEY: 'first' },
  });
  await service.execute('a', async () => config.observe('tavily', 'quota'));
  await service.update('a', {
    revision: 1,
    secrets: { TAVILY_API_KEY: 'second' },
  });
  const saved = await service.update('a', {
    revision: 2,
    secrets: { TAVILY_API_KEY: 'first' },
  });
  a.equal(saved.providers.tavily.status, 'quota');
  a.equal(saved.keyPools.tavily.length, 2);
});

test('legacy document migration keeps configured key and original quota status', async () => {
  const { service, firebase, config } = fixture();
  await service.update('a', {
    revision: 0,
    secrets: { GEMINI_API_KEY: 'legacy-only' },
  });
  await service.execute('a', async () => config.observe('gemini', 'quota'));
  const path = 'users/a/settings/workspace',
    doc = firebase.data.get(path);
  delete doc.keyPools;
  delete doc.keyHealth;
  firebase.data.set(path, doc);
  const before = await service.get('a');
  a.equal(before.keyPools.gemini[0].status, 'quota');
  a.equal(before.keyPools.gemini[0].active, true);
  const after = await service.manageKeys('a', {
    revision: 1,
    provider: 'gemini',
    action: 'add',
    label: 'New account',
    key: 'new-backup',
  });
  a.equal(after.keyPools.gemini.length, 2);
  a.equal(after.providers.gemini.status, 'quota');
  a.equal(
    await service.execute('a', async () => config.key('GEMINI_API_KEY')),
    'legacy-only',
  );
});

test('pool limit is 30 keys and rejecting the 31st leaves revision and active key intact', async () => {
  const { service } = fixture();
  for (let i = 0; i < 30; i++)
    await service.manageKeys('limit', {
      revision: i,
      provider: 'gemini',
      action: 'add',
      label: 'Account ' + i,
      key: 'unique-key-' + i,
    });
  await a.rejects(
    () =>
      service.manageKeys('limit', {
        revision: 30,
        provider: 'gemini',
        action: 'add',
        label: 'Too many',
        key: 'last-key',
      }),
    (e) => e.getStatus() === 400,
  );
  const saved = await service.get('limit');
  a.equal(saved.revision, 30);
  a.equal(saved.keyPools.gemini.length, 30);
  a.equal(saved.keyPools.gemini.filter((k) => k.active).length, 1);
});
