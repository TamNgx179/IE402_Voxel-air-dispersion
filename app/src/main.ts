import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/env.validation.js';
import { API_PREFIX, configureApp } from './setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Web viewer:  http://localhost:${port}/`);
  logger.log(`Health:      http://localhost:${port}/${API_PREFIX}/health`);
  logger.log(`Swagger UI:  http://localhost:${port}/${API_PREFIX}/docs`);
}
await bootstrap();
