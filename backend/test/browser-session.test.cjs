const { test, afterEach } = require('node:test');
const a = require('node:assert/strict');
const { AuthService } = require('../dist/auth/auth.service.js');
const {
  BrowserSessionService,
} = require('../dist/auth/browser-session.service.js');
const originalFetch = global.fetch;
const originalSecret = process.env.BROWSER_SESSION_SECRET;
afterEach(() => {
  global.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.BROWSER_SESSION_SECRET;
  else process.env.BROWSER_SESSION_SECRET = originalSecret;
});
function fixture() {
  process.env.BROWSER_SESSION_SECRET = 'test-only-session-signing-key';
  const auth = new AuthService();
  global.fetch = async (url, init) => {
    a.equal(url, 'https://dash.tinfosmedia.com/api/auth/sign-in');
    a.deepEqual(JSON.parse(init.body), {
      username: 'writer',
      password: 'test-password',
    });
    return new Response('{"success":true}', {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie':
          'auth-session=upstream-test-token; Max-Age=3600; HttpOnly; Secure',
      },
    });
  };
  const service = new BrowserSessionService(auth);
  const request = { secure: false, headers: { 'x-forwarded-proto': 'https' } };
  let cookie,
    cleared = false;
  const response = {
    cookie: (name, value, options) => {
      cookie = { name, value, options };
    },
    clearCookie: () => {
      cleared = true;
    },
    setHeader: () => {},
  };
  return {
    auth,
    service,
    request,
    response,
    cookie: () => cookie,
    cleared: () => cleared,
    login: async (remember = true) => {
      const result = await service.login(request, response, {
        username: 'writer',
        password: 'test-password',
        remember,
      });
      request.headers.cookie =
        cookie.name + '=' + encodeURIComponent(cookie.value);
      return result;
    },
  };
}
test('browser login returns identity only, sets protected cookie, and does not share its token with the legacy singleton', async () => {
  const f = fixture();
  const value = await f.login();
  a.equal(value.username, 'writer');
  a.ok(value.expiresAt > Date.now());
  a.equal(JSON.stringify(value).includes('upstream-test-token'), false);
  a.equal(f.cookie().options.httpOnly, true);
  a.equal(f.cookie().options.secure, true);
  a.equal(f.cookie().options.sameSite, 'strict');
  a.ok(f.cookie().options.maxAge <= 3600000);
  a.equal(f.auth.get(), null);
  a.equal(
    new BrowserSessionService(new AuthService()).read(f.request).token,
    'upstream-test-token',
  );
});
test('remember disabled produces a session cookie without persistent maxAge', async () => {
  const f = fixture();
  await f.login(false);
  a.equal(f.cookie().options.maxAge, undefined);
});
test('tampered identity or signature and expired cookies cannot access a workspace', async () => {
  const f = fixture();
  await f.login();
  const [payload, signature] = f.cookie().value.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const forged = Buffer.from(
    JSON.stringify({ ...data, username: 'another-user' }),
  ).toString('base64url');
  for (const value of [
    forged + '.' + signature,
    payload + '.invalid',
    payload + '.' + signature + '.extra',
  ]) {
    a.throws(
      () =>
        f.service.read({ headers: { cookie: 'autowrite-session=' + value } }),
      (error) => error.getStatus() === 401,
    );
  }
  const now = Date.now;
  try {
    Date.now = () => data.expiresAt + 1;
    a.throws(
      () => f.service.read(f.request),
      (error) => error.getStatus() === 401,
    );
  } finally {
    Date.now = now;
  }
});
test('request session is restored after a cold start and cleared when the article service invalidates it', async () => {
  const f = fixture();
  await f.login();
  const value = await f.service.run(f.request, f.response, async () => {
    a.equal(f.auth.get(), 'upstream-test-token');
    await f.auth.deleteToken();
    return { success: false, results: [] };
  });
  a.equal(value.sessionExpired, true);
  a.equal(f.cleared(), true);
  a.equal(f.auth.get(), null);
});
test('concurrent browser requests cannot overwrite each other or the legacy auth token', async () => {
  const auth = new AuthService();
  auth.set('legacy');
  await Promise.all(
    ['first', 'second'].map((token) =>
      auth.withSession(token, async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, token === 'first' ? 10 : 2),
        );
        a.equal(auth.get(), token);
        await auth.deleteToken();
        a.equal(auth.get(), null);
      }),
    ),
  );
  a.equal(auth.get(), 'legacy');
});
test('browser routes require a signed cookie and bind storage to the verified Tinfos account', async () => {
  const f = fixture();
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('../dist/app.module.js');
  const {
    TeamSettingsService,
  } = require('../dist/modules/content/team-settings.service.js');
  const {
    ContentWorkflowService,
  } = require('../dist/modules/content/content-workflow.service.js');
  const request = require('supertest');
  const calls = [];
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(
      require('../dist/modules/content/workspace-settings.service.js')
        .WorkspaceSettingsService,
    )
    .useValue({
      execute: async (_uid, work) =>
        work({ slugSuffix: 'danghoa123', note: '' }),
    })
    .overrideProvider(AuthService)
    .useValue(f.auth)
    .overrideProvider(TeamSettingsService)
    .useValue({
      get: async (uid) => {
        calls.push(uid);
        return { teams: [], revision: 0 };
      },
      resolveForUser: async (teams, uid) => {
        calls.push(uid);
        return teams;
      },
    })
    .overrideProvider(ContentWorkflowService)
    .useValue({
      run: async (body) => {
        a.equal(f.auth.get(), 'upstream-test-token');
        a.equal(body.login, undefined);
        await f.auth.deleteToken();
        return { success: false, results: [] };
      },
    })
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  try {
    const http = request(app.getHttpServer());
    await http.get('/api/workspace/teams').expect(401);
    const login = await http
      .post('/api/auth/browser/login')
      .send({ username: 'writer', password: 'test-password', remember: true })
      .expect(201);
    a.deepEqual(Object.keys(login.body).sort(), ['expiresAt', 'username']);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    await http
      .get('/api/auth/browser/session')
      .set('Cookie', cookie)
      .expect(200);
    await http.get('/api/workspace/teams').set('Cookie', cookie).expect(200);
    const run = await http
      .post('/api/workspace/run')
      .set('Cookie', cookie)
      .send({
        teams: [],
        login: { username: 'impersonation', password: 'ignored' },
      })
      .expect(201);
    a.equal(run.body.sessionExpired, true);
    a.ok(run.headers['set-cookie'][0].includes('Expires=Thu, 01 Jan 1970'));
    a.deepEqual(calls, ['tinfos:writer', 'tinfos:writer']);
    await http.post('/api/auth/browser/logout').expect(201);
  } finally {
    await app.close();
  }
});
