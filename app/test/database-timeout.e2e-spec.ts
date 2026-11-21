import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseService } from '../src/database/database.service.js';
import { validate } from '../src/config/env.validation.js';
import { configureApp } from '../src/setup.js';
import { prepareTestDatabase } from './support/test-db.js';

const db = await prepareTestDatabase();
// Test-only endpoint: exercises the production filter with a real cancelled SQL statement.
@Controller('database-probe')
class ProbeController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  @Get('slow') slow() {
    return this.db.query('SELECT pg_sleep(1)');
  }
  @Get('ok') async ok() {
    return (await this.db.query('SELECT 1 AS value')).rows[0];
  }
}
@Module({
  controllers: [ProbeController],
  providers: [
    DatabaseService,
    {
      provide: ConfigService,
      useFactory: () =>
        new ConfigService(
          validate({
            DATABASE_URL: db.ok ? db.url : undefined,
            DB_STATEMENT_TIMEOUT_MS: 300,
            DB_LOCK_TIMEOUT_MS: 80,
          }),
        ),
    },
  ],
})
class ProbeModule {}

describe.skipIf(!db.ok)(
  'Server SQL budgets and recovery with actual PostGIS',
  () => {
    let app: INestApplication, service: DatabaseService;
    beforeAll(async () => {
      app = await NestFactory.create(ProbeModule, { logger: false });
      configureApp(app);
      await app.init();
      service = app.get(DatabaseService);
      if (db.ok) {
        await db.pool.query(
          'CREATE TABLE sql_budget_probe(id int PRIMARY KEY,value int NOT NULL)',
        );
        await db.pool.query('INSERT INTO sql_budget_probe VALUES(1,0)');
      }
    });
    afterAll(async () => {
      await app?.close();
      if (db.ok) await db.pool.end();
    });
    it('sets real server-side budgets on pooled connections', async () => {
      const {
        rows: [settings],
      } =
        await service.query(`SELECT current_setting('statement_timeout') AS statement,
      current_setting('lock_timeout') AS lock`);
      expect(settings).toEqual({ statement: '300ms', lock: '80ms' });
    });
    it('cancels SQL on the server and reuses the connection after rollback', async () => {
      const {
        rows: [before],
      } = await service.query('SELECT pg_backend_pid() AS pid');
      await expect(
        service.transaction(async (c) => {
          await c.query('UPDATE sql_budget_probe SET value=7 WHERE id=1');
          await c.query('SELECT pg_sleep(1)');
        }),
      ).rejects.toMatchObject({ code: '57014' });
      const {
        rows: [after],
      } = await service.query(
        'SELECT pg_backend_pid() AS pid,value FROM sql_budget_probe',
      );
      expect(after).toEqual({ pid: before.pid, value: 0 });
    });
    it('bounds lock waiting and releases the timed-out transaction', async () => {
      if (!db.ok) throw Error('DB required');
      const blocker = await db.pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'SELECT * FROM sql_budget_probe WHERE id=1 FOR UPDATE',
        );
        await expect(
          service.transaction((c) =>
            c.query('UPDATE sql_budget_probe SET value=2 WHERE id=1'),
          ),
        ).rejects.toMatchObject({ code: '55P03' });
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      expect(
        (await service.query('SELECT value FROM sql_budget_probe')).rows,
      ).toEqual([{ value: 0 }]);
    });
    it('returns a safe retryable HTTP response and serves the next request', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/database-probe/slow')
        .expect(503);
      expect(response.body).toEqual({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'The database is busy. Please try again.',
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /pg_sleep|SELECT|postgres:\/\//,
      );
      await request(app.getHttpServer())
        .get('/api/database-probe/ok')
        .expect(200, { value: 1 });
    });
  },
);
