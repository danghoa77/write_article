const { test } = require('node:test');
const a = require('node:assert/strict');
const {
  ContentConfigService,
} = require('../dist/modules/content/content-config.service.js');
const {
  ContentService,
} = require('../dist/modules/content/content.service.js');
const {
  ContentGenerationService,
} = require('../dist/modules/content/content-generation.service.js');
const {
  CharacterRotationService,
} = require('../dist/modules/content/character-rotation.service.js');
function firebase() {
  const data = new Map();
  const ref = (path) => ({
    path,
    collection: (n) => ref(path + '/' + n),
    doc: (n) => ref(path + '/' + n),
    get: async () => ({ data: () => structuredClone(data.get(path)) }),
  });
  return {
    data,
    database: () => ({
      collection: (n) => ref(n),
      runTransaction: async (fn) =>
        fn({
          get: (r) => r.get(),
          set: (r, v) => data.set(r.path, structuredClone(v)),
        }),
    }),
  };
}
const team = {
  team: 'Example Club',
  sport: 'AFL',
  players: ['Player Alpha', 'Player Beta'],
  captain: 'Player Alpha',
  headCoach: 'Coach One',
  categories: [44],
};
const source = {
  caption: 'Original Star thanks volunteers',
  content: 'Original Star thanks volunteers for 35 years of service.',
  teams: [team],
};
const article = (name) =>
  `Title: Thank you\nCaption: FICTION: ${name} thanks volunteers\nContent:\n<p>${name} thanks volunteers for 35 years of service. Player Beta was also mentioned.</p>`;
function setup(write) {
  const db = firebase(),
    config = new ContentConfigService(),
    content = new ContentService(config, {}),
    rotation = new CharacterRotationService(db, config),
    calls = [];
  const ai = {
    preflight() {},
    async text(...args) {
      calls.push(args);
      return write(...args);
    },
  };
  return {
    db,
    config,
    rotation,
    calls,
    content,
    generation: new ContentGenerationService(content, ai, config, rotation),
  };
}
test('first write is precisely the rendered n8n prompt, one AI call, full roster, no analyzer policy', async () => {
  const f = setup(() => article('Player Alpha')),
    r = await f.generation.batch(source);
  a.equal(r.success, true);
  a.equal(f.calls.length, 1);
  a.equal(f.calls[0].length, 2);
  a.equal(
    f.calls[0][0],
    f.content.renderPrompt({
      team,
      caption: source.caption,
      content: source.content,
    }),
  );
  a.deepEqual(r.results[0].rotation.selected, ['Player Alpha']);
});
test('same source and team exclude prior caption player, not names appearing only in body', async () => {
  const f = setup((prompt) =>
    article(
      prompt.includes('REPEAT-WRITE VARIATION')
        ? 'Player Beta'
        : 'Player Alpha',
    ),
  );
  await f.generation.batch(source);
  const r = await f.generation.batch(source);
  a.deepEqual(r.results[0].rotation.excluded, ['Player Alpha']);
  a.deepEqual(r.results[0].rotation.selected, ['Player Beta']);
  const filtered = f.rotation.writerTeam(team, { excluded: ['Player Alpha'] });
  a.deepEqual(filtered.players, ['Player Beta']);
  a.equal(filtered.captain, null);
  a.ok(
    f.calls[1][0].startsWith(
      f.content.renderPrompt({
        team: filtered,
        caption: source.caption,
        content: source.content,
      }),
    ),
  );
  a.doesNotMatch(f.calls[1][0], /- Captain: Player Alpha/);
  a.deepEqual(team.players, ['Player Alpha', 'Player Beta']);
  a.match(f.calls[1][0], /35 years/);
  a.equal(f.calls.length, 2);
});

test('exclusion removes roster profiles and captain annotations, retaining other captains and coach', () => {
  const f = setup(() => article('Player Beta'));
  const original = {
    ...team,
    captain: 'Player Alpha (captain), Player Beta',
    personnel: [
      { name: 'Player Alpha', role: 'player' },
      { name: 'Player Beta', role: 'player' },
    ],
  };
  const filtered = f.rotation.writerTeam(original, {
    excluded: ['player alpha'],
  });
  a.deepEqual(filtered.players, ['Player Beta']);
  a.equal(filtered.captain, 'Player Beta');
  a.deepEqual(
    filtered.personnel.map((p) => p.name),
    ['Player Beta'],
  );
  a.equal(filtered.headCoach, 'Coach One');
  a.equal(original.personnel.length, 2);
});
test('writer repeat is rejected, not silently published or followed by a paid repair call', async () => {
  const f = setup(() => article('Player Alpha'));
  await f.generation.batch(source);
  const r = await f.generation.batch(source);
  a.equal(r.success, false);
  a.equal(r.results[0].statusCode, 422);
  a.equal(r.results[0].error.code, 'CHARACTER_REPEATED');
  a.equal(f.calls.length, 2);
});
test('A then B then C: each request only receives the remaining roster candidates', async () => {
  const f = setup(prompt => {
    const pool = prompt.match(/- Known current players.*?: ([^\n]+)/)[1].split(', ');
    return article(pool[0]);
  });
  const three = { ...team, players: ['Player Alpha', 'Player Beta', 'Player Gamma'] };
  for (const [index, name] of three.players.entries()) {
    const result = await f.generation.batch({ ...source, teams: [three] });
    a.equal(result.success, true);
    a.deepEqual(result.results[0].rotation.selected, [name]);
    const row = f.calls[index][0].match(/- Known current players.*?: ([^\n]+)/)[1];
    a.equal(row, three.players.slice(index).join(', '));
  }
});

test('next cycle starts after every known player has been used', async () => {
  const f = setup((prompt) =>
    article(
      prompt.includes('REPEAT-WRITE VARIATION')
        ? 'Player Beta'
        : 'Player Alpha',
    ),
  );
  await f.generation.batch(source);
  await f.generation.batch(source);
  const r = await f.generation.batch(source);
  a.equal(r.results[0].rotation.cycle, 2);
  a.deepEqual(r.results[0].rotation.excluded, []);
});
test('source, team and account histories are independent; whitespace-only changes retain history', async () => {
  const f = setup(() => article('Player Alpha'));
  await f.generation.batch(source);
  for (const body of [
    { ...source, content: source.content + ' Extra detail.' },
    { ...source, teams: [{ ...team, team: 'Other Club' }] },
  ]) {
    const r = await f.generation.batch(body);
    a.equal(r.success, true);
    a.deepEqual(r.results[0].rotation.excluded, []);
  }
  const r = await f.config.withValues({ CONTENT_HISTORY_SCOPE: 'other' }, () =>
    f.generation.batch(source),
  );
  a.equal(r.success, true);
  const same = await f.generation.batch({
    ...source,
    caption: '  Original Star   thanks volunteers  ',
  });
  a.equal(same.success, false);
});
test('history persists across service instances', async () => {
  const f = setup(() => article('Player Alpha'));
  await f.generation.batch(source);
  const rotation = new CharacterRotationService(f.db, f.config);
  const ticket = await rotation.begin(source.caption, source.content, team);
  a.deepEqual(ticket.excluded, ['Player Alpha']);
  await rotation.release(ticket);
});
test('failed writer releases lease without consuming a player', async () => {
  const f = setup(() => {
    throw Error('provider unavailable');
  });
  const r = await f.generation.batch(source);
  a.equal(r.success, false);
  const ticket = await f.rotation.begin(source.caption, source.content, team);
  a.deepEqual(ticket.excluded, []);
  await f.rotation.release(ticket);
});
test('concurrent same-source same-team work is blocked; failed writes never erase another lease', async () => {
  const f = setup(() => article('Player Alpha'));
  const ticket = await f.rotation.begin(source.caption, source.content, team);
  await a.rejects(
    () => f.rotation.begin(source.caption, source.content, team),
    (e) => e.getStatus() === 409,
  );
  await f.rotation.release({ ...ticket, lease: 'stale' });
  await a.rejects(
    () => f.rotation.begin(source.caption, source.content, team),
    (e) => e.getStatus() === 409,
  );
  await f.rotation.release(ticket);
});
test('anonymous or unknown former names do not create guessed history entries', async () => {
  const f = setup(() => article('An unnamed former player'));
  const r = await f.generation.batch(source);
  a.equal(r.success, true);
  a.deepEqual(r.results[0].rotation.selected, []);
  a.match(r.results[0].rotation.note, /không tự đoán/);
});
test('any selected team count gets one writer each, selected provider and pair-specific note', async () => {
  const f = setup(() => article('Player Alpha'));
  const r = await f.generation.batch({
    ...source,
    teams: Array.from({ length: 6 }, (_, i) => ({
      ...team,
      team: 'Club ' + i,
    })),
    textProvider: 'gpt',
    prompt: 'Keep the warm tone.',
  });
  a.equal(r.results.length, 6);
  a.equal(f.calls.length, 6);
  a.ok(
    f.calls.every(
      ([prompt, provider]) =>
        provider === 'gpt' && prompt.endsWith('Keep the warm tone.'),
    ),
  );
});
