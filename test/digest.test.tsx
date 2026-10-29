import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight, type NightDigest } from '../src/digest/types.js';

const base = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

function tempRuns(): string {
  return mkdtempSync(join(tmpdir(), 'rig-runs-'));
}

function appFor(runsDir: string) {
  return createApp({ ...base, runsDir });
}

describe('run log reader', () => {
  it('reads runs/2026-10-28.jsonl into 5 jobs and 1 bad line', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest).not.toBeNull();
    const night = digest as NightDigest;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.rows.find((row) => row.job === 'digest/render')?.owner).toBeNull();
    expect(night.rows.find((row) => row.job === 'fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
    });
    expect(night.rows.find((row) => row.job === 'notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      owner: 'lane-07',
    });
    expect(night.rows.find((row) => row.job === 'lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
    });
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('digest routes', () => {
  it('renders 2026-10-28 and returns the same jobs in the same order as JSON', async () => {
    const app = appFor('runs');
    const page = await app.request('/digest/2026-10-28');
    const html = await page.text();
    const body = (await (await app.request('/api/digest/2026-10-28')).json()) as NightDigest;
    expect(page.status).toBe(200);
    expect(html).toContain('digest · 2026-10-28');
    expect(body.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    let at = 0;
    for (const job of body.rows.map((row) => row.job)) {
      const next = html.indexOf(job, at);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it('returns 200 for a night with rows', async () => {
    const dir = tempRuns();
    writeFileSync(
      join(dir, '2026-10-01.jsonl'),
      '{"at":"2026-10-01T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}\n',
    );
    const res = await appFor(dir).request('/digest/2026-10-01');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('lane/sync');
  });

  it('returns 404 when the night file is missing', async () => {
    const dir = tempRuns();
    const app = appFor(dir);
    expect((await app.request('/digest/2026-10-02')).status).toBe(404);
    expect((await app.request('/api/digest/2026-10-02')).status).toBe(404);
  });

  it('renders nothing ran for an empty night', async () => {
    const dir = tempRuns();
    writeFileSync(join(dir, '2026-10-03.jsonl'), '');
    const page = await appFor(dir).request('/digest/2026-10-03');
    const body = (await (await appFor(dir).request('/api/digest/2026-10-03')).json()) as NightDigest;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(body.rows).toEqual([]);
  });

  it('still renders a night that contains a bad line', async () => {
    const dir = tempRuns();
    writeFileSync(
      join(dir, '2026-10-04.jsonl'),
      [
        '{"at":"2026-10-04T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
        '{"at":"2026-10-04T02:00:00+01:00","job":"lane/sy',
      ].join('\n'),
    );
    const app = appFor(dir);
    const page = await app.request('/digest/2026-10-04');
    const body = (await (await app.request('/api/digest/2026-10-04')).json()) as NightDigest;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('lane/sync');
    expect(body.badLines).toBe(1);
    expect(body.rows.map((row) => row.job)).toEqual(['lane/sync']);
  });
});

describe('status board nights', () => {
  it('links both nights on disk to a digest that renders', async () => {
    const app = appFor('runs');
    const html = await (await app.request('/')).text();
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('10 ok · 4 retry · 1 fail');
    expect(html).toContain('7 ok · 0 retry · 0 fail');
    expect((await app.request('/digest/2026-10-28')).status).toBe(200);
    expect((await app.request('/digest/2026-10-27')).status).toBe(200);
  });
});
