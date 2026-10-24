import { Injectable } from '@nestjs/common';
import type { Article } from './article.model.js';

@Injectable()
export class ArticlesService {
  findAll(): Article[] {
    return [
      {
        id: 1,
        title: 'Kết nối React và NestJS thành công',
        status: 'draft',
      },
      {
        id: 2,
        title: 'Project đã sẵn sàng để deploy thử',
        status: 'published',
      },
    ];
  }
}