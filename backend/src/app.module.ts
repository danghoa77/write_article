import { Module } from '@nestjs/common';
import { ArticlesModule } from './modules/articles/articles.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [ArticlesModule, AuthModule],
})
export class AppModule { }