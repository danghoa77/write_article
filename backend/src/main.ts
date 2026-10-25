import './environment.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '1mb' });

  app.setGlobalPrefix('api');

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
