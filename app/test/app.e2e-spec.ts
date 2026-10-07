import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-db.js';

/** HTTP shell of the app; passes with or without a database. */
describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // createTestApp uses NestFactory rather than Test.createTestingModule:
    // ServeStaticModule picks its loader from the HTTP adapter while the
    // module graph is compiled, and the testing module has no adapter yet.
    app = await createTestApp({ EXECUTOR_ENABLED: 'false' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns 200 with the health report', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect('Content-Type', /json/);

    const body = res.body as Record<string, any>;
    expect(['ok', 'degraded']).toContain(body.status);
    expect(typeof body.app.version).toBe('string');
    expect(body.artifactDir).toEqual({
      path: expect.any(String),
      exists: expect.any(Boolean),
      writable: expect.any(Boolean),
    });
    expect(typeof body.python.bin).toBe('string');
    expect(typeof body.python.ok).toBe('boolean');
    if (body.python.ok) {
      expect(body.python.version).toMatch(/Python/i);
    } else {
      expect(typeof body.python.error).toBe('string');
    }
    expect(['not_configured', 'up', 'down']).toContain(body.database.status);
    expect(body.database.configured).toBe(
      body.database.status !== 'not_configured',
    );
    if (body.database.status === 'up')
      expect(body.database.postgis).toMatch(/^3\./);
    const healthy =
      body.artifactDir.exists &&
      body.artifactDir.writable &&
      body.python.ok &&
      body.database.status !== 'down';
    expect(body.status).toBe(healthy ? 'ok' : 'degraded');
  });

  it('result routes validate UUID before touching the database', async () => {
    await request(app.getHttpServer())
      .get('/api/runs/abc/slices?z_m=2')
      .expect(400);
  });

  it('POST /api/runs validates the body before touching the database', async () => {
    await request(app.getHttpServer()).post('/api/runs').send({}).expect(400);
  });

  it('unknown /api routes are 404, not the web index', async () => {
    await request(app.getHttpServer()).get('/api/nope').expect(404);
  });

  it('GET / serves the static web viewer', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Content-Type', /html/);
  });
});
