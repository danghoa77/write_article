import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ArticlesService } from './articles.service.js';
import type { ArticleSlugBody, UpdateArticleBody } from './article.model.js';

@Controller('articles')
export class ArticlesController {
  constructor(
    private readonly articlesService: ArticlesService,
  ) {}


  @Post()
  createPost() {
    return this.articlesService.createPost();
  }

  @Post('slug')
  generateSlug(@Body() body: ArticleSlugBody) {
    return this.articlesService.generateSlug(body);
  }

  @Put(':postId')
  updatePost(@Param('postId') postId: string, @Body() body: UpdateArticleBody) {
    return this.articlesService.updatePost(postId, body);
  }

  @Post(':postId/publish')
  publishPost(@Param('postId') postId: string) {
    return this.articlesService.publishPost(postId);
  }
}
