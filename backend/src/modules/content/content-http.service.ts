import {
  BadGatewayException,
  HttpException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ContentConfigService } from './content-config.service.js';

const PROVIDERS: Record<string, { provider: string; apiKeyEnv: string }> = {
  'api.openai.com': { provider: 'gpt', apiKeyEnv: 'OPENAI_API_KEY' },
  'generativelanguage.googleapis.com': {
    provider: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  'google.serper.dev': { provider: 'serper', apiKeyEnv: 'SERPER_API_KEY' },
  'api.tavily.com': { provider: 'tavily', apiKeyEnv: 'TAVILY_API_KEY' },
  'api.trello.com': {
    provider: 'trello',
    apiKeyEnv: 'TRELLO_API_KEY / TRELLO_API_TOKEN',
  },
};

@Injectable()
export class ContentHttpService {
  constructor(@Optional() private readonly config?: ContentConfigService) {}
  async json(
    url: string,
    init: RequestInit = {},
    attempts = 1,
    delayMs = 0,
  ): Promise<any> {
    const identity = PROVIDERS[new URL(url).hostname] ?? {
      provider: 'unknown',
      apiKeyEnv: '',
    };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(90_000),
        });
        const data = await response.json().catch(() => null);
        const errorText = JSON.stringify(
          data?.error ?? data?.detail ?? data?.message ?? '',
        );
        const quota =
          [402, 429, 432, 433].includes(response.status) ||
          /RESOURCE_EXHAUSTED|quota|credits? (?:exhausted|limit)|usage limit|insufficient credits/i.test(
            errorText,
          );
        const invalidKey =
          [401, 403].includes(response.status) ||
          /API_KEY_INVALID|API key not valid|invalid api.?key|invalid token/i.test(
            errorText,
          );
        if (quota || invalidKey) {
          const failureKind = quota
            ? [402, 432, 433].includes(response.status) ||
              /quota|credits?|usage limit/i.test(errorText)
              ? 'quota'
              : 'rate_limit'
            : 'invalid';
          this.config?.observe(identity.provider, failureKind);
          throw new HttpException(
            {
              code: quota
                ? 'PROVIDER_QUOTA_OR_RATE_LIMIT'
                : 'PROVIDER_CREDENTIAL_INVALID',
              ...identity,
              message: quota
                ? `${identity.provider}: hết quota/credit hoặc bị giới hạn tần suất. Kiểm tra quota, đợi nếu bị rate limit, hoặc thay key trong ${identity.apiKeyEnv}.`
                : `${identity.provider}: key/token không hợp lệ hoặc thiếu quyền. Kiểm tra hoặc thay ${identity.apiKeyEnv}.`,
              requiresUserAction: true,
              failureKind,
              providerStatus: response.status,
            },
            quota ? 429 : 502,
          );
        }
        if (!response.ok || data?.error || data?.success === false) {
          throw new HttpException(
            {
              code: 'PROVIDER_REQUEST_FAILED',
              ...identity,
              message: `${identity.provider}: yêu cầu thất bại`,
              providerStatus: response.status,
            },
            response.status >= 500 || response.ok ? 502 : response.status,
          );
        }
        if (data === null)
          throw new BadGatewayException('Invalid content provider JSON');
        this.config?.observe(identity.provider, 'ready');
        return data;
      } catch (error) {
        const details =
          error instanceof HttpException ? error.getResponse() : null;
        const needsAction =
          typeof details === 'object' &&
          details !== null &&
          'requiresUserAction' in details;
        if (attempt === attempts || needsAction) {
          if (error instanceof HttpException) throw error;
          throw new BadGatewayException({
            code: 'PROVIDER_UNAVAILABLE',
            ...identity,
            message: `${identity.provider}: không kết nối được hoặc phản hồi không hợp lệ`,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}
