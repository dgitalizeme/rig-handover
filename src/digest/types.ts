import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type StatusCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type NightDigest = {
  badLines: number;
  counts: StatusCounts;
  rows: DigestRow[];
};

type ParsedLine = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error: string | null;
};

const STATUSES = new Set<DigestStatus>(['ok', 'retry', 'fail']);

function parseLine(line: string): ParsedLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.at !== 'string' || typeof rec.job !== 'string') return null;
  if (typeof rec.status !== 'string' || !STATUSES.has(rec.status as DigestStatus)) return null;
  if (rec.owner !== null && rec.owner !== undefined && typeof rec.owner !== 'string') return null;
  if (rec.error !== undefined && typeof rec.error !== 'string') return null;
  return {
    at: rec.at,
    job: rec.job,
    status: rec.status as DigestStatus,
    owner: typeof rec.owner === 'string' ? rec.owner : null,
    error: typeof rec.error === 'string' ? rec.error : null,
  };
}

// One row per job. A line that does not parse is counted and skipped.
export function readNight(runsDir: string, night: string): NightDigest | null {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  const byJob = new Map<string, ParsedLine[]>();
  let badLines = 0;
  let sawLine = false;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    sawLine = true;
    const parsed = parseLine(line);
    if (!parsed) {
      badLines += 1;
      continue;
    }
    counts[parsed.status] += 1;
    const events = byJob.get(parsed.job);
    if (events) events.push(parsed);
    else byJob.set(parsed.job, [parsed]);
  }

  if (!sawLine) return { badLines: 0, counts, rows: [] };

  const rows = [...byJob.entries()]
    .map(([job, events]) => toRow(job, events))
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { badLines, counts, rows };
}

function toRow(job: string, events: ParsedLine[]): DigestRow {
  const ordered = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const last = ordered[ordered.length - 1];
  let lastError: string | null = null;
  for (const event of ordered) {
    if (event.error) lastError = event.error;
  }
  return {
    job,
    owner: last.owner,
    runs: ordered.length,
    retries: ordered.filter((event) => event.status === 'retry').length,
    lastStatus: last.status,
    lastError,
    firstAt: ordered[0].at,
    lastAt: last.at,
  };
}
