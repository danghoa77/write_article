import {
  BadGatewayException, BadRequestException, HttpException, Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service.js';
import type { Article, ArticleSlugBody, UpdateArticleBody } from './article.model.js';
import { ARTICLE_UPDATE_HEADERS, DEFAULT_SLUG_SUFFIX } from './article-workflow.config.js';

@Injectable()
export class ArticlesService {
  constructor(private readonly authService: AuthService) {}

  async createPost(): Promise<string> {
    const token = this.requireToken();
    const data = await this.send('https://dash.tinfosmedia.com/api/posts', {
      method: 'POST',
      headers: {
        Cookie: `auth-session=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Untitled Post' }),
    }, token);
    if (typeof data?.postId !== 'string' || !data.postId) {
      throw new BadGatewayException('missing postId in create response');
    }
    return data.postId;
  }

  async updatePost(postId: string, body: UpdateArticleBody) {
    this.validateId(postId);
    this.validateUpdate(body);
    const token = this.requireToken();
    return this.send(`https://dash.tinfosmedia.com/api/posts/${encodeURIComponent(postId)}`, {
      method: 'PUT',
      headers: {
        ...ARTICLE_UPDATE_HEADERS,
        cookie: `auth-session=${token};`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        categories: body.categories,
        title: body.title,
        content: body.content,
        slug: body.slug,
        featured_image: body.featured_image,
        featured_image_thumbnail: body.featured_image_thumbnail,
      }),
    }, token, true);
  }

  async publishPost(postId: string) {
    this.validateId(postId);
    const token = this.requireToken();
    return this.send(`https://dash.tinfosmedia.com/api/posts/${encodeURIComponent(postId)}/publish`, {
      method: 'POST',
      headers: { Cookie: `auth-session=${token}` },
    }, token);
  }

  generateSlug(body: ArticleSlugBody): string {
    if (!body || typeof body.title !== 'string' || typeof body.postId !== 'string'
      || (body.suffix !== undefined && typeof body.suffix !== 'string')) {
      throw new BadRequestException('title, postId and optional suffix must be strings');
    }
    // Same algorithm as gen_slug1; only its fixed suffix is configurable.
    const part1 = body.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, ' ').trim().split(' ').filter(word => word.length > 3)
      .slice(0, 10).join('-');
    const suffix = body.suffix ?? process.env.ARTICLE_SLUG_SUFFIX ?? DEFAULT_SLUG_SUFFIX;
    return `${part1}-${suffix}-${body.postId.slice(-6)}`;
  }

  private requireToken(): string {
    const token = this.authService.get();
    if (!token) throw new UnauthorizedException('missing token');
    return token;
  }

  private validateId(postId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(postId)) {
      throw new BadRequestException('invalid postId');
    }
  }

  private validateUpdate(body: UpdateArticleBody) {
    const fields = ['title', 'content', 'slug', 'featured_image', 'featured_image_thumbnail'] as const;
    if (!body || !Array.isArray(body.categories)
      || !body.categories.every(id => Number.isInteger(id))
      || fields.some(key => typeof body[key] !== 'string')) {
      throw new BadRequestException('Required: categories (integer array), title, content, slug, featured_image, featured_image_thumbnail (strings)');
    }
  }

  private async send(url: string, init: RequestInit, token: string, fullResponse = false) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new HttpException(data ?? 'Article server error', response.status >= 500 ? 502 : response.status);
      }
      if (data?.success === false) throw new BadGatewayException(data);
      if (fullResponse) {
        return {
          body: data,
          headers: Object.fromEntries(response.headers.entries()),
          statusCode: response.status,
          statusMessage: response.statusText,
        };
      }
      return data;
    } catch (error) {
      if (this.authService.get() === token) await this.authService.deleteToken();
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException('Không thể kết nối dịch vụ bài viết');
    }
  }
}
