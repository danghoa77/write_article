import {
    BadGatewayException,
    GatewayTimeoutException,
    HttpException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class AuthService {
    private readonly tokens = new Map<string, string>();

    get(key: string): string | null {
        return this.tokens.get(key) ?? null;
    }

    set(key: string, token: string): void {
        if (!token) {
            throw new Error('Token không được để trống');
        }

        this.tokens.set(key, token);
    }


    async deleteToken(key: string): Promise<boolean> {
        return this.tokens.delete(key);
    }


    async login(username: string, password: string) {
        try {
            const response = await fetch(
                'https://dash.tinfosmedia.com/api/auth/sign-in',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
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

            const cookiePair = response.headers
                .getSetCookie()
                .map((cookie) => cookie.split(';', 1)[0]?.trim())
                .find((cookie) => cookie?.startsWith('auth-session='));

            if (!cookiePair) {
                throw new BadGatewayException('Không tìm thấy auth-session');
            }

            const separator = cookiePair.indexOf('=');

            const key = cookiePair.slice(0, separator);
            const token = cookiePair.slice(separator + 1);

            if (!token) {
                throw new BadGatewayException('Token rỗng');
            }

            this.set(key, token);
            return this.get(key);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            if (error instanceof Error && error.name === 'TimeoutError') {
                throw new GatewayTimeoutException(
                    'Authentication server timed out',
                );
            }

            throw new BadGatewayException('Không thể kết nối authentication server');
        }
    }
}
