import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service.js';
import { ContentConfigService } from './content-config.service.js';
import { PROMPT_VERSION, RULE_IDS } from './prompt-composer.js';
import {
  ACTIVE_PROMPT_STAGES,
  validatePromptOverrides,
  type PromptOverrides,
  type PromptStage,
} from './prompt.types.js';

@Injectable()
export class PromptSettingsService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly config: ContentConfigService,
  ) {}

  private reference(uid: string) {
    return this.firebase
      .database()
      .collection('users')
      .doc(encodeURIComponent(uid))
      .collection('settings')
      .doc('prompts');
  }

  templates() {
    return { rewrite: this.config.defaults().prompt };
  }

  private response(saved: any = {}) {
    const overrides = Object.fromEntries(
      ACTIVE_PROMPT_STAGES.filter(
        (stage) => typeof saved.prompts?.[stage] === 'string',
      ).map((stage) => [stage, saved.prompts[stage]]),
    );
    validatePromptOverrides(overrides);
    return {
      prompts: { ...this.templates(), ...overrides },
      version: PROMPT_VERSION,
      currentVersion: PROMPT_VERSION,
      mode: 'n8n-rotation',
      policy:
        'Giữ nguyên prompt n8n. Lịch sử Firebase chỉ giúp tránh lặp cầu thủ trong caption của cùng nguồn và đội; không thêm bước phân tích hay xác minh nội dung. Chỉ nhận diện tên từ lineup/hồ sơ đã lưu. HLV không bị thay chỉ để tạo sự khác biệt.',
      ruleIds: RULE_IDS,
      needsSync: false,
      customizedStages: Object.keys(overrides),
      revision: saved.revision ?? 0,
      updatedAt: saved.updatedAt ?? null,
    };
  }

  async get(uid: string) {
    try {
      const snapshot = await this.reference(uid).get();
      const saved = snapshot.data();
      if (saved && saved.version !== PROMPT_VERSION)
        return this.synchronizeCanonical(uid, saved.revision ?? 0);
      return this.response(saved);
    } catch (error) {
      this.storageError(error);
    }
  }

  async synchronizeCanonical(uid: string, revision: number) {
    this.validateRevision(revision);
    try {
      const reference = this.reference(uid);
      return await this.firebase.database().runTransaction(async (tx) => {
        const saved = (await tx.get(reference)).data() ?? {};
        if (saved.version === PROMPT_VERSION) return this.response(saved);
        if ((saved.revision ?? 0) !== revision)
          throw new ConflictException(
            'Prompt changed; reload before synchronizing',
          );
        tx.set(
          reference
            .collection('versions')
            .doc(`before-${PROMPT_VERSION}-r${revision}`),
          saved,
        );
        const next = {
          prompts: {
            ...this.templates(),
            ...(saved.prompts?.rewrite
              ? { rewrite: saved.prompts.rewrite }
              : {}),
          },
          version: PROMPT_VERSION,
          revision: revision + 1,
          updatedAt: new Date().toISOString(),
        };
        tx.set(reference, next);
        return this.response(next);
      });
    } catch (error) {
      this.storageError(error);
    }
  }

  private validateRevision(revision: unknown) {
    if (!Number.isSafeInteger(revision) || (revision as number) < 0)
      throw new BadRequestException('revision must be a nonnegative integer');
  }

  async update(
    uid: string,
    body: { revision: number; prompts: PromptOverrides },
  ) {
    if (
      !body ||
      Object.keys(body).some((key) => !['revision', 'prompts'].includes(key)) ||
      !body.prompts ||
      !Object.keys(body.prompts).length
    ) {
      throw new BadRequestException(
        'Only revision and nonempty prompts may be updated',
      );
    }
    this.validateRevision(body.revision);
    validatePromptOverrides(body.prompts);
    if (
      Object.keys(body.prompts).some(
        (stage) => !(ACTIVE_PROMPT_STAGES as readonly string[]).includes(stage),
      )
    )
      throw new BadRequestException('Only rewrite is editable');
    return this.change(uid, body.revision, (saved) => ({
      ...saved,
      ...body.prompts,
    }));
  }

  async reset(uid: string, body: { revision: number; stages?: PromptStage[] }) {
    if (
      !body ||
      Object.keys(body).some((key) => !['revision', 'stages'].includes(key))
    )
      throw new BadRequestException('Only revision and stages are allowed');
    this.validateRevision(body.revision);
    const stages = body.stages ?? ACTIVE_PROMPT_STAGES;
    if (
      !Array.isArray(stages) ||
      !stages.length ||
      stages.some(
        (stage) => !(ACTIVE_PROMPT_STAGES as readonly string[]).includes(stage),
      )
    )
      throw new BadRequestException('Invalid prompt stages');
    return this.change(uid, body.revision, (saved) => {
      const next = { ...saved };
      for (const stage of stages) delete next[stage];
      return next;
    });
  }

  private async change(
    uid: string,
    revision: number,
    update: (saved: PromptOverrides) => PromptOverrides,
  ) {
    try {
      const reference = this.reference(uid);
      return await this.firebase
        .database()
        .runTransaction(async (transaction) => {
          const snapshot = await transaction.get(reference);
          const saved = snapshot.data() ?? {};
          if ((saved.revision ?? 0) !== revision)
            throw new ConflictException(
              'Prompt changed on another device; reload before saving',
            );
          const prompts = update(
            Object.fromEntries(
              ACTIVE_PROMPT_STAGES.filter(
                (stage) => typeof saved.prompts?.[stage] === 'string',
              ).map((stage) => [stage, saved.prompts[stage]]),
            ),
          );
          validatePromptOverrides(prompts);
          const next = {
            version: PROMPT_VERSION,
            prompts,
            revision: revision + 1,
            updatedAt: new Date().toISOString(),
          };
          transaction.set(reference, next);
          return this.response(next);
        });
    } catch (error) {
      this.storageError(error);
    }
  }

  private storageError(error: unknown): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ServiceUnavailableException
    )
      throw error;
    throw new ServiceUnavailableException(
      'Firestore prompt storage unavailable; check project, database and service-account permissions',
    );
  }
}
