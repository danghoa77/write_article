import {
  BadRequestException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentAiService } from './content-ai.service.js';
import { ContentConfigService } from './content-config.service.js';
import { ContentService } from './content.service.js';
import { validatePromptOverrides } from './prompt.types.js';
import { composePrompt } from './prompt-composer.js';
import {
  completeScan,
  evidenceText,
  grounded,
  SCAN_SCHEMA,
} from './story-scan.js';
import type {
  BatchContentBody,
  CharacterMapping,
  CharacterRecommendation,
  ContentTeam,
  PersonProfile,
  SourceCharacter,
  StoryAnalysis,
  TeamPlan,
} from './content.model.js';

const fields = {
  id: { type: 'string' },
  name: { type: 'string' },
  identity: { type: 'string', enum: ['real', 'fictional', 'unspecified'] },
  inCaption: { type: 'boolean' },
  role: { type: 'string', enum: ['player', 'coach', 'staff', 'other'] },
  status: { type: 'string', enum: ['active', 'former', 'any'] },
  careerStage: {
    type: 'string',
    enum: ['rookie', 'established', 'veteran', 'any'],
  },
  importance: { type: 'string', enum: ['star', 'supporting', 'any'] },
  requiredTraits: { type: 'array', items: { type: 'string' } },
  evidence: { type: 'string' },
  narrativeRole: {
    type: 'string',
    enum: ['primary', 'supporting', 'reference'],
  },
  affiliation: { type: 'string', enum: ['source_team', 'external', 'unknown'] },
};
export const STORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'sourceTeam', 'scan', 'characters'],
  properties: {
    scan: SCAN_SCHEMA,
    summary: { type: 'string' },
    sourceTeam: {
      type: 'string',
      description:
        'Exact source team name copied from the caption/content; empty if unknown.',
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(fields),
        properties: fields,
      },
    },
  },
};
export const KNOWLEDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['people', 'recommendations'],
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceCharacterId',
          'targetName',
          'score',
          'reason',
          'confidence',
        ],
        properties: {
          sourceCharacterId: { type: 'string' },
          targetName: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          reason: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'uncertain'] },
        },
      },
    },
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'role',
          'status',
          'careerStage',
          'importance',
          'traits',
          'confidence',
          'knowledgeNote',
          'position',
        ],
        properties: {
          name: { type: 'string' },
          role: fields.role,
          status: { type: 'string', enum: ['active', 'former', 'unknown'] },
          careerStage: {
            type: 'string',
            enum: ['rookie', 'established', 'veteran', 'unknown'],
          },
          importance: {
            type: 'string',
            enum: ['star', 'supporting', 'unknown'],
          },
          position: {
            type: 'string',
            description:
              'Actual playing/staff position, empty if unknown. Never copy the source position.',
          },
          traits: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'uncertain'] },
          knowledgeNote: { type: 'string' },
        },
      },
    },
  },
};
const normalize = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const traitKey = (text: string) => {
  const value = normalize(text).replace(/[_-]+/g, ' ');
  return ['parent', 'father', 'mother', 'has children', 'has kids'].includes(
    value,
  )
    ? 'parent'
    : value;
};

@Injectable()
export class CharacterSelectionService {
  private readonly usage = new Map<string, Map<string, number>>();
  recordSelection(plan: TeamPlan) {
    const key = normalize(`${plan.team.sport}:${plan.team.team}`);
    const used = this.usage.get(key) ?? new Map<string, number>();
    for (const item of plan.mappings.filter(
      (item) => item.action === 'replace',
    )) {
      const name = normalize(item.targetName);
      used.set(name, (used.get(name) ?? 0) + 1);
    }
    this.usage.set(key, used);
  }
  constructor(
    private readonly config: ContentConfigService,
    private readonly ai: ContentAiService,
    private readonly content: ContentService,
  ) {}

  validate(body: BatchContentBody) {
    if (
      !body ||
      typeof body.caption !== 'string' ||
      typeof body.content !== 'string' ||
      (!body.caption.trim() && !body.content.trim()) ||
      !Array.isArray(body.teams) ||
      !body.teams.length
    ) {
      throw new BadRequestException(
        'Provide shared caption/content and nonempty teams',
      );
    }
    if (body.prompt !== undefined && typeof body.prompt !== 'string')
      throw new BadRequestException('prompt must be a string');
    if (
      body.characterMode !== undefined &&
      !['auto', 'preserve', 'manual'].includes(body.characterMode)
    )
      throw new BadRequestException(
        'characterMode must be auto, preserve or manual',
      );
    for (const [key, items] of Object.entries({
      characterSelections: body.characterSelections,
      teamFacts: body.teamFacts,
    })) {
      if (items === undefined) continue;
      if (
        !Array.isArray(items) ||
        Buffer.byteLength(JSON.stringify(items)) > 750000
      )
        throw new BadRequestException(`${key} must be an array within 750 KB`);
      const keys = new Set<string>();
      for (const raw of items) {
        const item = raw as Record<string, string>;
        const fields =
          key === 'teamFacts'
            ? ['sport', 'team', 'facts']
            : ['sport', 'team', 'sourceName', 'targetName'];
        if (
          !item ||
          fields.some(
            (field) =>
              typeof item[field] !== 'string' ||
              !item[field].trim() ||
              item[field].length > (field === 'facts' ? 20000 : 300),
          )
        )
          throw new BadRequestException(`Invalid ${key} entry`);
        const id = normalize(
          `${item.sport}:${item.team}:${item.sourceName ?? ''}`,
        );
        if (keys.has(id))
          throw new BadRequestException(`Duplicate ${key} entry`);
        keys.add(id);
        if (
          !body.teams.some(
            (team) =>
              normalize(team.team) === normalize(item.team) &&
              normalize(team.sport) === normalize(item.sport),
          )
        )
          throw new BadRequestException(`${key} references an unselected team`);
      }
    }
    validatePromptOverrides(body.prompts);
    if (
      body.concurrency !== undefined &&
      (!Number.isInteger(body.concurrency) || body.concurrency < 1)
    ) {
      throw new BadRequestException(
        'concurrency must be a positive integer when supplied by a legacy client',
      );
    }
    for (const team of body.teams) {
      this.content.validateTeam(team);
      if (
        (team.season !== undefined && typeof team.season !== 'string') ||
        (team.lineupAsOf !== undefined && typeof team.lineupAsOf !== 'string')
      ) {
        throw new BadRequestException('season and lineupAsOf must be strings');
      }
      this.candidates(team);
    }
    this.ai.preflight(body.textProvider);
  }

  async analyze(body: BatchContentBody): Promise<StoryAnalysis> {
    this.validate(body);
    const prompt =
      composePrompt('analysis', this.config.defaults(), body.prompts) +
      '\nSOURCE JSON:\n' +
      JSON.stringify({ caption: body.caption, content: body.content });
    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.ai.text(
        prompt + feedback,
        body.textProvider,
        STORY_SCHEMA,
      );
      try {
        return this.parseAnalysis(text, body);
      } catch (error) {
        if (attempt || !(error instanceof UnprocessableEntityException))
          throw error;
        feedback =
          '\nANALYSIS REPAIR: Your previous JSON failed source validation: ' +
          JSON.stringify(error.getResponse()) +
          '\nPrevious JSON:\n' +
          text +
          '\nReturn the complete corrected JSON. Copy only names and short contiguous evidence actually present in SOURCE JSON. Do not invent source facts, omit requirements to force a fit, or reclassify a real person as fictional. For an anonymous description, copy the exact source wording.\n';
      }
    }
    throw new UnprocessableEntityException('Could not analyze the source');
  }

  private parseAnalysis(text: string, body: BatchContentBody): StoryAnalysis {
    let result: StoryAnalysis;
    try {
      result = JSON.parse(text);
    } catch {
      throw new UnprocessableEntityException('Invalid story analysis JSON');
    }
    if (
      !result ||
      typeof result.summary !== 'string' ||
      (result.sourceTeam !== undefined &&
        (typeof result.sourceTeam !== 'string' ||
          (result.sourceTeam &&
            !grounded(
              `${body.caption} ${body.content}`,
              result.sourceTeam,
            )))) ||
      !Array.isArray(result.characters) ||
      result.characters.length > 30
    ) {
      throw new UnprocessableEntityException('Invalid story analysis shape');
    }
    if (
      result.scan &&
      (!['sad_news', 'lifestyle', 'match', 'recognition', 'other'].includes(
        result.scan.storyType,
      ) ||
        !['none', 'fictional', 'real', 'mixed', 'uncertain'].includes(
          result.scan.identityCase,
        ) ||
        !['none', 'personal', 'match'].includes(result.scan.eventSpecific) ||
        typeof result.scan.reason !== 'string' ||
        !result.scan.reason.trim())
    )
      throw new UnprocessableEntityException('Invalid story scan');
    const ids = new Set<string>();
    for (const person of result.characters) {
      if (
        !person ||
        typeof person.id !== 'string' ||
        !person.id ||
        ids.has(person.id) ||
        typeof person.name !== 'string' ||
        !person.name.trim() ||
        !['real', 'fictional', 'unspecified'].includes(person.identity) ||
        !['player', 'coach', 'staff', 'other'].includes(person.role) ||
        !['active', 'former', 'any'].includes(person.status) ||
        !['rookie', 'established', 'veteran', 'any'].includes(
          person.careerStage,
        ) ||
        !['star', 'supporting', 'any'].includes(person.importance) ||
        (person.narrativeRole !== undefined &&
          !['primary', 'supporting', 'reference'].includes(
            person.narrativeRole,
          )) ||
        (person.affiliation !== undefined &&
          !['source_team', 'external', 'unknown'].includes(
            person.affiliation,
          )) ||
        !Array.isArray(person.requiredTraits) ||
        person.requiredTraits.some((trait) => typeof trait !== 'string') ||
        typeof person.evidence !== 'string' ||
        !grounded(`${body.caption} ${body.content}`, person.evidence) ||
        !grounded(`${body.caption} ${body.content}`, person.name)
      ) {
        throw new UnprocessableEntityException({
          code: 'ANALYSIS_EVIDENCE_INVALID',
          character: person?.name ?? '',
          message:
            'Analysis contains invalid or unsupported character evidence',
          detail:
            'Tên hoặc trích dẫn phải có trong nguồn. Hệ thống đã thử phân tích lại; hãy kiểm tra nhân vật và nội dung đầu vào.',
        });
      }
      // Never trust the model to introduce a name in an originally anonymous caption.
      person.inCaption = grounded(body.caption, person.name);
      if (person.inCaption && person.narrativeRole !== 'reference') {
        if (
          /\b(?:fatherhood|motherhood|his children|her children|their children|being a parent|being a father|being a mother)\b/i.test(
            body.caption,
          )
        )
          person.requiredTraits = [
            ...new Set([...person.requiredTraits, 'parent']),
          ];
        if (/\b(?:wedding|marriage) anniversary\b/i.test(body.caption))
          person.requiredTraits = [
            ...new Set([...person.requiredTraits, 'married']),
          ];
      }
      if (person.inCaption) {
        const name = normalize(person.name).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        const caption = normalize(body.caption);
        if (
          new RegExp(`\\b(?:superstar|star|standout)\\s+${name}\\b`, 'i').test(
            caption,
          )
        ) {
          person.importance = 'star';
          person.narrativeRole = 'primary';
          person.affiliation = 'source_team';
        }
      }
      ids.add(person.id);
    }
    result.scan = completeScan(body.caption, result.characters, result.scan);
    return result;
  }

  private candidates(team: ContentTeam): PersonProfile[] {
    const pool = new Map<string, PersonProfile>();
    const add = (name: string, role: PersonProfile['role']) => {
      pool.set(normalize(name), {
        name,
        role,
        status: 'active',
        careerStage: 'unknown',
        importance: 'unknown',
        traits: [],
      });
    };
    team.players.forEach((name) => add(name, 'player'));
    if (team.headCoach) add(team.headCoach, 'coach');
    if (team.personnel !== undefined && !Array.isArray(team.personnel))
      throw new BadRequestException('personnel must be an array');
    for (const person of team.personnel ?? []) {
      if (
        !person ||
        typeof person.name !== 'string' ||
        !person.name.trim() ||
        !['player', 'coach', 'staff', 'other'].includes(person.role) ||
        !['active', 'former', 'unknown'].includes(person.status) ||
        !['rookie', 'established', 'veteran', 'unknown'].includes(
          person.careerStage,
        ) ||
        !['star', 'supporting', 'unknown'].includes(person.importance) ||
        !Array.isArray(person.traits) ||
        (person.position !== undefined &&
          (typeof person.position !== 'string' ||
            person.position.length > 150)) ||
        !person.traits.every((trait) => typeof trait === 'string')
      ) {
        throw new BadRequestException('Invalid personnel profile');
      }
      pool.set(normalize(person.name), {
        ...person,
        traits: [...person.traits],
      });
    }
    const currentPlayers = new Set(team.players.map(normalize));
    const currentCoach = team.headCoach ? normalize(team.headCoach) : null;
    for (const person of pool.values()) {
      const inLineup =
        currentPlayers.has(normalize(person.name)) ||
        normalize(person.name) === currentCoach;
      if (
        (inLineup && person.status === 'former') ||
        (person.role === 'player' &&
          person.status === 'active' &&
          !currentPlayers.has(normalize(person.name))) ||
        (person.role === 'coach' &&
          person.status === 'active' &&
          normalize(person.name) !== currentCoach) ||
        (currentPlayers.has(normalize(person.name)) &&
          person.role !== 'player') ||
        (normalize(person.name) === currentCoach && person.role !== 'coach')
      ) {
        throw new BadRequestException(
          'Personnel conflicts with imported current lineup/headCoach',
        );
      }
      if (inLineup) person.status = 'active';
      const captains = (team.captain ?? '').split(/[,;\n]/).map(normalize);
      if (
        currentPlayers.has(normalize(person.name)) &&
        captains.includes(normalize(person.name))
      ) {
        person.traits = [...new Set([...person.traits, 'captain', 'leader'])];
      }
    }
    return [...pool.values()];
  }

  select(
    story: StoryAnalysis,
    team: ContentTeam,
    recommendations: CharacterRecommendation[] = [],
    settings: Pick<
      BatchContentBody,
      'characterMode' | 'characterSelections'
    > & { allowGenericFallback?: boolean; allowRoleFallback?: boolean } = {},
  ): TeamPlan {
    const people = this.candidates(team);
    if (settings.characterMode === 'preserve')
      return {
        team,
        mappings: story.characters.map((source) => ({
          source,
          action: 'preserve',
          targetName: source.name,
          selectionReason:
            'Giữ nguyên nhân vật theo lựa chọn của bạn; chỉ điều chỉnh bối cảnh đội phù hợp.',
        })),
      };
    const importedCaptains = new Set(
      (team.captain ?? '').split(/[,;\n]/).map(normalize),
    );
    const real = story.characters.filter(
      (person) =>
        person.identity === 'real' &&
        person.narrativeRole !== 'reference' &&
        person.affiliation !== 'external',
    );
    const manual = settings.characterMode === 'manual';
    const selections = (settings.characterSelections ?? []).filter(
      (item) =>
        normalize(item.team) === normalize(team.team) &&
        normalize(item.sport) === normalize(team.sport),
    );
    if (
      manual &&
      (selections.some(
        (item) =>
          !real.some(
            (person) =>
              evidenceText(person.name) === evidenceText(item.sourceName),
          ),
      ) ||
        real.some(
          (person) =>
            !selections.some(
              (item) =>
                evidenceText(item.sourceName) === evidenceText(person.name),
            ),
        ))
    ) {
      throw new BadRequestException({
        code: 'MANUAL_CHARACTER_REQUIRED',
        team: team.team,
        message:
          'Quét nội dung rồi chọn người thay thế cho từng nhân vật và đội.',
      });
    }
    if (
      manual &&
      selections.some(
        (item) =>
          !people.some(
            (person) => normalize(person.name) === normalize(item.targetName),
          ),
      )
    )
      throw new BadRequestException(
        'Nhân vật chọn tay phải có trong lineup hoặc hồ sơ đã setup của đội.',
      );
    const usage = this.usage.get(normalize(`${team.sport}:${team.team}`));
    const compatible = (
      source: SourceCharacter,
      target: PersonProfile,
      roleException = false,
    ) =>
      (roleException ||
        target.role === source.role ||
        (['coach', 'staff'].includes(source.role) &&
          ['coach', 'staff'].includes(target.role))) &&
      target.status === (source.status === 'former' ? 'former' : 'active') &&
      (source.careerStage === 'any' ||
        target.careerStage === source.careerStage ||
        (source.careerStage === 'established' &&
          target.careerStage === 'veteran')) &&
      (roleException ||
        source.importance === 'any' ||
        (source.role === 'coach' && source.status !== 'former') ||
        target.importance === source.importance ||
        (source.importance === 'star' &&
          importedCaptains.has(normalize(target.name)))) &&
      source.requiredTraits.every((trait) =>
        target.traits.some((value) => traitKey(value) === traitKey(trait)),
      );
    const options = real.map((source) => {
      const sameCategory = people.some((target) => compatible(source, target));
      const lifeException =
        settings.allowRoleFallback &&
        !manual &&
        !sameCategory &&
        source.role === 'player' &&
        source.status !== 'former' &&
        ['lifestyle', 'sad_news'].includes(story.scan?.storyType ?? '') &&
        source.requiredTraits.some((trait) =>
          /parent|marri|partner|family|child|engag/i.test(trait),
        );
      return people
        .map((target, index) => ({ target, index }))
        .filter(
          ({ target }) =>
            (!manual ||
              selections.some(
                (item) =>
                  evidenceText(item.sourceName) === evidenceText(source.name) &&
                  normalize(item.targetName) === normalize(target.name),
              )) &&
            (compatible(source, target) ||
              (lifeException &&
                ['coach', 'staff'].includes(target.role) &&
                compatible(source, target, true))),
        )
        .sort((a, b) => {
          const rank = (name: string) =>
            recommendations.find(
              (item) =>
                item.sourceCharacterId === source.id &&
                normalize(item.targetName) === normalize(name) &&
                item.confidence === 'high',
            )?.score ?? -1;
          return (
            Number(normalize(b.target.name) === normalize(source.name)) -
              Number(normalize(a.target.name) === normalize(source.name)) ||
            rank(b.target.name) - rank(a.target.name) ||
            (usage?.get(normalize(a.target.name)) ?? 0) -
              (usage?.get(normalize(b.target.name)) ?? 0)
          );
        })
        .map((candidate) => candidate.index);
    });
    for (const [index, source] of real.entries()) {
      if (
        (source.narrativeRole === 'primary' || source.importance === 'star') &&
        options[index].length > 1 &&
        !options[index].some(
          (target) => normalize(people[target].name) === normalize(source.name),
        ) &&
        !recommendations.some(
          (item) =>
            item.sourceCharacterId === source.id &&
            item.confidence === 'high' &&
            options[index].some(
              (target) =>
                normalize(people[target].name) === normalize(item.targetName),
            ),
        )
      ) {
        if (settings.allowGenericFallback) {
          options[index] = [];
          continue;
        }
        throw new UnprocessableEntityException({
          code: 'CHARACTER_REVIEW_REQUIRED',
          team: team.team,
          character: source.name,
          sourceCharacterId: source.id,
          message:
            'Cần đánh giá độ phù hợp với nhân vật chính trước khi chọn giữa nhiều ứng viên.',
        });
      }
    }
    // Bipartite matching prevents two original people becoming one target person.
    const assigned = new Map<number, number>();
    const visit = (source: number, seen: Set<number>): boolean => {
      for (const target of options[source]) {
        if (seen.has(target)) continue;
        seen.add(target);
        const previous = assigned.get(target);
        if (
          previous === undefined ||
          (!(real[previous].narrativeRole === 'primary') &&
            visit(previous, seen))
        ) {
          assigned.set(target, source);
          return true;
        }
      }
      return false;
    };
    const order = real
      .map((_, index) => index)
      .sort(
        (a, b) =>
          Number(real[b].narrativeRole === 'primary') -
            Number(real[a].narrativeRole === 'primary') ||
          options[a].length - options[b].length,
      );
    for (const index of order) {
      if (!visit(index, new Set())) {
        if (settings.allowGenericFallback) continue;
        throw new UnprocessableEntityException({
          code: 'CHARACTER_REVIEW_REQUIRED',
          team: team.team,
          character: real[index].name,
          sourceCharacterId: real[index].id,
          message:
            'Không chọn được nhân vật tương thích với dữ kiện hiện có; cần bổ sung hoặc kiểm tra thông tin nhân vật.',
        });
      }
    }
    const replacements = new Map<string, PersonProfile>();
    for (const [target, source] of assigned)
      replacements.set(real[source].id, people[target]);
    const mappings: CharacterMapping[] = story.characters.map((source) => {
      const profile = replacements.get(source.id);
      const recommendation =
        profile &&
        recommendations.find(
          (item) =>
            item.sourceCharacterId === source.id &&
            normalize(item.targetName) === normalize(profile.name) &&
            item.confidence === 'high',
        );
      return profile
        ? {
            source,
            action: 'replace',
            targetName: profile.name,
            profile,
            ...(profile.role !== source.role && source.role === 'player'
              ? { roleException: 'life_event' as const }
              : {}),
            selectionReason: manual
              ? 'Bạn chọn nhân vật này; đã kiểm tra vai trò và các yêu cầu của câu chuyện.'
              : (recommendation?.reason ??
                (normalize(source.name) === normalize(profile.name)
                  ? 'Nhân vật gốc có trong lineup đội đích và phù hợp vai trò.'
                  : importedCaptains.has(normalize(profile.name)) &&
                      source.importance === 'star'
                    ? 'Đội trưởng trong lineup, phù hợp vai trò cầu thủ nổi bật và lãnh đạo.'
                    : 'Phù hợp vai trò và các yêu cầu từ nội dung trong thông tin đội.')),
            ...(recommendation
              ? { suitabilityScore: recommendation.score }
              : {}),
          }
        : {
            source,
            action:
              source.identity === 'real' &&
              (source.narrativeRole === 'reference' ||
                source.affiliation === 'external')
                ? 'context'
                : source.identity === 'real'
                  ? 'generalize'
                  : 'preserve',
            targetName:
              source.identity === 'real' &&
              source.narrativeRole !== 'reference' &&
              source.affiliation !== 'external'
                ? `${source.status === 'former' ? 'a former' : 'a'} ${source.role === 'coach' ? 'head coach' : source.role === 'staff' ? 'staff member' : source.role === 'player' ? 'player' : 'member'} of ${team.team}`
                : source.name,
            ...(source.identity === 'real' &&
            source.narrativeRole !== 'reference' &&
            source.affiliation !== 'external'
              ? {
                  selectionReason:
                    'Không đủ dữ kiện chọn tên thật; dùng mô tả chung theo rule 1C/7C/20, giữ diễn biến câu chuyện.',
                }
              : {}),
          };
    });
    return { team, mappings };
  }

  async plan(body: BatchContentBody, allowPartial = false) {
    const analysis = await this.analyze(body);
    const plans: TeamPlan[] = [];
    const failures: { index: number; statusCode: number; error: unknown }[] =
      [];
    const planIndexes: number[] = [];
    const planned: (TeamPlan | undefined)[] = new Array(body.teams.length);
    await Promise.all(
      body.teams.map(async (team, index) => {
        try {
          let plan: TeamPlan;
          try {
            plan = this.select(analysis, team, [], body);
          } catch (error) {
            if (
              !(error instanceof UnprocessableEntityException) ||
              (error.getResponse() as any)?.code !== 'CHARACTER_REVIEW_REQUIRED'
            )
              throw error;
            const enriched = await this.supplementKnowledge(
              body,
              analysis,
              team,
            );
            try {
              plan = this.select(
                analysis,
                enriched.team,
                enriched.recommendations,
                { ...body, allowRoleFallback: true },
              );
            } catch (selectionError) {
              if (
                !(selectionError instanceof UnprocessableEntityException) ||
                (selectionError.getResponse() as any)?.code !==
                  'CHARACTER_REVIEW_REQUIRED'
              )
                throw selectionError;
              // A single constrained repair must still pass the same eligibility checks.
              const repaired = await this.supplementKnowledge(
                body,
                analysis,
                team,
                {
                  failure: selectionError.getResponse(),
                  previousRecommendations: enriched.recommendations,
                },
              );
              plan = this.select(
                analysis,
                repaired.team,
                repaired.recommendations,
                {
                  ...body,
                  allowRoleFallback: true,
                  allowGenericFallback: body.characterMode !== 'manual',
                },
              );
            }
          }
          const changedRealPerson = plan.mappings.some(
            (item) =>
              item.action === 'replace' &&
              evidenceText(item.source.name) !== evidenceText(item.targetName),
          );
          if (
            changedRealPerson &&
            analysis.scan?.eventSpecific !== 'none' &&
            analysis.scan?.eventSpecific &&
            !body.teamFacts?.some(
              (item) =>
                normalize(item.team) === normalize(team.team) &&
                normalize(item.sport) === normalize(team.sport) &&
                item.facts.trim(),
            )
          ) {
            throw new UnprocessableEntityException({
              code: 'STORY_FACTS_REQUIRED',
              team: team.team,
              message:
                analysis.scan.eventSpecific === 'personal'
                  ? 'Câu chuyện gắn với biến cố cá nhân. Bổ sung dữ kiện sự kiện cho đội này trước khi chuyển sang người thật khác.'
                  : 'Bổ sung dữ kiện trận đấu của đội đích; lineup không xác nhận kết quả hay thành tích trong trận.',
            });
          }
          planned[index] = plan;
        } catch (error) {
          if (!allowPartial) throw error;
          failures.push({
            index,
            statusCode:
              error instanceof HttpException ? error.getStatus() : 502,
            error:
              error instanceof HttpException
                ? error.getResponse()
                : { message: 'Character planning failed' },
          });
        }
      }),
    );
    planned.forEach((plan, index) => {
      if (plan) {
        plans.push(plan);
        planIndexes.push(index);
      }
    });
    failures.sort((a, b) => a.index - b.index);
    return {
      analysis,
      plans,
      planIndexes,
      failures,
    };
  }

  private async supplementKnowledge(
    body: BatchContentBody,
    story: StoryAnalysis,
    team: ContentTeam,
    feedback?: {
      failure: unknown;
      previousRecommendations: CharacterRecommendation[];
      previousResponse?: string;
    },
    repairing = false,
  ): Promise<{
    team: ContentTeam;
    recommendations: CharacterRecommendation[];
  }> {
    const inputPeople = this.candidates(team);
    const relevantStory = {
      ...story,
      characters: story.characters.filter(
        (person) =>
          person.identity === 'real' &&
          person.narrativeRole !== 'reference' &&
          person.affiliation !== 'external',
      ),
    };
    const prompt =
      composePrompt(
        'characterKnowledge',
        this.config.defaults(),
        body.prompts,
      ) +
      '\nCONTEXT JSON:\n' +
      JSON.stringify({
        story: relevantStory,
        importedLineup: team,
        suppliedPeople: inputPeople,
        previousUsage: Object.fromEntries(
          this.usage.get(normalize(`${team.sport}:${team.team}`)) ?? [],
        ),
        requestedSelections:
          body.characterMode === 'manual'
            ? body.characterSelections?.filter(
                (item) =>
                  normalize(item.team) === normalize(team.team) &&
                  normalize(item.sport) === normalize(team.sport),
              )
            : undefined,
        ...(feedback ? { selectionFeedback: feedback } : {}),
      });
    const text = await this.ai.text(
      prompt,
      body.textProvider,
      KNOWLEDGE_SCHEMA,
    );
    try {
      let result: any;
      try {
        result = JSON.parse(text);
      } catch {
        throw new UnprocessableEntityException(
          'Invalid character knowledge JSON',
        );
      }
      if (
        !result ||
        !Array.isArray(result.people) ||
        result.people.length > 60
      ) {
        throw new UnprocessableEntityException(
          'Invalid character knowledge response',
        );
      }
      const enriched = new Map(
        inputPeople.map((person) => [
          normalize(person.name),
          { ...person, traits: [...person.traits] },
        ]),
      );
      const seen = new Set<string>();
      const hasFormerRole = relevantStory.characters.some(
        (person) => person.identity === 'real' && person.status === 'former',
      );
      for (const proposed of result.people) {
        if (
          !proposed ||
          typeof proposed.name !== 'string' ||
          !proposed.name.trim() ||
          !['high', 'uncertain'].includes(proposed.confidence) ||
          typeof proposed.knowledgeNote !== 'string' ||
          !['player', 'coach', 'staff', 'other'].includes(proposed.role) ||
          !['active', 'former', 'unknown'].includes(proposed.status) ||
          !['rookie', 'established', 'veteran', 'unknown'].includes(
            proposed.careerStage,
          ) ||
          !['star', 'supporting', 'unknown'].includes(proposed.importance) ||
          !Array.isArray(proposed.traits) ||
          (proposed.position !== undefined &&
            typeof proposed.position !== 'string') ||
          !proposed.traits.every((trait: unknown) => typeof trait === 'string')
        ) {
          throw new UnprocessableEntityException(
            'Invalid model-knowledge person',
          );
        }
        if (proposed.confidence !== 'high' || !proposed.knowledgeNote.trim())
          continue;
        const key = normalize(proposed.name);
        if (seen.has(key))
          throw new UnprocessableEntityException(
            'Duplicate model-knowledge person',
          );
        seen.add(key);
        const existing = enriched.get(key);
        if (!existing && (proposed.status !== 'former' || !hasFormerRole)) {
          throw new UnprocessableEntityException(
            'Model cannot add current personnel outside imported lineup',
          );
        }
        if (
          existing &&
          (existing.role !== proposed.role ||
            existing.status !== proposed.status ||
            (existing.careerStage !== 'unknown' &&
              existing.careerStage !== proposed.careerStage) ||
            (existing.importance !== 'unknown' &&
              existing.importance !== proposed.importance) ||
            (!!existing.position &&
              !!proposed.position &&
              normalize(existing.position) !== normalize(proposed.position)))
        ) {
          throw new UnprocessableEntityException({
            code: 'CHARACTER_KNOWLEDGE_CONFLICT',
            character: proposed.name,
            message: 'Model knowledge conflicts with supplied personnel',
            expected: existing,
            received: {
              role: proposed.role,
              status: proposed.status,
              careerStage: proposed.careerStage,
              importance: proposed.importance,
              position: proposed.position ?? '',
            },
          });
        }
        const { confidence: _confidence, ...person } = proposed;
        enriched.set(key, {
          ...person,
          position: existing?.position || person.position || '',
          traits: [
            ...new Set([
              ...(existing?.traits ?? []),
              ...(Array.isArray(person.traits) ? person.traits : []),
            ]),
          ],
          knowledgeSource: 'model_knowledge',
        });
      }
      const enrichedTeam = { ...team, personnel: [...enriched.values()] };
      this.candidates(enrichedTeam);
      const recommendations: CharacterRecommendation[] =
        result.recommendations ?? [];
      if (
        !Array.isArray(recommendations) ||
        recommendations.some(
          (item) =>
            !item ||
            !story.characters.some(
              (source) => source.id === item.sourceCharacterId,
            ) ||
            !enriched.has(normalize(item.targetName ?? '')) ||
            !Number.isInteger(item.score) ||
            item.score < 0 ||
            item.score > 100 ||
            typeof item.reason !== 'string' ||
            !item.reason.trim() ||
            !['high', 'uncertain'].includes(item.confidence),
        )
      ) {
        throw new UnprocessableEntityException(
          'Invalid character suitability recommendations',
        );
      }
      return { team: enrichedTeam, recommendations };
    } catch (error) {
      if (repairing || !(error instanceof UnprocessableEntityException))
        throw error;
      return this.supplementKnowledge(
        body,
        story,
        team,
        {
          failure: error.getResponse(),
          previousRecommendations: [],
          previousResponse: text,
        },
        true,
      );
    }
  }
}
