import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const API_PREFIX = 'api';

/**
 * HTTP setup shared by main.ts and the e2e tests, so tests exercise the same
 * routes (`/api/...`) as the running app.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  // DTO validation (BR-16): unknown properties are a 400, never silently dropped.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Voxel air dispersion API')
      .setDescription(
        'NestJS modular monolith: study areas, scenarios, simulation runs and results',
      )
      .setVersion('0.0.1')
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
