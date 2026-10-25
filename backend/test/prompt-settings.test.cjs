const { test } = require('node:test');
const a = require('node:assert/strict');
const {
  PromptSettingsService,
} = require('../dist/modules/content/prompt-settings.service.js');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const {
  validatePromptOverrides,
} = require('../dist/modules/content/prompt.types.js');
const {
  FirebaseIdentityGuard,
} = require('../dist/modules/firebase/firebase-identity.guard.js');
const {
  CharacterSelectionService,
} = require('../dist/modules/content/character-selection.service.js');
const {
  ContentGenerationService,
} = require('../dist/modules/content/content-generation.service.js');
const config = new ContentConfigService();
function fakeFirebase() {
  const data = new Map();
  const ref = (path) => ({
    collection: (name) => ref(path + '/' + name),
    doc: (name) => ref(path + '/' + name),
    path,
    get: async () => ({ data: () => structuredClone(data.get(path)) }),
  });
  const db = {
    collection: (name) => ref(name),
    runTransaction: async (fn) =>
      fn({
        get: async (reference) => reference.get(),
        set: (reference, value) =>
          data.set(reference.path, structuredClone(value)),
      }),
  };
  return { data, database: () => db, user: async (token) => ({ uid: token }) };
}
test('new user gets defaults without creating database content', async () => {
  const db = fakeFirebase();
  const result = await new PromptSettingsService(db, config).get('a');
  a.equal(result.revision, 0);
  a.deepEqual(result.prompts, config.defaults().pipelinePrompts);
  a.equal(db.data.size, 0);
});
test('prompt update is shared between service instances but isolated by user', async () => {
  const db = fakeFirebase();
  const first = new PromptSettingsService(db, config),
    second = new PromptSettingsService(db, config);
  await first.update('a', {
    revision: 0,
    prompts: { writer: 'Custom writing rule' },
  });
  a.equal((await second.get('a')).prompts.writer, 'Custom writing rule');
  a.equal((await second.get('b')).revision, 0);
  a.deepEqual(
    config.defaults().pipelinePrompts,
    new ContentConfigService().defaults().pipelinePrompts,
  );
});
test('revision conflicts prevent overwriting changes from another device', async () => {
  const service = new PromptSettingsService(fakeFirebase(), config);
  await service.update('a', { revision: 0, prompts: { writer: 'First' } });
  await a.rejects(
    () =>
      service.update('a', { revision: 0, prompts: { writer: 'Lost update' } }),
    (e) => e.getStatus() === 409,
  );
  a.equal((await service.get('a')).prompts.writer, 'First');
});
test('reset one prompt leaves other customized stages unchanged', async () => {
  const service = new PromptSettingsService(fakeFirebase(), config);
  await service.update('a', {
    revision: 0,
    prompts: { writer: 'Writer', analysis: 'Analysis' },
  });
  const result = await service.reset('a', { revision: 1, stages: ['writer'] });
  a.equal(result.revision, 2);
  a.equal(result.prompts.writer, config.defaults().pipelinePrompts.writer);
  a.equal(result.prompts.analysis, 'Analysis');
  a.deepEqual(result.customizedStages, ['analysis']);
});
test('prompt endpoints cannot change team, API keys, or other settings', async () => {
  const service = new PromptSettingsService(fakeFirebase(), config);
  await a.rejects(
    () =>
      service.update('a', {
        revision: 0,
        prompts: { writer: 'Rule' },
        teams: [],
      }),
    (e) => e.getStatus() === 400,
  );
  await a.rejects(
    () =>
      service.update('a', {
        revision: 0,
        prompts: { GEMINI_API_KEY: 'secret' },
      }),
    (e) => e.getStatus() === 400,
  );
});
test('invalid and oversized prompt text are rejected', () => {
  for (const value of [
    null,
    [],
    { writer: '' },
    { writer: 3 },
    { writer: 'x'.repeat(120001) },
    { unknown: 'text' },
  ])
    a.throws(() => validatePromptOverrides(value));
  validatePromptOverrides({ writer: 'Valid rule' });
});
test('Firebase identity guard requires a verified ID token', async () => {
  const guard = new FirebaseIdentityGuard({
    user: async (token) => {
      a.equal(token, 'firebase-id-token');
      return { uid: 'user-a' };
    },
  });
  const request = { headers: {} };
  const context = { switchToHttp: () => ({ getRequest: () => request }) };
  await a.rejects(
    () => guard.canActivate(context),
    (e) => e.getStatus() === 401,
  );
  request.headers.authorization = 'Bearer firebase-id-token';
  a.equal(await guard.canActivate(context), true);
  a.equal(request.firebaseUser.uid, 'user-a');
});
test('all three customized prompt stages reach the selected model', async () => {
  const calls = [];
  const character = {
    id: 'p1',
    name: 'Original Star',
    identity: 'real',
    inCaption: true,
    role: 'player',
    status: 'active',
    careerStage: 'veteran',
    importance: 'any',
    requiredTraits: ['parent'],
    evidence: 'Original Star',
  };
  const ai = {
    preflight: () => {},
    text: async (prompt, provider, schema) => {
      calls.push(prompt);
      if (schema?.properties?.people)
        return JSON.stringify({
          people: [
            {
              name: 'Target Player',
              role: 'player',
              status: 'active',
              careerStage: 'veteran',
              importance: 'star',
              traits: ['parent'],
              confidence: 'high',
              knowledgeNote: 'Known parenthood and veteran career',
            },
          ],
        });
      if (schema)
        return JSON.stringify({ summary: 'Story', characters: [character] });
      return 'Title: A Story\nCaption: FICTION: Target Player celebrates\nContent:\n<p>Target Player celebrates.</p>';
    },
  };
  const selector = new CharacterSelectionService(config, ai, {
    validateTeam: () => {},
  });
  const result = await new ContentGenerationService(selector, ai, config).batch(
    {
      caption: 'Original Star celebrates',
      content: 'Original Star celebrates.',
      teams: [
        {
          sport: 'AFL',
          team: 'Example',
          categories: [1],
          players: ['Target Player'],
        },
      ],
      prompts: {
        analysis: 'CUSTOM ANALYSIS',
        characterKnowledge: 'CUSTOM KNOWLEDGE',
        writer: 'CUSTOM WRITER',
      },
    },
  );
  a.equal(result.success, true);
  a.ok(calls[0].startsWith('CUSTOM ANALYSIS'));
  a.ok(calls[1].startsWith('CUSTOM KNOWLEDGE'));
  a.ok(calls[2].startsWith('CUSTOM WRITER'));
  a.ok(calls[2].includes('OUTPUT CONTRACT:'));
  a.equal(result.results[0].article.title, 'A Story');
});
test('prompt routes verify identity before reading/writing a user document', async () => {
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('../dist/app.module.js');
  const {
    FirebaseService,
  } = require('../dist/modules/firebase/firebase.service.js');
  const request = require('supertest');
  const firebase = fakeFirebase();
  const fixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseService)
    .useValue(firebase)
    .compile();
  const app = fixture.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  try {
    const api = request(app.getHttpServer());
    await api.get('/api/content/prompts').expect(401);
    await api
      .patch('/api/content/prompts')
      .set('Authorization', 'Bearer user-a')
      .send({ revision: 0, prompts: { writer: 'Saved writer rule' } })
      .expect(200);
    const result = await api
      .get('/api/content/prompts')
      .set('Authorization', 'Bearer user-a')
      .expect(200);
    a.equal(result.body.prompts.writer, 'Saved writer rule');
    const other = await api
      .get('/api/content/prompts')
      .set('Authorization', 'Bearer user-b')
      .expect(200);
    a.equal(other.body.revision, 0);
    await api
      .post('/api/content/prompts/reset')
      .set('Authorization', 'Bearer user-a')
      .send({ revision: 1 })
      .expect(201);
  } finally {
    await app.close();
  }
});
