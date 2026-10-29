const { test } = require('node:test');
const a = require('node:assert/strict');
const {
  formatContent,
} = require('../dist/modules/content/transforms/format-content.js');
const { TrelloService } = require('../dist/modules/content/trello.service.js');
const caption =
  'FICTION: 👀 A MASSIVE SHOCKWAVE THROUGH THE AFL:\n\nAdelaide Crows captain Jordan Dawson has stunned the footy world with a dramatic career move — and now, the South Australian powerhouse is suddenly at the center of the sporting world’s attention. 🏉\n\nWATCH NOW:';
const content =
  '<h2>The decision</h2>\n<p>First paragraph with details &amp; context.</p>\n<!--IMAGE: Adelaide Crows AFL-->\n<p>Second paragraph with the reaction.</p>';
const parse = async (text) =>
  (
    await formatContent([
      {
        json: {
          candidates: [{ content: { parts: [{ text }] } }],
          'Sport Team': 'AFL Adelaide Crows',
        },
      },
    ])
  )[0].json;

test('reported shockwave caption retains headline, narrative, emojis, paragraphs and CTA', async () => {
  const result = await parse(
    `Title: Career move\nCaption: ${caption}\nContent:\n${content}`,
  );
  a.equal(result.caption, caption);
  a.equal(result.content, content);
  a.equal(result.title, 'Career move');
  a.ok(result.caption.includes('Jordan Dawson'));
  a.ok(result.caption.endsWith('WATCH NOW:'));
});
test('caption can begin on the next line and content can begin on its label line', async () => {
  const result = await parse(
    `Title: Career move\nCaption:\n${caption}\nContent: ${content}`,
  );
  a.equal(result.caption, caption);
  a.equal(result.content, content);
});
test('CRLF captions preserve their original line breaks', async () => {
  const expected = caption.replace(/\n/g, '\r\n');
  const result = await parse(
    `Title: Career move\r\nCaption: ${expected}\r\nContent:\r\n${content}`,
  );
  a.equal(result.caption, expected);
  a.equal(result.content, content);
});
test('inline Content: in caption prose is not a section marker', async () => {
  const expected = 'FICTION: Review the Content: a dramatic move.\nWATCH NOW:';
  const result = await parse(
    `Title: Move\nCaption: ${expected}\nContent:\n${content}`,
  );
  a.equal(result.caption, expected);
  a.equal(result.content, content);
});
test('unlabelled HTML body keeps preceding multiline caption and starts at first block', async () => {
  for (const html of [content, '<p>Body.</p>']) {
    const result = await parse(`Title: Move\nCaption: ${caption}\n\n${html}`);
    a.equal(result.caption, caption);
    a.equal(result.content, html);
  }
});
test('empty sections cannot borrow text from the next label', async () => {
  const result = await parse(`Title:\nCaption:\nContent:\n${content}`);
  a.equal(result.title, 'No Title');
  a.equal(result.caption, 'No Caption');
  a.equal(result.content, content);
});
test('missing body does not swallow or discard caption continuation', async () => {
  const result = await parse(`Title: Move\nCaption: ${caption}`);
  a.equal(result.caption, caption);
  a.equal(result.content, 'No Content');
});
test('one-line captions remain compatible and body label words inside HTML remain intact', async () => {
  const html = '<p>Content: Title: Caption: these are article words.</p>';
  const result = await parse(
    `Title: Move\nCaption: FICTION: Move\nContent:\n${html}`,
  );
  a.equal(result.caption, 'FICTION: Move');
  a.equal(result.content, html);
});
test('parsed multiline caption reaches the published Trello comment without truncation', async () => {
  const result = await parse(
    `Title: Career move\nCaption: ${caption}\nContent:\n${content}`,
  );
  const calls = [];
  const trello = new TrelloService(
    { key: () => 'test-only' },
    { json: async (...args) => calls.push(args) },
  );
  await trello.comment('published123', result.caption);
  a.equal(new URL(calls[0][0]).searchParams.get('text'), caption);
  a.equal(calls[0][1].method, 'POST');
  a.equal(result.content, content);
});
