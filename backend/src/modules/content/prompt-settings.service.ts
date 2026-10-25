import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service.js';
import { ContentConfigService } from './content-config.service.js';
import {
  PROMPT_STAGES,
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
    return this.config.defaults().pipelinePrompts;
  }

  private response(saved: any = {}) {
    const overrides = saved.prompts ?? {};
    validatePromptOverrides(overrides);
    return {
      prompts: { ...this.templates(), ...overrides },
      customizedStages: Object.keys(overrides),
      revision: saved.revision ?? 0,
      updatedAt: saved.updatedAt ?? null,
    };
  }

  async get(uid: string) {
    try {
      const snapshot = await this.reference(uid).get();
      return this.response(snapshot.data());
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
    const stages = body.stages ?? PROMPT_STAGES;
    if (
      !Array.isArray(stages) ||
      !stages.length ||
      stages.some((stage) => !PROMPT_STAGES.includes(stage))
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
          const prompts = update(saved.prompts ?? {});
          validatePromptOverrides(prompts);
          const next = {
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
