import { Controller, Get } from '@nestjs/common';
import { ArticlesService } from './articles.service.js';

@Controller('articles')
export class ArticlesController {
  constructor(
    private readonly articlesService: ArticlesService,
  ) {}

  @Get()
  findAll() {
    return this.articlesService.findAll();
  }
}