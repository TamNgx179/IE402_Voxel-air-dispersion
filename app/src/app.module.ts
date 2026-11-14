import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_ROOT, type AppConfig, validate } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { SimulationResultsModule } from './modules/results/simulation-results.module.js';
import { ScenariosModule } from './modules/scenarios/scenarios.module.js';
import { SimulationModule } from './modules/simulation/simulation.module.js';
import { StudyAreasModule } from './modules/study-areas/study-areas.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // app/.env is optional; real environment variables take precedence.
      envFilePath: join(APP_ROOT, '.env'),
      validate: (env) => validate(env),
    }),
    // Static viewers on the same origin as the API (BR-28):
    //   /legacy/  the vanilla viewer from <REPO_ROOT>/web (kept for comparison)
    //   /         the React viewer built to <REPO_ROOT>/frontend/dist
    // Without a frontend build (fresh checkout, API-only tests) "/" falls back to
    // the legacy viewer so the app stays usable.
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const repoRoot = config.get('REPO_ROOT', { infer: true });
        const legacy = join(repoRoot, 'web');
        const frontend = join(repoRoot, 'frontend', 'dist');
        return [
          {
            rootPath: legacy,
            serveRoot: '/legacy',
            exclude: /^\/api(\/|$)/,
          },
          {
            rootPath: existsSync(join(frontend, 'index.html'))
              ? frontend
              : legacy,
            exclude: /^\/(api|legacy)(\/|$)/,
          },
        ];
      },
    }),
    DatabaseModule,
    HealthModule,
    StudyAreasModule,
    ScenariosModule,
    SimulationModule,
    SimulationResultsModule,
  ],
})
export class AppModule {}
