const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../dist/auth/auth.service.js');
const { ArticlesService } = require('../dist/modules/articles/articles.service.js');
const { ARTICLE_UPDATE_HEADERS } = require('../dist/modules/articles/article-workflow.config.js');
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
function setup() {
  const auth = new AuthService();
  auth.set('test-session');
  return { auth, service: new ArticlesService(auth) };
}
const body = {
  categories: [44], title: 'Sample title', content: '<p>Sample content</p>',
  slug: 'sample-title', featured_image: 'https://example.test/image.jpg',
  featured_image_thumbnail: 'https://example.test/thumb.jpg',
};
function mockResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
test('create matches gen_id_post1 and returns only postId', async () => {
  const { service } = setup();
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://dash.tinfosmedia.com/api/posts');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { Cookie: 'auth-session=test-session', 'Content-Type': 'application/json' });
    assert.equal(init.body, '{"title":"Untitled Post"}');
    return mockResponse({ success: true, postId: 'post123' }, 201);
  };
  assert.equal(await service.createPost(), 'post123');
});
test('update keeps all workflow headers and sends exactly six fields', async () => {
  const { service } = setup();
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://dash.tinfosmedia.com/api/posts/post123');
    assert.equal(init.method, 'PUT');
    assert.deepEqual(init.headers, { ...ARTICLE_UPDATE_HEADERS, cookie: 'auth-session=test-session;', 'content-type': 'application/json' });
    assert.deepEqual(JSON.parse(init.body), body);
    return mockResponse({ success: true });
  };
  const result = await service.updatePost('post123', { ...body, caption: 'must not send', token: 'must not send' });
  assert.deepEqual(result.body, { success: true });
  assert.equal(result.statusCode, 200);
});
test('publish matches publish1, has no body and performs no implicit update', async () => {
  const { service } = setup();
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://dash.tinfosmedia.com/api/posts/post123/publish');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, { Cookie: 'auth-session=test-session' });
    assert.equal(init.body, undefined);
    return mockResponse({ success: true });
  };
  assert.deepEqual(await service.publishPost('post123'), { success: true });
  assert.equal(calls, 1);
});
test('all article operations require the single auth token', async () => {
  const { service, auth } = setup();
  await auth.deleteToken();
  await assert.rejects(() => service.createPost(), /missing token/);
  await assert.rejects(() => service.updatePost('post123', body), /missing token/);
  await assert.rejects(() => service.publishPost('post123'), /missing token/);
});
test('HTTP and application failures clear token', async () => {
  for (const [status, data] of [[401, { error: 'expired' }], [500, { error: 'failed' }], [200, { success: false }]]) {
    const { service, auth } = setup();
    global.fetch = async () => mockResponse(data, status);
    await assert.rejects(() => service.publishPost('post123'));
    assert.equal(auth.get(), null);
  }
});
test('network errors clear only the token used in that request', async () => {
  const { service, auth } = setup();
  global.fetch = async () => { throw Error('network'); };
  await assert.rejects(() => service.publishPost('post123'));
  assert.equal(auth.get(), null);
  auth.set('old');
  global.fetch = async () => { auth.set('new'); throw Error('network'); };
  await assert.rejects(() => service.publishPost('post123'));
  assert.equal(auth.get(), 'new');
});
test('invalid update input and path are rejected before outgoing calls', async () => {
  const { service } = setup();
  global.fetch = async () => { assert.fail('must not call upstream'); };
  await assert.rejects(() => service.updatePost('post123', { title: 'incomplete' }));
  await assert.rejects(() => service.publishPost('../auth/sign-in'));
});
test('slug matches gen_slug1, with separately configurable suffix', () => {
  const { service } = setup();
  assert.equal(service.generateSlug({ title: 'The BIG WIN for Team! Amazing Victory', postId: '123456abcdef', suffix: 'danghoa123-team-spark' }), 'team-amazing-victory-danghoa123-team-spark-abcdef');
  assert.equal(service.generateSlug({ title: 'Sample Title', postId: '123456abcdef', suffix: 'custom' }), 'sample-title-custom-abcdef');
});
