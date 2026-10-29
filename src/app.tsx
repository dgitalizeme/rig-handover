import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/types.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { DigestPage } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard, type NightLink } from './views/status.js';

function nightLinks(runsDir: string, nights: string[]): NightLink[] {
  return nights.map((night) => {
    const digest = readNight(runsDir, night);
    return {
      night,
      counts: digest?.counts ?? { ok: 0, retry: 0, fail: 0 },
    };
  });
}

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) => {
    const status = readStatus(config);
    return c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={status} nights={nightLinks(config.runsDir, status.nights)} />
      </Layout>,
    );
  });

  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);
    if (!digest) return c.notFound();
    return c.html(
      <Layout title={`digest ${night}`} lane={lane()}>
        <DigestPage night={night} digest={digest} />
      </Layout>,
    );
  });

  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);
    if (!digest) return c.notFound();
    return c.json(digest);
  });

  return app;
}
