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
  a.deepEqual(result.prompts, { rewrite: config.defaults().prompt });
  a.equal(db.data.size, 0);
});
test('prompt update is shared between service instances but isolated by user', async () => {
  const db = fakeFirebase();
  const first = new PromptSettingsService(db, config),
    second = new PromptSettingsService(db, config);
  await first.update('a', {
    revision: 0,
    prompts: { rewrite: 'Custom writing rule' },
  });
  a.equal((await second.get('a')).prompts.rewrite, 'Custom writing rule');
  a.equal((await second.get('b')).revision, 0);
  a.deepEqual(
    config.defaults().pipelinePrompts,
    new ContentConfigService().defaults().pipelinePrompts,
  );
});
test('revision conflicts prevent overwriting changes from another device', async () => {
  const service = new PromptSettingsService(fakeFirebase(), config);
  await service.update('a', { revision: 0, prompts: { rewrite: 'First' } });
  await a.rejects(
    () =>
      service.update('a', { revision: 0, prompts: { rewrite: 'Lost update' } }),
    (e) => e.getStatus() === 409,
  );
  a.equal((await service.get('a')).prompts.rewrite, 'First');
});
test('reset restores the full n8n prompt', async () => {
  const service = new PromptSettingsService(fakeFirebase(), config);
  await service.update('a', {
    revision: 0,
    prompts: { rewrite: 'Writer' },
  });
  const result = await service.reset('a', { revision: 1, stages: ['rewrite'] });
  a.equal(result.revision, 2);
  a.equal(result.prompts.rewrite, config.defaults().prompt);
  a.deepEqual(result.customizedStages, []);
});
test('prompt endpoints cannot change team, API keys, or other settings', async () => {
  const service = new PromptSettingsService(fakeFirebase(), config);
  await a.rejects(
    () =>
      service.update('a', {
        revision: 0,
        prompts: { rewrite: 'Rule' },
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
    { rewrite: '' },
    { rewrite: 3 },
    { rewrite: 'x'.repeat(120001) },
    { unknown: 'text' },
  ])
    a.throws(() => validatePromptOverrides(value));
  validatePromptOverrides({ rewrite: 'Valid rule' });
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
      .send({ revision: 0, prompts: { rewrite: 'Saved writer rule' } })
      .expect(200);
    const result = await api
      .get('/api/content/prompts')
      .set('Authorization', 'Bearer user-a')
      .expect(200);
    a.equal(result.body.prompts.rewrite, 'Saved writer rule');
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

test('reading old saved prompts archives them once and restores only the original full prompt', async () => {
  const db = fakeFirebase();
  const path = 'users/legacy/settings/prompts';
  const old = {
    version: 'n8n-rules-v2',
    revision: 7,
    prompts: {
      writer: 'Old writer',
      analysis: 'Old analysis',
      rules: 'Old rules',
    },
  };
  db.data.set(path, old);
  const service = new PromptSettingsService(db, config);
  const result = await service.get('legacy');
  a.equal(result.revision, 8);
  a.equal(result.version, 'n8n-rotation-v5');
  a.deepEqual(result.prompts, { rewrite: config.defaults().prompt });
  a.deepEqual(db.data.get(path + '/versions/before-n8n-rotation-v5-r7'), old);
  a.equal((await service.get('legacy')).revision, 8);
  a.equal(db.data.size, 2);
});
test('retired stage edits are rejected by the saved prompt API', async () => {
  const service = new PromptSettingsService(fakeFirebase(), config);
  await a.rejects(
    () =>
      service.update('a', { revision: 0, prompts: { analysis: 'Old stage' } }),
    (error) => error.getStatus() === 400,
  );
});

test('writer customizations survive migration while analyzer is retired',async()=>{
 const db=fakeFirebase(),path='users/writer/settings/prompts';
 const old={version:'n8n-direct-v3',revision:3,prompts:{rewrite:'User customized full n8n prompt'}};db.data.set(path,old);
 const service=new PromptSettingsService(db,config),r=await service.get('writer');
 a.equal(r.revision,4);a.equal(r.prompts.rewrite,old.prompts.rewrite);a.equal(r.prompts.contextAnalysis,undefined);a.deepEqual(db.data.get(path+'/versions/before-n8n-rotation-v5-r3'),old);
 await a.rejects(()=>service.update('writer',{revision:4,prompts:{contextAnalysis:'Old context prompt'}}),e=>e.getStatus()===400);
});
