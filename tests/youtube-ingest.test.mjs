import { test } from 'node:test';
import assert from 'node:assert';
import { extractVideoId, registerYouTubeIngestTool } from '../src/tools/youtube-ingest.js';

test('extractVideoId: watch URL', () => {
  assert.strictEqual(extractVideoId('https://www.youtube.com/watch?v=5Q_4S9C9ZPM'), '5Q_4S9C9ZPM');
});

test('extractVideoId: youtu.be short URL', () => {
  assert.strictEqual(extractVideoId('https://youtu.be/5Q_4S9C9ZPM?si=abc'), '5Q_4S9C9ZPM');
});

test('extractVideoId: embed URL', () => {
  assert.strictEqual(extractVideoId('https://www.youtube.com/embed/5Q_4S9C9ZPM'), '5Q_4S9C9ZPM');
});

test('extractVideoId: shorts URL', () => {
  assert.strictEqual(extractVideoId('https://www.youtube.com/shorts/5Q_4S9C9ZPM'), '5Q_4S9C9ZPM');
});

test('extractVideoId: invalid inputs', () => {
  assert.strictEqual(extractVideoId(null), null);
  assert.strictEqual(extractVideoId(''), null);
  assert.strictEqual(extractVideoId('https://example.com/notyt'), null);
});

test('registerYouTubeIngestTool: registers youtube.ingest', async () => {
  const registered = [];
  const registry = { register: (t) => registered.push(t) };
  const res = await registerYouTubeIngestTool(registry);
  assert.deepStrictEqual(res, { registered: ['youtube.ingest'] });
  assert.strictEqual(registered.length, 1);
  assert.strictEqual(registered[0].name, 'youtube.ingest');
  assert.strictEqual(registered[0].category, 'read');
  assert.strictEqual(registered[0].level, 'L2');
  assert.deepStrictEqual(registered[0].inputSchema.required, ['url']);
});

test('registerYouTubeIngestTool: rejects invalid registry', async () => {
  await assert.rejects(() => registerYouTubeIngestTool(null));
  await assert.rejects(() => registerYouTubeIngestTool({}));
});
