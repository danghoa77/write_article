import { Module } from '@nestjs/common';
import { ArticlesModule } from './articles/articles.module.js';

@Module({
  imports: [ArticlesModule],
})
export class AppModule {}