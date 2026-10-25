import {
  BadRequestException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';

export interface BrowserSession {
  username: string;
  token: string;
  expiresAt: number;
  remember: boolean;
}
const COOKIE = 'autowrite-session';

@Injectable()
export class BrowserSessionService {
  constructor(private readonly auth: AuthService) {}
  private key() {
    const secret =
      process.env.BROWSER_SESSION_SECRET?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!secret?.trim())
      throw new ServiceUnavailableException(
        'Browser session signing is not configured',
      );
    return createHash('sha256')
      .update('autowrite/browser-session/v1\0')
      .update(secret)
      .digest();
  }
  private signature(payload: string) {
    return createHmac('sha256', this.key()).update(payload).digest();
  }
  private options(request: Request) {
    return {
      httpOnly: true,
      secure:
        request.secure || request.headers['x-forwarded-proto'] === 'https',
      sameSite: 'strict' as const,
      path: '/api',
    };
  }
  clear(request: Request, response: Response) {
    response.clearCookie(COOKIE, this.options(request));
  }
  read(request: Request): BrowserSession {
    try {
      const value = request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(COOKIE + '='))
        ?.slice(COOKIE.length + 1);
      if (!value || value.length > 12000) throw Error();
      const [payload, signature, extra] = decodeURIComponent(value).split('.');
      if (!payload || !signature || extra) throw Error();
      const actual = Buffer.from(signature, 'base64url');
      const expected = this.signature(payload);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw Error();
      const session: BrowserSession = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      );
      if (
        !session.token ||
        typeof session.token !== 'string' ||
        typeof session.username !== 'string' ||
        !session.username.trim() ||
        !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= Date.now()
      )
        throw Error();
      return session;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnauthorizedException({
        message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
        sessionExpired: true,
      });
    }
  }
  identity(session: BrowserSession) {
    return { username: session.username, expiresAt: session.expiresAt };
  }
  uid(session: BrowserSession) {
    return 'tinfos:' + session.username.trim().toLowerCase();
  }
  async login(
    request: Request,
    response: Response,
    body: { username: string; password: string; remember?: boolean },
  ) {
    if (
      !body ||
      typeof body.username !== 'string' ||
      !body.username.trim() ||
      typeof body.password !== 'string' ||
      !body.password ||
      (body.remember !== undefined && typeof body.remember !== 'boolean')
    )
      throw new BadRequestException('Nhập tên đăng nhập và mật khẩu');
    this.key();
    return this.auth.withSession(null, async () => {
      const token = await this.auth.login(body.username.trim(), body.password);
      const session: BrowserSession = {
        username: body.username.trim(),
        token,
        expiresAt: this.auth.expiration(),
        remember: body.remember === true,
      };
      if (session.expiresAt <= Date.now())
        throw new UnauthorizedException('Upstream session has already expired');
      const payload = Buffer.from(JSON.stringify(session)).toString(
        'base64url',
      );
      response.cookie(
        COOKIE,
        payload + '.' + this.signature(payload).toString('base64url'),
        {
          ...this.options(request),
          ...(session.remember
            ? { maxAge: session.expiresAt - Date.now() }
            : {}),
        },
      );
      response.setHeader('Cache-Control', 'no-store');
      return this.identity(session);
    });
  }
  async run<T>(
    request: Request,
    response: Response,
    work: () => Promise<T>,
  ): Promise<T> {
    const session = this.read(request);
    return this.auth.withSession(
      session.token,
      async () => {
        try {
          const result = await work();
          if (!this.auth.get()) {
            this.clear(request, response);
            return { ...result, sessionExpired: true };
          }
          return result;
        } catch (error) {
          if (!this.auth.get()) {
            this.clear(request, response);
            if (error instanceof HttpException) {
              const detail = error.getResponse();
              throw new HttpException(
                {
                  ...(typeof detail === 'object'
                    ? detail
                    : { message: detail }),
                  sessionExpired: true,
                },
                error.getStatus(),
              );
            }
          }
          throw error;
        }
      },
      session.expiresAt,
    );
  }
}
