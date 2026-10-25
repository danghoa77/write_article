import { Module } from '@nestjs/common';
import { ArticlesModule } from './modules/articles/articles.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ContentModule } from './modules/content/content.module.js';

@Module({
  imports: [ArticlesModule, AuthModule, ContentModule],
})
export class AppModule { }
