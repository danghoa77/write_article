import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

@Injectable()
export class AuthService {
  private token: string | null = null;
  private readonly sessions = new AsyncLocalStorage<{
    token: string | null;
    expiresAt: number;
  }>();
  private tokenExpiresAt = 0;

  get(): string | null {
    const session = this.sessions.getStore();
    return session ? session.token : this.token;
  }

  set(token: string, expiresAt?: number): void {
    if (!token.trim()) {
      throw new Error('Token không được để trống');
    }

    let expiration = expiresAt ?? Date.now() + 8 * 60 * 60 * 1000;
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      );
      if (Number.isFinite(payload.exp))
        expiration = Math.min(expiration, payload.exp * 1000);
    } catch {
      /* Opaque upstream sessions use the cookie expiration or app session limit. */
    }
    const session = this.sessions.getStore();
    if (session) {
      session.token = token;
      session.expiresAt = expiration;
    } else {
      this.token = token;
      this.tokenExpiresAt = expiration;
    }
  }

  expiration(): number {
    return this.sessions.getStore()?.expiresAt ?? this.tokenExpiresAt;
  }

  withSession<T>(
    token: string | null,
    work: () => Promise<T>,
    expiresAt = 0,
  ): Promise<T> {
    return this.sessions.run({ token, expiresAt }, work);
  }

  async deleteToken(): Promise<boolean> {
    const existed = this.get() !== null;
    const session = this.sessions.getStore();
    if (session) session.token = null;
    else this.token = null;
    return existed;
  }

  async login(username: string, password: string) {
    try {
      const response = await fetch(
        'https://dash.tinfosmedia.com/api/auth/sign-in',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const data = await response.json().catch(() => null);

      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException(
          data ?? 'Username hoặc password không chính xác',
        );
      }

      if (!response.ok) {
        throw new HttpException(
          data ?? 'Authentication server error',
          response.status >= 500 ? 502 : response.status,
        );
      }

      const sessionCookie = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('auth-session='));
      const cookiePair = sessionCookie?.split(';', 1)[0]?.trim();

      if (!cookiePair) {
        throw new BadGatewayException('Không tìm thấy auth-session');
      }

      const separator = cookiePair.indexOf('=');

      const token = cookiePair.slice(separator + 1);

      if (!token) {
        throw new BadGatewayException('Token rỗng');
      }

      const maxAge = /;\s*Max-Age=(\d+)/i.exec(sessionCookie ?? '');
      const expires = /;\s*Expires=([^;]+)/i.exec(sessionCookie ?? '');
      const cookieExpiration = maxAge
        ? Date.now() + Number(maxAge[1]) * 1000
        : expires
          ? Date.parse(expires[1])
          : undefined;
      this.set(
        token,
        cookieExpiration && Number.isFinite(cookieExpiration)
          ? cookieExpiration
          : undefined,
      );
      return token;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException('Authentication server timed out');
      }

      throw new BadGatewayException('Không thể kết nối authentication server');
    }
  }
}
