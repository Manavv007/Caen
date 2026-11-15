import { beforeEach, describe, expect, it } from 'vitest';
import { handleReportError, sanitizeReports } from '../src/client-errors.js';
import { FakeBackend } from './fake-backend.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const post = (body) => new Request('https://shop.test/api/report-error', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'user-agent': 'TestPhone/1.0' },
});

let backend;
beforeEach(() => { backend = new FakeBackend(); });
const send = async (body, env = ENV) => {
  const res = await handleReportError(post(body), env, { fetch: backend.fetch });
  return res.status;
};

describe('POST /api/report-error', () => {
  it('stores a report with page path only (no query string) and the browser', async () => {
    expect(await send({ reports: [{ kind: 'error', message: 'x is undefined', page: '/checkout?email=a@b.c', source: '/_astro/a.js:1:2' }] })).toBe(204);
    expect(backend.tables.client_errors).toHaveLength(1);
    expect(backend.tables.client_errors[0]).toMatchObject({ kind: 'error', message: 'x is undefined', page: '/checkout', source: '/_astro/a.js:1:2', user_agent: 'TestPhone/1.0' });
  });

  it('stores at most 5 reports per request', async () => {
    await send({ reports: Array.from({ length: 9 }, (_, i) => ({ kind: 'tryon', message: `m${i}` })) });
    expect(backend.tables.client_errors.map((r) => r.message)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('truncates long fields', () => {
    const [row] = sanitizeReports({ reports: [{ kind: 'error', message: 'y'.repeat(900), stack: 's'.repeat(5000), source: 'q'.repeat(400) }] }, 'u'.repeat(400));
    expect([row.message.length, row.stack.length, row.source.length, row.user_agent.length]).toEqual([500, 2000, 300, 300]);
  });

  it.each([
    ['unknown kind', { reports: [{ kind: 'sql', message: 'x' }] }],
    ['empty message', { reports: [{ kind: 'error', message: '   ' }] }],
    ['no reports array', { message: 'x' }],
    ['malformed JSON', '{nope'],
    ['oversized body', JSON.stringify({ reports: [{ kind: 'error', message: 'z'.repeat(9000) }] })],
  ])('ignores %s, still answering 204', async (_, body) => {
    expect(await send(body)).toBe(204);
    expect(backend.tables.client_errors).toHaveLength(0);
  });

  it('answers 204 and stores nothing when the database is not configured', async () => {
    expect(await send({ reports: [{ kind: 'error', message: 'x' }] }, {})).toBe(204);
    expect(backend.tables.client_errors).toHaveLength(0);
  });

  it('sanitizeReports keeps only allowed fields', () => {
    const [row] = sanitizeReports({ reports: [{ kind: 'checkout', message: 'boom', page: '/x#frag', email: 'a@b.c', extra: 1 }] }, 'UA');
    expect(Object.keys(row).sort()).toEqual(['kind', 'message', 'page', 'source', 'stack', 'user_agent']);
    expect(row.page).toBe('/x');
  });
});
