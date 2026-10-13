import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, providersFor, cleanReply } from './worker.mjs';

// Dummy values only. Every upstream fetch in this suite is mocked.
const ACCESS = 'unit-test-access-token';
const allEnv = {
  BOT_TOKEN: ACCESS, GROQ_API_KEY: 'mock_groq', CEREBRAS_API_KEY: 'mock_cerebras',
  GEMINI_API_KEY: 'mock_gemini', CLOUDFLARE_AI_TOKEN: 'mock_cloudflare',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), GITHUB_MODELS_TOKEN: 'mock_github',
  HF_TOKEN: 'mock_hf', HF_MODEL: 'test/model', OPENROUTER_API_KEY: 'mock_openrouter',
};
const keyNames = {
  groq: 'GROQ_API_KEY', cerebras: 'CEREBRAS_API_KEY', gemini: 'GEMINI_API_KEY',
  cloudflare: 'CLOUDFLARE_AI_TOKEN', github: 'GITHUB_MODELS_TOKEN',
  huggingface: 'HF_TOKEN', openrouter: 'OPENROUTER_API_KEY',
};
const baseInput = { requestId: 'test-1', message: 'hello tom',
  account: { username: 'ActualUser123456', displayName: 'Actual Nick' },
  speaker: { username: 'Guest', displayName: 'Guest Name' }, history: [], recent: [] };
function request(input = baseInput, token = ACCESS) {
  return new Request('https://bridge.test/chat', { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
}
function identify(url) {
  if (url.includes('groq.com')) return 'groq';
  if (url.includes('cerebras.ai')) return 'cerebras';
  if (url.includes('googleapis.com')) return 'gemini';
  if (url.includes('api.cloudflare.com')) return 'cloudflare';
  if (url.includes('models.github.ai')) return 'github';
  if (url.includes('huggingface.co')) return 'huggingface';
  if (url.includes('openrouter.ai')) return 'openrouter';
  throw new Error(`unexpected upstream ${url}`);
}
function response(provider, reply = 'yo hows it going?') {
  return Response.json(provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: reply }] } }] }
    : provider === 'cloudflare' ? { success: true, result: { response: reply } }
      : { choices: [{ message: { content: reply } }] });
}

for (const provider of Object.keys(keyNames)) {
  test(`${provider}: protocol request/parsing with mocked key/model`, async () => {
    const env = { BOT_TOKEN: ACCESS, [keyNames[provider]]: allEnv[keyNames[provider]],
      CLOUDFLARE_ACCOUNT_ID: allEnv.CLOUDFLARE_ACCOUNT_ID, HF_MODEL: allEnv.HF_MODEL };
    const worker = createWorker({ fetch: async (url, options) => {
      assert.equal(identify(url), provider);
      const body = JSON.parse(options.body);
      assert.equal(options.redirect, 'error');
      if (provider === 'gemini') {
        assert.equal(options.headers['x-goog-api-key'], 'mock_gemini');
        assert.equal(body.contents.at(-1).parts[0].text, baseInput.message);
        assert.ok(body.systemInstruction.parts[0].text.includes('ActualUser123456'));
      } else {
        assert.equal(options.headers.Authorization, `Bearer ${env[keyNames[provider]]}`);
        assert.equal(body.messages.at(-1).content, baseInput.message);
        assert.ok(body.messages[0].content.includes('Never repeat'));
      }
      return response(provider);
    } });
    const result = await worker.fetch(request(), env);
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.provider, provider); assert.equal(data.requestId, 'test-1');
    assert.equal(data.reply, 'yo hows it going?');
  });
}

test('authentication and missing providers fail before any upstream request', async () => {
  let calls = 0;
  const worker = createWorker({ fetch: async () => { calls++; throw new Error('should not fetch'); } });
  assert.equal((await worker.fetch(request(baseInput, 'wrong'), allEnv)).status, 401);
  assert.equal((await worker.fetch(request(), {})).status, 401);
  assert.equal((await worker.fetch(request(), { BOT_TOKEN: ACCESS })).status, 503);
  assert.equal(calls, 0);
});

test('health reports only configured metadata; HF requires a selected model', async () => {
  assert.equal(providersFor({ HF_TOKEN: 'mock' }).find(x => x.name === 'huggingface').ready, false);
  assert.equal(providersFor({ HF_TOKEN: 'mock', HF_MODEL: 'test/model' }).find(x => x.name === 'huggingface').ready, true);
  const result = await createWorker().fetch(new Request('https://bridge.test/health'), allEnv);
  const data = await result.json();
  assert.equal(data.configured.length, 7);
  assert.equal(JSON.stringify(data).includes('mock_'), false);
});

test('fast failures fall through, secrets are not exposed, only one winner returns', async () => {
  const calls = [];
  const worker = createWorker({ fetch: async (url) => {
    const name = identify(url); calls.push(name);
    if (name === 'groq') throw new Error('sensitive upstream mock_groq');
    if (name === 'cerebras') return new Response('private error mock_cerebras', { status: 500 });
    return response(name, 'hey whats good?');
  } });
  const result = await worker.fetch(request(), allEnv);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.ok(calls.length >= 3); assert.ok(['gemini','cloudflare','github','huggingface','openrouter'].includes(data.provider));
  assert.equal(JSON.stringify(data).includes('mock_'), false);
});

test('429 cooldown skips the throttled provider and expires correctly', async () => {
  let now = 1000; const calls = [];
  const env = { BOT_TOKEN: ACCESS, GROQ_API_KEY: 'mock', CEREBRAS_API_KEY: 'mock' };
  const worker = createWorker({ now: () => now, fetch: async url => {
    const name = identify(url); calls.push(name);
    if (name === 'groq') return new Response('', { status: 429, headers: { 'retry-after': '2' } });
    return response(name);
  } });
  await worker.fetch(request(), env);
  calls.length = 0;
  await worker.fetch(request(), env);
  assert.deepEqual(calls, ['cerebras']);
  now += 2100; calls.length = 0;
  await worker.fetch(request(), env);
  assert.ok(calls.includes('groq'));
});

test('uncooperative upstreams cannot exceed global response budget', async () => {
  let active = 0, peak = 0;
  const worker = createWorker({ fetch: async (_, options) => {
    active++; peak = Math.max(peak, active);
    options.signal.addEventListener('abort', () => active--, { once: true });
    return new Promise(() => {}); // Deliberately ignores cancellation/result.
  } });
  const start = Date.now();
  const result = await worker.fetch(request(), { ...allEnv, BUDGET_MS: 500, ATTEMPT_MS: 3500 });
  assert.equal(result.status, 504);
  assert.ok(Date.now() - start < 800);
  assert.ok(peak <= 2); assert.equal(active, 0);
});

test('all seven providers rotate through timeout failures within one deadline', async () => {
  const calls = [];
  const worker = createWorker({ fetch: async url => { calls.push(identify(url)); return new Promise(() => {}); } });
  const start = Date.now();
  const result = await worker.fetch(request(), { ...allEnv, BUDGET_MS: 900, ATTEMPT_MS: 100 });
  assert.equal(result.status, 503);
  assert.equal(new Set(calls).size, 7);
  assert.ok(Date.now() - start < 900);
  const data = await result.json();
  assert.equal(data.attempts.length, 7); assert.equal(data.reply, undefined);
});

test('style violations and repeated replies are not published as fallback text', async () => {
  for (const bad of ['on it','one. two','two\nlines','http://bad.test','this response has far more than twelve words and should never reach public chat because it is too long']) {
    assert.equal(cleanReply(bad), null);
  }
  assert.equal(cleanReply('Hi Bro!'), 'hi bro');
  assert.equal(cleanReply('my username is actualuser123456', baseInput.account), 'my username is actualuser123456');
  const worker = createWorker({ fetch: async url => response(identify(url), 'already said') });
  const result = await worker.fetch(request({ ...baseInput, recent: ['already said'] }), allEnv);
  assert.equal(result.status, 503); assert.equal((await result.json()).reply, undefined);
});

test('malformed/oversized requests never consume a model request', async () => {
  let calls = 0; const worker = createWorker({ fetch: async () => { calls++; } });
  assert.equal((await worker.fetch(request({ message: 'x'.repeat(501) }), allEnv)).status, 400);
  const tooBig = new Request('https://bridge.test/chat', { method: 'POST', headers: { authorization: `Bearer ${ACCESS}` }, body: 'x'.repeat(20001) });
  assert.equal((await worker.fetch(tooBig, allEnv)).status, 413);
  assert.equal(calls, 0);
});

test('dashboard deployment bundle exports only the Worker entry point', async () => {
  const bundle = await import('./deploy.js');
  assert.deepEqual(Object.keys(bundle), ['default']);
  const result = await bundle.default.fetch(new Request('https://bridge.test/health'), {});
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).configured, []);
});

test('client-supported trailing slash uses the same authenticated chat route', async () => {
  const worker = createWorker({ fetch: async url => response(identify(url)) });
  const original = request();
  const trailing = new Request('https://bridge.test/chat/', original);
  assert.equal((await worker.fetch(trailing, { BOT_TOKEN: ACCESS, GROQ_API_KEY: 'mock' })).status, 200);
  assert.equal((await worker.fetch(new Request('https://bridge.test/health/'), {})).status, 200);
});
