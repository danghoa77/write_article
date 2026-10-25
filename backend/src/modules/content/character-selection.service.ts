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
import type {
  BatchContentBody,
  CharacterMapping,
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
};
export const STORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'characters'],
  properties: {
    summary: { type: 'string' },
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
  required: ['people'],
  properties: {
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

@Injectable()
export class CharacterSelectionService {
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
    validatePromptOverrides(body.prompts);
    if (
      body.concurrency !== undefined &&
      (!Number.isInteger(body.concurrency) ||
        body.concurrency < 1 ||
        body.concurrency > 4)
    ) {
      throw new BadRequestException(
        'concurrency must be an integer from 1 to 4',
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
      (body.prompts?.analysis ??
        this.config.defaults().pipelinePrompts.analysis) +
      '\nSOURCE JSON:\n' +
      JSON.stringify({ caption: body.caption, content: body.content });
    const text = await this.ai.text(prompt, body.textProvider, STORY_SCHEMA);
    let result: StoryAnalysis;
    try {
      result = JSON.parse(text);
    } catch {
      throw new UnprocessableEntityException('Invalid story analysis JSON');
    }
    if (
      !result ||
      typeof result.summary !== 'string' ||
      !Array.isArray(result.characters) ||
      result.characters.length > 30
    ) {
      throw new UnprocessableEntityException('Invalid story analysis shape');
    }
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
        !Array.isArray(person.requiredTraits) ||
        person.requiredTraits.some((trait) => typeof trait !== 'string') ||
        typeof person.evidence !== 'string' ||
        !normalize(person.evidence) ||
        !normalize(`${body.caption} ${body.content}`).includes(
          normalize(person.evidence),
        ) ||
        !normalize(`${body.caption} ${body.content}`).includes(
          normalize(person.name),
        )
      ) {
        throw new UnprocessableEntityException(
          'Analysis contains invalid or unsupported character evidence',
        );
      }
      // Never trust the model to introduce a name in an originally anonymous caption.
      person.inCaption = normalize(body.caption).includes(
        normalize(person.name),
      );
      ids.add(person.id);
    }
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
    }
    return [...pool.values()];
  }

  select(story: StoryAnalysis, team: ContentTeam): TeamPlan {
    const people = this.candidates(team);
    const real = story.characters.filter(
      (person) => person.identity === 'real',
    );
    const options = real.map((source) =>
      people
        .map((target, index) => ({ target, index }))
        .filter(
          ({ target }) =>
            target.role === source.role &&
            target.status ===
              (source.status === 'former' ? 'former' : 'active') &&
            (source.careerStage === 'any' ||
              target.careerStage === source.careerStage ||
              (source.careerStage === 'established' &&
                target.careerStage === 'veteran')) &&
            (source.importance === 'any' ||
              (source.role === 'coach' && source.status !== 'former') ||
              target.importance === source.importance) &&
            source.requiredTraits.every((trait) =>
              target.traits.some(
                (value) => normalize(value) === normalize(trait),
              ),
            ),
        )
        .map((candidate) => candidate.index),
    );
    // Bipartite matching prevents two original people becoming one target person.
    const assigned = new Map<number, number>();
    const visit = (source: number, seen: Set<number>): boolean => {
      for (const target of options[source]) {
        if (seen.has(target)) continue;
        seen.add(target);
        const previous = assigned.get(target);
        if (previous === undefined || visit(previous, seen)) {
          assigned.set(target, source);
          return true;
        }
      }
      return false;
    };
    const order = real
      .map((_, index) => index)
      .sort((a, b) => options[a].length - options[b].length);
    for (const index of order) {
      if (!visit(index, new Set())) {
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
      return profile
        ? { source, action: 'replace', targetName: profile.name, profile }
        : { source, action: 'preserve', targetName: source.name };
    });
    return { team, mappings };
  }

  async plan(body: BatchContentBody, allowPartial = false) {
    const analysis = await this.analyze(body);
    const plans: TeamPlan[] = [];
    const failures: { index: number; statusCode: number; error: unknown }[] =
      [];
    const planIndexes: number[] = [];
    for (const [index, team] of body.teams.entries()) {
      try {
        let plan: TeamPlan;
        try {
          plan = this.select(analysis, team);
        } catch (error) {
          if (
            !(error instanceof UnprocessableEntityException) ||
            (error.getResponse() as any)?.code !== 'CHARACTER_REVIEW_REQUIRED'
          )
            throw error;
          const enriched = await this.supplementKnowledge(body, analysis, team);
          plan = this.select(analysis, enriched);
        }
        plans.push(plan);
        planIndexes.push(index);
      } catch (error) {
        if (!allowPartial) throw error;
        failures.push({
          index,
          statusCode: error instanceof HttpException ? error.getStatus() : 502,
          error:
            error instanceof HttpException
              ? error.getResponse()
              : { message: 'Character planning failed' },
        });
      }
    }
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
  ): Promise<ContentTeam> {
    const inputPeople = this.candidates(team);
    const prompt =
      (body.prompts?.characterKnowledge ??
        this.config.defaults().pipelinePrompts.characterKnowledge) +
      '\nCONTEXT JSON:\n' +
      JSON.stringify({
        story,
        importedLineup: team,
        suppliedPeople: inputPeople,
      });
    const text = await this.ai.text(
      prompt,
      body.textProvider,
      KNOWLEDGE_SCHEMA,
    );
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new UnprocessableEntityException(
        'Invalid character knowledge JSON',
      );
    }
    if (!result || !Array.isArray(result.people) || result.people.length > 60) {
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
    const hasFormerRole = story.characters.some(
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
            existing.importance !== proposed.importance))
      ) {
        throw new UnprocessableEntityException(
          'Model knowledge conflicts with supplied personnel',
        );
      }
      const { confidence: _confidence, ...person } = proposed;
      enriched.set(key, {
        ...person,
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
    return enrichedTeam;
  }
}
