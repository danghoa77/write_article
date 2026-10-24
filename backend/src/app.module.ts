import { Module } from '@nestjs/common';
import { ArticlesModule } from './modules/articles/articles.module.js';

@Module({
  imports: [ArticlesModule],
})
export class AppModule { }