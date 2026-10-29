import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { FirebaseService } from '../firebase/firebase.service.js';
import { ContentConfigService } from './content-config.service.js';

export const SECRET_FIELDS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'TAVILY_API_KEY',
  'SERPER_API_KEY',
  'TRELLO_API_KEY',
  'TRELLO_API_TOKEN',
] as const;
export const PROVIDER_KEYS: Record<string, string[]> = {
  gemini: ['GEMINI_API_KEY'],
  gpt: ['OPENAI_API_KEY'],
  tavily: ['TAVILY_API_KEY'],
  serper: ['SERPER_API_KEY'],
  trello: ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'],
};
export const KEY_POOL_PROVIDERS = [
  'gemini',
  'gpt',
  'tavily',
  'serper',
] as const;
export type KeyPoolProvider = (typeof KEY_POOL_PROVIDERS)[number];
export type KeyPoolAction = {
  revision: number;
  provider: KeyPoolProvider;
  action: 'add' | 'rename' | 'select' | 'delete' | 'reuse';
  id?: string;
  label?: string;
  key?: string;
};
type StoredKey = {
  id: string;
  label: string;
  encrypted: string;
  fingerprint: string;
};
export type WorkspaceOptions = {
  slugSuffix: string;
  textProvider: 'gemini' | 'gpt';
  imageProvider: 'tavily' | 'serper';
  geminiModel: string;
  openaiModel: string;
  categories: { id: number; name: string }[];
};
export type LibraryItem = {
  id: string;
  title: string;
  caption: string;
  content: string;
  note?: string;
};

@Injectable()
export class WorkspaceSettingsService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ContentConfigService,
  ) {}
  private reference(uid: string, name = 'workspace') {
    return this.firebase
      .database()
      .collection('users')
      .doc(encodeURIComponent(uid))
      .collection('settings')
      .doc(name);
  }
  private encryptionKey() {
    const secret =
      process.env.WORKSPACE_ENCRYPTION_KEY?.trim() ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!secret?.trim())
      throw new ServiceUnavailableException(
        'Workspace secret encryption is not configured',
      );
    return createHash('sha256')
      .update('autowrite/provider-credentials/v1\0')
      .update(secret)
      .digest();
  }
  private encrypt(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }
  private decrypt(value: string) {
    try {
      const [iv, tag, ciphertext] = value
        .split('.')
        .map((part) => Buffer.from(part, 'base64url'));
      const cipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([
        cipher.update(ciphertext),
        cipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException(
        'Cannot decrypt saved provider credentials; check server encryption key',
      );
    }
  }
  private values(saved: any): Record<string, string> {
    return Object.fromEntries(
      Object.entries(saved.secrets ?? {}).map(([key, value]) => [
        key,
        this.decrypt(value as string),
      ]),
    );
  }
  private defaults(): WorkspaceOptions {
    const cfg = this.config.defaults();
    return {
      slugSuffix: 'danghoa123',
      textProvider: 'gemini',
      imageProvider: 'tavily',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
      openaiModel: process.env.OPENAI_MODEL ?? '',
      categories: cfg.teams.flatMap((team) =>
        team.categories.map((id) => ({ id, name: team.team })),
      ),
    };
  }
  private response(saved: any = {}) {
    const values = this.values(saved);
    const credentials = Object.fromEntries(
      SECRET_FIELDS.map((name) => [
        name,
        {
          configured: !!(
            name in values ? values[name] : process.env[name]
          )?.trim(),
          saved: name in values,
        },
      ]),
    );
    const providers = Object.fromEntries(
      Object.entries(PROVIDER_KEYS).map(([name, keys]) => {
        const status = saved.health?.[name];
        return [
          name,
          {
            configured: keys.every((key) => credentials[key].configured),
            status:
              status?.fingerprint === this.config.fingerprint(name, values)
                ? status.status
                : 'unverified',
            updatedAt: status?.updatedAt ?? null,
          },
        ];
      }),
    );
    return {
      settings: this.options(saved),
      revision: saved.revision ?? 0,
      updatedAt: saved.updatedAt ?? null,
      credentials,
      providers,
      keyPools: Object.fromEntries(
        KEY_POOL_PROVIDERS.map((provider) => {
          const pool = this.pool(saved, provider);
          const active = this.config.fingerprint(provider, values);
          return [
            provider,
            pool.map((item) => {
              const health =
                saved.keyHealth?.[provider]?.[item.fingerprint] ??
                (saved.health?.[provider]?.fingerprint === item.fingerprint
                  ? saved.health[provider]
                  : null);
              return {
                id: item.id,
                label: item.label,
                active: item.fingerprint === active,
                status: health?.status ?? 'unverified',
                updatedAt: health?.updatedAt ?? null,
              };
            }),
          ];
        }),
      ),
    };
  }
  private options(saved: any): WorkspaceOptions {
    const settings = { ...saved.settings };
    // Notes belong to source content. Ignore notes saved by older versions globally.
    delete settings.note;
    delete settings.concurrency;
    return { ...this.defaults(), ...settings };
  }
  private async read(uid: string) {
    try {
      return (await this.reference(uid).get()).data() ?? {};
    } catch (error) {
      this.storageError(error);
    }
  }
  async get(uid: string) {
    return this.response(await this.read(uid));
  }
  private pool(saved: any, provider: KeyPoolProvider): StoredKey[] {
    const pool: StoredKey[] = [...(saved.keyPools?.[provider] ?? [])];
    const field = PROVIDER_KEYS[provider][0];
    const value =
      field in (saved.secrets ?? {})
        ? this.decrypt(saved.secrets[field])
        : (process.env[field] ?? '');
    if (value.trim()) {
      const fingerprint = this.config.fingerprint(provider, { [field]: value });
      if (!pool.some((item) => item.fingerprint === fingerprint))
        pool.unshift({
          id: 'current',
          label: 'Key hiện tại',
          encrypted: saved.secrets?.[field] ?? this.encrypt(value),
          fingerprint,
        });
    }
    return pool;
  }

  async manageKeys(uid: string, body: KeyPoolAction) {
    if (
      !body ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      !KEY_POOL_PROVIDERS.includes(body.provider) ||
      !['add', 'rename', 'select', 'delete', 'reuse'].includes(body.action) ||
      Object.keys(body).some(
        (key) =>
          !['revision', 'provider', 'action', 'id', 'label', 'key'].includes(
            key,
          ),
      ) ||
      (body.action !== 'add' && (typeof body.id !== 'string' || !body.id)) ||
      (['add', 'rename'].includes(body.action) &&
        (typeof body.label !== 'string' ||
          !body.label.trim() ||
          body.label.length > 80)) ||
      (body.action === 'add' &&
        (typeof body.key !== 'string' ||
          !body.key.trim() ||
          body.key.length > 8192)) ||
      (body.action !== 'add' && body.key !== undefined) ||
      (body.action === 'reuse' && body.provider !== 'gemini')
    )
      throw new BadRequestException(
        'Invalid API key action; reuse is available for Gemini only',
      );
    try {
      const reference = this.reference(uid);
      return await this.firebase.database().runTransaction(async (tx) => {
        const saved = (await tx.get(reference)).data() ?? {};
        if ((saved.revision ?? 0) !== body.revision)
          throw new ConflictException(
            'Cấu hình đã thay đổi. Tải lại trước khi lưu.',
          );
        const provider = body.provider,
          field = PROVIDER_KEYS[provider][0];
        let pool = this.pool(saved, provider);
        const keyHealth = structuredClone(saved.keyHealth ?? {});
        keyHealth[provider] ??= {};
        if (saved.health?.[provider])
          keyHealth[provider][saved.health[provider].fingerprint] =
            saved.health[provider];
        const secrets = { ...(saved.secrets ?? {}) },
          health = { ...(saved.health ?? {}) };
        const current = this.config.fingerprint(provider, this.values(saved));
        const item = pool.find((entry) => entry.id === body.id);
        if (body.action !== 'add' && !item)
          throw new BadRequestException('API key no longer exists');
        if (body.action === 'add') {
          if (pool.length >= 30)
            throw new BadRequestException('Maximum 30 saved keys per provider');
          const value = body.key!.trim(),
            fingerprint = this.config.fingerprint(provider, { [field]: value });
          if (pool.some((entry) => entry.fingerprint === fingerprint))
            throw new BadRequestException(
              'Key này đã có trong danh sách; hãy chọn lại key đã lưu.',
            );
          const added = {
            id: randomUUID(),
            label: body.label!.trim(),
            encrypted: this.encrypt(value),
            fingerprint,
          };
          pool.push(added);
          // Adding a backup does not change a configured active key.
          const activeValue =
            field in secrets
              ? this.decrypt(secrets[field])
              : process.env[field];
          if (!activeValue?.trim()) {
            secrets[field] = added.encrypted;
            delete health[provider];
          }
        } else if (body.action === 'rename') item!.label = body.label!.trim();
        else if (body.action === 'delete') {
          pool = pool.filter((entry) => entry.id !== body.id);
          delete keyHealth[provider][item!.fingerprint];
          if (item!.fingerprint === current) {
            secrets[field] = this.encrypt('');
            delete health[provider];
          }
        } else {
          secrets[field] = item!.encrypted;
          if (body.action === 'reuse')
            delete keyHealth[provider][item!.fingerprint];
          const status = keyHealth[provider][item!.fingerprint];
          if (status) health[provider] = status;
          else delete health[provider];
        }
        const next = {
          ...saved,
          secrets,
          health,
          keyHealth,
          keyPools: { ...saved.keyPools, [provider]: pool },
          revision: body.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        tx.set(reference, next);
        return this.response(next);
      });
    } catch (error) {
      this.storageError(error);
    }
  }
  private validate(settings: WorkspaceOptions) {
    const known = Object.keys(this.defaults());
    if (
      !settings ||
      typeof settings !== 'object' ||
      Array.isArray(settings) ||
      Object.keys(settings).some((key) => !known.includes(key))
    )
      throw new BadRequestException('Unknown workspace settings');
    if (
      typeof settings.slugSuffix !== 'string' ||
      !settings.slugSuffix.trim() ||
      settings.slugSuffix.length > 120 ||
      !['gemini', 'gpt'].includes(settings.textProvider) ||
      !['tavily', 'serper'].includes(settings.imageProvider) ||
      typeof settings.geminiModel !== 'string' ||
      !settings.geminiModel.trim() ||
      settings.geminiModel.length > 160 ||
      typeof settings.openaiModel !== 'string' ||
      settings.openaiModel.length > 160
    )
      throw new BadRequestException('Invalid workflow settings');
    if (!Array.isArray(settings.categories) || settings.categories.length > 100)
      throw new BadRequestException('Invalid category catalog');
    const ids = new Set<number>();
    for (const item of settings.categories) {
      if (
        !item ||
        !Number.isSafeInteger(item.id) ||
        item.id < 1 ||
        ids.has(item.id) ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        item.name.length > 100 ||
        Object.keys(item).some((key) => !['id', 'name'].includes(key))
      )
        throw new BadRequestException(
          'Categories require distinct positive IDs and names',
        );
      ids.add(item.id);
    }
  }
  async update(
    uid: string,
    body: {
      revision: number;
      settings?: Partial<WorkspaceOptions>;
      secrets?: Record<string, string | null>;
    },
  ) {
    if (
      !body ||
      Object.keys(body).some(
        (key) => !['revision', 'settings', 'secrets'].includes(key),
      ) ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      (!body.settings && !body.secrets)
    )
      throw new BadRequestException('Provide revision and settings or secrets');
    if (
      body.secrets &&
      (typeof body.secrets !== 'object' ||
        Array.isArray(body.secrets) ||
        Object.entries(body.secrets).some(
          ([key, value]) =>
            !SECRET_FIELDS.includes(key as (typeof SECRET_FIELDS)[number]) ||
            (value !== null &&
              (typeof value !== 'string' ||
                !value.trim() ||
                value.length > 8192)),
        ))
    )
      throw new BadRequestException('Invalid provider credential fields');
    try {
      const ref = this.reference(uid);
      return await this.firebase.database().runTransaction(async (tx) => {
        const saved = (await tx.get(ref)).data() ?? {};
        if ((saved.revision ?? 0) !== body.revision)
          throw new ConflictException(
            'Cấu hình đã thay đổi. Tải lại trước khi lưu.',
          );
        const settings = {
          ...this.options(saved),
          ...body.settings,
        };
        this.validate(settings);
        const secrets = { ...(saved.secrets ?? {}) },
          health = { ...(saved.health ?? {}) };
        const oldValues = this.values(saved),
          nextValues = { ...oldValues };
        for (const [name, value] of Object.entries(body.secrets ?? {})) {
          secrets[name] = this.encrypt(value?.trim() ?? '');
          nextValues[name] = value?.trim() ?? '';
        }
        for (const provider of Object.keys(PROVIDER_KEYS))
          if (
            this.config.fingerprint(provider, oldValues) !==
            this.config.fingerprint(provider, nextValues)
          )
            delete health[provider];
        const keyPools = { ...saved.keyPools },
          keyHealth = structuredClone(saved.keyHealth ?? {});
        for (const provider of KEY_POOL_PROVIDERS) {
          const field = PROVIDER_KEYS[provider][0];
          if (!body.secrets || !(field in body.secrets)) continue;
          const pool = this.pool(saved, provider);
          keyHealth[provider] ??= {};
          if (saved.health?.[provider])
            keyHealth[provider][saved.health[provider].fingerprint] =
              saved.health[provider];
          const value = nextValues[field];
          const fingerprint = this.config.fingerprint(provider, {
            [field]: value,
          });
          if (value && !pool.some((item) => item.fingerprint === fingerprint)) {
            if (pool.length >= 30)
              throw new BadRequestException(
                'Maximum 30 saved keys per provider',
              );
            pool.push({
              id: randomUUID(),
              label: 'Key mới',
              encrypted: secrets[field],
              fingerprint,
            });
          }
          keyPools[provider] = pool;
          if (value && keyHealth[provider][fingerprint])
            health[provider] = keyHealth[provider][fingerprint];
        }
        const next = {
          ...saved,
          settings,
          secrets,
          health,
          keyPools,
          keyHealth,
          revision: body.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        tx.set(ref, next);
        return this.response(next);
      });
    } catch (error) {
      this.storageError(error);
    }
  }
  async execute<T>(
    uid: string,
    work: (settings: WorkspaceOptions) => Promise<T>,
  ): Promise<T> {
    const saved = await this.read(uid),
      options = this.response(saved).settings;
    const values = {
      ...this.values(saved),
      GEMINI_MODEL: options.geminiModel,
      OPENAI_MODEL: options.openaiModel,
      CONTENT_HISTORY_SCOPE: uid,
    };
    return this.config.withValues(values, async () => {
      try {
        return await work(options);
      } finally {
        const observations = this.config.observations();
        if (Object.keys(observations).length) {
          try {
            const ref = this.reference(uid);
            await this.firebase.database().runTransaction(async (tx) => {
              const current = (await tx.get(ref)).data() ?? {},
                currentValues = this.values(current);
              const health = { ...(current.health ?? {}) };
              const keyHealth = structuredClone(current.keyHealth ?? {});
              for (const [provider, observation] of Object.entries(
                observations,
              )) {
                let effective = observation;
                const previous =
                  keyHealth[provider]?.[observation.fingerprint] ??
                  (current.health?.[provider]?.fingerprint ===
                  observation.fingerprint
                    ? current.health[provider]
                    : null);
                if (
                  ['tavily', 'serper'].includes(provider) &&
                  previous?.status === 'quota' &&
                  observation.status === 'ready'
                )
                  effective = previous;
                if (
                  KEY_POOL_PROVIDERS.includes(provider as KeyPoolProvider) &&
                  this.pool(current, provider as KeyPoolProvider).some(
                    (item) => item.fingerprint === observation.fingerprint,
                  )
                ) {
                  keyHealth[provider] ??= {};
                  keyHealth[provider][observation.fingerprint] = effective;
                }
                // A result for an old key must not turn a newly replaced key red.
                if (
                  this.config.fingerprint(provider, currentValues) ===
                  observation.fingerprint
                )
                  health[provider] = effective;
              }
              tx.set(ref, { ...current, health, keyHealth });
            });
          } catch {
            console.warn(
              'Could not persist provider health; workflow effects are retained',
            );
          }
        }
      }
    });
  }
  async library(uid: string) {
    try {
      const saved = (await this.reference(uid, 'library').get()).data();
      return {
        items: (saved?.items ?? []).map((item: LibraryItem) => ({
          ...item,
          note: item.note ?? '',
        })),
        revision: saved?.revision ?? 0,
      };
    } catch (error) {
      this.storageError(error);
    }
  }
  async saveLibrary(
    uid: string,
    body: { revision: number; items: LibraryItem[] },
  ) {
    if (
      !body ||
      Object.keys(body).some((key) => !['revision', 'items'].includes(key)) ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      !Array.isArray(body.items) ||
      body.items.length > 100 ||
      Buffer.byteLength(JSON.stringify(body.items)) > 750000
    )
      throw new BadRequestException(
        'Thư viện tối đa 100 mẫu và 750 KB; cung cấp revision hợp lệ',
      );
    const ids = new Set<string>();
    for (const item of body.items) {
      if (
        !item ||
        Object.keys(item).some(
          (key) => !['id', 'title', 'caption', 'content', 'note'].includes(key),
        ) ||
        typeof item.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
        ids.has(item.id) ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 180 ||
        typeof item.caption !== 'string' ||
        typeof item.content !== 'string' ||
        (item.note !== undefined &&
          (typeof item.note !== 'string' ||
            Buffer.byteLength(item.note) > 30000)) ||
        (!item.caption.trim() && !item.content.trim())
      )
        throw new BadRequestException(
          'Mẫu content cần tên, caption/nội dung và ID duy nhất',
        );
      ids.add(item.id);
    }
    try {
      const ref = this.reference(uid, 'library');
      return await this.firebase.database().runTransaction(async (tx) => {
        const current = (await tx.get(ref)).data() ?? {};
        if ((current.revision ?? 0) !== body.revision)
          throw new ConflictException(
            'Thư viện đã thay đổi. Tải lại trước khi lưu.',
          );
        const next = {
          items: body.items.map((item) => ({ ...item, note: item.note ?? '' })),
          revision: body.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        tx.set(ref, next);
        return next;
      });
    } catch (error) {
      this.storageError(error);
    }
  }
  private storageError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Không truy cập được cấu hình Firestore',
    );
  }
}
