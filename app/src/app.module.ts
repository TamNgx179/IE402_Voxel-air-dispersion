import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_ROOT, type AppConfig, validate } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ResultsModule } from './modules/results/results.module.js';
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
    // Static web viewer at "/" (BR-28: same origin as the API).
    // Until assets move into app/public/ (ROADMAP §11) it serves <REPO_ROOT>/web.
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => [
        {
          rootPath: join(config.get('REPO_ROOT', { infer: true }), 'web'),
          exclude: /^\/api(\/|$)/,
        },
      ],
    }),
    DatabaseModule,
    HealthModule,
    StudyAreasModule,
    ScenariosModule,
    SimulationModule,
    ResultsModule,
  ],
})
export class AppModule {}
