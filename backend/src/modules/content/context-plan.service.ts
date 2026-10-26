import { Injectable } from '@nestjs/common';
import { ContentAiService } from './content-ai.service.js';
import { ContentConfigService } from './content-config.service.js';
import type {
  BatchContentBody,
  ContentTeam,
  PersonProfile,
  PreparedContent,
} from './content.model.js';
import {
  STORY_TYPES,
  normalizeIdentity as norm,
  contextTeamKey,
  type ContextAnalysis,
  type ContextBatchPlan,
  type ContextCandidate,
  type ContextCharacter,
  type ContextMapping,
  type ContextResponse,
  type ContextTeamPlan,
} from './context-plan.model.js';

const string = { type: 'string' };
// This deployed Gemini model accepts simple string schemas; normalize empty values to null below.
const nullable = {
  type: 'string',
  description: 'Empty string when unavailable.',
};
const array = (items: object, maxItems?: number) => ({
  type: 'array',
  items,
  ...(maxItems === undefined
    ? {}
    : {
        description: `At most ${maxItems} items; validated by the application.`,
      }),
});
const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
const object = (properties: Record<string, object>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
export const CONTEXT_SCHEMA = object({
  storyType: enumeration(...STORY_TYPES),
  hasIndividualFocus: { type: 'boolean' },
  sourceTeam: nullable,
  lifeEvent: enumeration(
    'none',
    'new_baby',
    'marriage',
    'anniversary',
    'family_milestone',
    'other',
  ),
  narrativeAction: string,
  keyBeats: array(string, 6),
  hasDirectQuotes: { type: 'boolean' },
  characters: array(
    object({
      id: string,
      name: nullable,
      description: string,
      identity: enumeration('real', 'anonymous', 'fictional', 'unknown'),
      inCaption: { type: 'boolean' },
      role: enumeration(
        'player',
        'head_coach',
        'coach_staff',
        'other',
        'unknown',
      ),
      positionOrFunction: nullable,
      temporalStatus: enumeration('active', 'former', 'unknown'),
      narrativeRole: enumeration('primary', 'supporting', 'reference'),
      narrativeWeight: enumeration('star', 'veteran', 'emerging', 'any'),
      requiredTraits: array(string, 8),
    }),
    12,
  ),
  recommendations: array(
    object({
      teamIndex: { type: 'integer', minimum: 0 },
      characterId: string,
      candidates: array(
        object({
          candidateId: string,
          historicalName: nullable,
          score: { type: 'number', minimum: 0, maximum: 100 },
          confidence: enumeration('high', 'uncertain'),
          reason: string,
          knownTraits: array(string, 8),
          position: nullable,
        }),
        3,
      ),
    }),
  ),
  warnings: array(string, 12),
});

const strings = (value: unknown, max = 12): value is string[] =>
  Array.isArray(value) &&
  value.length <= max &&
  value.every((v) => typeof v === 'string' && v.length <= 2000);
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 4000;
const oneOf = (value: unknown, values: readonly string[]) =>
  typeof value === 'string' && values.includes(value);
const trait = (value: string) =>
  ({
    father: 'parent',
    mother: 'parent',
    has_children: 'parent',
    children: 'parent',
    marriage: 'married',
  })[value.toLowerCase()] ?? value.toLowerCase();

@Injectable()
export class ContextPlanService {
  private readonly history = new Map<string, string[]>();
  constructor(
    private readonly ai: ContentAiService,
    private readonly config: ContentConfigService,
  ) {}

  candidates(team: ContentTeam, index: number): ContextCandidate[] {
    const profiles = new Map(
      (team.personnel ?? []).map((p) => [norm(p.name), p]),
    );
    const result: ContextCandidate[] = [];
    const captains = new Set((team.captain ?? '').split(',').map(norm));
    const add = (
      name: string,
      role: PersonProfile['role'],
      headCoach = false,
    ) => {
      if (!name.trim() || result.some((p) => norm(p.name) === norm(name)))
        return;
      const saved = profiles.get(norm(name));
      result.push({
        name,
        role,
        status: 'active',
        careerStage: 'unknown',
        importance: 'unknown',
        traits: [],
        ...saved,
        // Current membership/function comes from the imported roster, not model memory.
        ...(headCoach
          ? { role: 'coach' as const, status: 'active' as const }
          : role === 'player'
            ? { role: 'player' as const, status: 'active' as const }
            : {}),
        id: `t${index}p${result.length}`,
        headCoach,
        captain: captains.has(norm(name)),
      });
    };
    team.players.forEach((name) => add(name, 'player'));
    if (team.headCoach) add(team.headCoach, 'coach', true);
    for (const p of team.personnel ?? [])
      if (
        p.status === 'former' ||
        p.role === 'staff' ||
        p.role === 'other' ||
        p.role === 'coach'
      ) {
        if (!result.some((x) => norm(x.name) === norm(p.name)))
          result.push({
            ...p,
            id: `t${index}p${result.length}`,
            headCoach: false,
          });
      }
    return result;
  }

  async prepare(body: BatchContentBody): Promise<ContextBatchPlan> {
    this.ai.preflight('gemini');
    const pools = body.teams.map((team, i) => this.candidates(team, i));
    const prompt =
      (body.prompts?.contextAnalysis ??
        this.config.defaults().pipelinePrompts.contextAnalysis) +
      '\nCONTEXT INPUT JSON:\n' +
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        source: { caption: body.caption, content: body.content },
        sourceNote: body.prompt ?? '',
        teams: body.teams.map((t, index) => ({
          index,
          team: t.team,
          sport: t.sport,
          season: t.season,
          lineupAsOf: t.lineupAsOf,
          captain: t.captain,
          candidates: pools[index],
        })),
      });
    // Transport/quota errors propagate. Malformed JSON is a distinct, visible generic fallback.
    const text = await this.ai.text(prompt, 'gemini', CONTEXT_SCHEMA);
    let response: ContextResponse;
    try {
      response = this.parse(text, body.teams.length);
    } catch {
      return {
        status: 'fallback',
        analysis: null,
        warnings: [
          'ANALYZER_INVALID_RESPONSE: Không đọc được JSON ngữ cảnh hợp lệ. Dùng cách gọi chung; không chọn tên thay thế.',
        ],
        teams: body.teams.map((t) => ({
          team: t.team,
          sport: t.sport,
          mappings: [],
          warnings: [
            'Analyzer lỗi định dạng; không đồng nghĩa bài không có nhân vật.',
          ],
        })),
      };
    }
    const warnings: string[] = [];
    const source = norm(
      body.caption + ' ' + body.content.replace(/<[^>]*>/g, ' '),
    );
    for (const person of response.characters) {
      const personalTraits = person.requiredTraits
        .map(trait)
        .filter((t) =>
          ['parent', 'married', 'partnered', 'widowed', 'grandparent'].includes(
            t,
          ),
        );
      if (personalTraits.length !== person.requiredTraits.length)
        warnings.push(
          `TRAIT_NORMALIZED: ${person.id}; vị trí và tầm ảnh hưởng không phải điều kiện đời tư.`,
        );
      person.requiredTraits = personalTraits;
      if (
        person.name &&
        !(' ' + source + ' ').includes(' ' + norm(person.name) + ' ')
      ) {
        warnings.push(`SOURCE_NAME_UNGROUNDED: ${person.id}; giữ mô tả chung.`);
        person.name = null;
        person.identity = 'unknown';
      }
      person.inCaption =
        !!person.name &&
        (' ' + norm(body.caption) + ' ').includes(
          ' ' + norm(person.name) + ' ',
        );
      if (!person.name && person.identity === 'real')
        person.identity = 'anonymous';
    }
    const { recommendations: _, warnings: __, ...analysis } = response;
    return {
      status: 'ready',
      recommendations: response.recommendations,
      modelWarnings: response.warnings,
      analysis,
      warnings,
      teams: body.teams.map((team, index) =>
        this.choose(
          analysis,
          team,
          index,
          pools[index],
          response.recommendations,
        ),
      ),
    };
  }

  parse(text: string, teamCount: number): ContextResponse {
    if (text.length > 180000) throw Error('Context response too large');
    const r = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    ) as ContextResponse;
    if (r && typeof r === 'object') {
      if (r.sourceTeam === '') r.sourceTeam = null;
      for (const p of Array.isArray(r.characters) ? r.characters : []) {
        if (p?.name === '') p.name = null;
        if (p?.positionOrFunction === '') p.positionOrFunction = null;
      }
      for (const row of Array.isArray(r.recommendations)
        ? r.recommendations
        : []) {
        for (const c of Array.isArray(row?.candidates) ? row.candidates : []) {
          if (c?.historicalName === '') c.historicalName = null;
          if (c?.position === '') c.position = null;
        }
      }
    }
    if (
      !r ||
      !oneOf(r.storyType, STORY_TYPES) ||
      typeof r.hasIndividualFocus !== 'boolean' ||
      !(r.sourceTeam === null || isText(r.sourceTeam)) ||
      !oneOf(r.lifeEvent, [
        'none',
        'new_baby',
        'marriage',
        'anniversary',
        'family_milestone',
        'other',
      ]) ||
      !isText(r.narrativeAction) ||
      !strings(r.keyBeats, 6) ||
      typeof r.hasDirectQuotes !== 'boolean' ||
      !strings(r.warnings) ||
      !Array.isArray(r.characters) ||
      r.characters.length > 12 ||
      !Array.isArray(r.recommendations)
    )
      throw Error('Invalid context');
    const ids = new Set<string>();
    for (const p of r.characters) {
      if (
        !p ||
        !isText(p.id) ||
        !p.id.trim() ||
        ids.has(p.id) ||
        !(p.name === null || isText(p.name)) ||
        !isText(p.description) ||
        !p.description.trim() ||
        !oneOf(p.identity, ['real', 'anonymous', 'fictional', 'unknown']) ||
        typeof p.inCaption !== 'boolean' ||
        !oneOf(p.role, [
          'player',
          'head_coach',
          'coach_staff',
          'other',
          'unknown',
        ]) ||
        !(p.positionOrFunction === null || isText(p.positionOrFunction)) ||
        !oneOf(p.temporalStatus, ['active', 'former', 'unknown']) ||
        !oneOf(p.narrativeRole, ['primary', 'supporting', 'reference']) ||
        !oneOf(p.narrativeWeight, ['star', 'veteran', 'emerging', 'any']) ||
        !strings(p.requiredTraits, 8)
      )
        throw Error('Invalid character');
      ids.add(p.id);
    }
    const rows = new Set<string>();
    for (const row of r.recommendations) {
      if (
        !row ||
        !Number.isInteger(row.teamIndex) ||
        row.teamIndex < 0 ||
        row.teamIndex >= teamCount ||
        !ids.has(row.characterId) ||
        !Array.isArray(row.candidates) ||
        row.candidates.length > 3 ||
        rows.has(row.teamIndex + ':' + row.characterId)
      )
        throw Error('Invalid recommendation');
      rows.add(row.teamIndex + ':' + row.characterId);
      for (const c of row.candidates)
        if (
          !c ||
          !isText(c.candidateId) ||
          !(c.historicalName === null || isText(c.historicalName)) ||
          !Number.isFinite(c.score) ||
          c.score < 0 ||
          c.score > 100 ||
          !oneOf(c.confidence, ['high', 'uncertain']) ||
          !isText(c.reason) ||
          !c.reason.trim() ||
          !strings(c.knownTraits, 8) ||
          !(c.position === null || isText(c.position))
        )
          throw Error('Invalid candidate');
    }
    return r;
  }

  private generic(p: ContextCharacter, team: ContentTeam) {
    if (p.role === 'other' || p.role === 'unknown') {
      const group = p.description
        .match(/\b(teammates|supporters|fans|volunteers|community)\b/i)?.[1]
        ?.toLowerCase();
      if (group) return `the ${team.team} ${group}`;
      const relation = p.description
        .match(
          /\b(wife|husband|partner|mother|father|son|daughter|children|family|brother|sister)\b/i,
        )?.[1]
        ?.toLowerCase();
      if (relation)
        return `the ${/coach/i.test(p.description) ? 'coach' : 'player'}'s ${relation}`;
    }
    const role =
      p.role === 'head_coach'
        ? 'head coach'
        : p.role === 'coach_staff'
          ? 'staff member'
          : p.role === 'player'
            ? 'player'
            : 'team figure';
    return `${p.temporalStatus === 'former' ? 'a former' : 'an unnamed'} ${team.team} ${role}`;
  }

  choose(
    analysis: ContextAnalysis,
    team: ContentTeam,
    index: number,
    pool: ContextCandidate[],
    rows: ContextResponse['recommendations'],
  ): ContextTeamPlan {
    const used = new Set<string>();
    const warnings: string[] = [];
    const historyKey = this.historyKey(team),
      history = this.history.get(historyKey) ?? [];
    const mappings: ContextMapping[] = analysis.characters.map((p) => {
      const base = {
        sourceId: p.id,
        sourceName: p.name,
        inCaption: p.inCaption,
        role: p.role,
        status: p.temporalStatus,
      };
      if (p.identity === 'anonymous' || !p.name)
        return {
          ...base,
          action: 'preserve_anonymous',
          target: this.generic(p, team),
          reason:
            'Nguồn không nêu tên; giữ vai trò và sự vô danh, chỉ đổi thông tin đội.',
        };
      if (p.identity === 'fictional')
        return {
          ...base,
          action: 'preserve_fictional',
          target: p.name,
          reason: 'Nhân vật hư cấu được giữ nguyên tên và các quan hệ.',
        };
      if (!analysis.hasIndividualFocus || p.narrativeRole === 'reference')
        return {
          ...base,
          action: 'context',
          target: p.name,
          reason:
            'Tên tham chiếu; không biến thành nhân vật chính hoặc cựu cầu thủ của đội đích.',
        };
      if (
        p.identity !== 'real' ||
        p.role === 'unknown' ||
        p.role === 'other' ||
        p.temporalStatus === 'unknown'
      )
        return {
          ...base,
          action: 'generic',
          target: this.generic(p, team),
          reason:
            'Chưa đủ thông tin chắc chắn về danh tính/vai trò/trạng thái; dùng cách gọi chung.',
        };
      const ownTeam =
        !!analysis.sourceTeam &&
        norm(team.team).includes(norm(analysis.sourceTeam));
      if (
        ownTeam &&
        p.temporalStatus === 'former' &&
        !pool.some(
          (c) => c.status === 'active' && norm(c.name) === norm(p.name!),
        )
      ) {
        return {
          ...base,
          action: 'replace',
          target: p.name,
          reason:
            'Giữ nhân vật cũ của chính đội nguồn, không chuyển sang một cầu thủ đang thi đấu.',
          knowledgeSource: 'input',
        };
      }
      const proposed =
        // Ranking is supplied by the single context request, not a random roster pick.
        rows.find((r) => r.teamIndex === index && r.characterId === p.id)
          ?.candidates ?? [];
      const compatible = proposed.flatMap((choice) => {
        if (choice.confidence !== 'high' || choice.score < 70) return [];
        let candidate = pool.find((c) => c.id === choice.candidateId);
        let knowledgeSource: 'input' | 'model_knowledge' = 'input';
        if (
          !candidate &&
          p.temporalStatus === 'former' &&
          !choice.candidateId &&
          choice.historicalName?.trim()
        ) {
          if (
            pool.some(
              (c) =>
                c.status === 'active' &&
                norm(c.name) === norm(choice.historicalName!),
            )
          )
            return [];
          knowledgeSource = 'model_knowledge';
          candidate = {
            id: 'historical:' + norm(choice.historicalName),
            name: choice.historicalName,
            role: p.role === 'player' ? 'player' : 'coach',
            status: 'former',
            careerStage: 'unknown',
            importance: 'unknown',
            traits: choice.knownTraits,
            position: choice.position ?? undefined,
            headCoach: p.role === 'head_coach',
          };
        }
        if (
          !candidate ||
          used.has(norm(candidate.name)) ||
          candidate.status !== p.temporalStatus
        )
          return [];
        const sameRole =
          p.role === 'player'
            ? candidate.role === 'player'
            : p.role === 'head_coach'
              ? candidate.headCoach
              : candidate.role === 'staff' ||
                (candidate.role === 'coach' && !candidate.headCoach);
        const roleException =
          p.role === 'player' &&
          analysis.lifeEvent !== 'none' &&
          candidate.headCoach;
        if (!sameRole && !roleException) return [];
        if (p.role === 'coach_staff' && p.positionOrFunction) {
          const fn = candidate.position ?? choice.position;
          if (!fn || norm(fn) !== norm(p.positionOrFunction)) return [];
        }
        if (
          p.narrativeWeight === 'veteran' &&
          candidate.careerStage === 'rookie'
        )
          return [];
        if (
          p.narrativeWeight === 'emerging' &&
          candidate.careerStage === 'veteran'
        )
          return [];
        if (
          p.narrativeWeight === 'star' &&
          candidate.importance === 'supporting'
        )
          return [];
        const known = new Set(
          [...candidate.traits, ...choice.knownTraits].map(trait),
        );
        const required = [...p.requiredTraits];
        if (analysis.lifeEvent === 'new_baby' && !required.includes('parent'))
          required.push('parent');
        if (
          analysis.lifeEvent === 'anniversary' &&
          !required.includes('married')
        )
          required.push('married');
        if (!required.every((t) => known.has(trait(t)))) return [];
        if (
          required.some((t) =>
            candidate.traits.map(trait).includes('not_' + trait(t)),
          )
        )
          return [];
        if (
          analysis.lifeEvent === 'marriage' &&
          candidate.traits.map(trait).includes('married')
        )
          return [];
        return [
          {
            candidate,
            choice,
            knowledgeSource,
            roleException: !sameRole && roleException,
          },
        ];
      });
      const sameRoleChoices = compatible.filter((c) => !c.roleException);
      const choices = sameRoleChoices.length ? sameRoleChoices : compatible;
      const top = Math.max(...choices.map((c) => c.choice.score));
      const shortlist = choices
        .filter((c) => c.choice.score >= top - 3)
        .sort((a, b) => {
          const aLast = history.lastIndexOf(norm(a.candidate.name)),
            bLast = history.lastIndexOf(norm(b.candidate.name));
          return aLast - bLast || b.choice.score - a.choice.score;
        });
      const sameSourceTeam =
        !!analysis.sourceTeam &&
        norm(team.team).includes(norm(analysis.sourceTeam));
      const selected =
        (sameSourceTeam
          ? choices.find((c) => norm(c.candidate.name) === norm(p.name!))
          : undefined) ?? shortlist[0];
      if (!selected) {
        warnings.push(`GENERIC_FALLBACK: ${p.id}`);
        return {
          ...base,
          action: 'generic',
          target: this.generic(p, team),
          reason:
            'Không có ứng viên đủ tương thích và chắc chắn; giữ câu chuyện bằng mô tả chung, không chọn bừa.',
        };
      }
      used.add(norm(selected.candidate.name));
      return {
        ...base,
        action: 'replace',
        target: selected.candidate.name,
        role: selected.candidate.headCoach
          ? 'head_coach'
          : selected.candidate.role === 'player'
            ? 'player'
            : 'coach_staff',
        status: selected.candidate.status,
        reason:
          selected.choice.reason +
          (selected.roleException
            ? ' Đổi sang HLV theo ngoại lệ đời tư sau khi không có cầu thủ phù hợp.'
            : ''),
        knowledgeSource: selected.knowledgeSource,
        backgroundSource: selected.choice.knownTraits.some(
          (t) => !selected.candidate.traits.map(trait).includes(trait(t)),
        )
          ? 'model_knowledge'
          : selected.knowledgeSource,
        position:
          selected.candidate.position ?? selected.choice.position ?? undefined,
        ...(selected.roleException
          ? { roleException: 'life_event' as const }
          : {}),
      };
    });
    return {
      team: team.team,
      sport: team.sport,
      sourceTeam: analysis.sourceTeam,
      mappings,
      warnings,
    };
  }

  directive(batch: ContextBatchPlan, plan: ContextTeamPlan) {
    return (
      this.config.defaults().contextWriterPolicy +
      '\nCHARACTER PLAN JSON:\n' +
      JSON.stringify({
        analyzerStatus: batch.status,
        story: batch.analysis,
        sourceTeam: batch.analysis?.sourceTeam,
        targetTeam: plan.team,
        mappings: plan.mappings,
        warnings: [...batch.warnings, ...plan.warnings],
      }) +
      '\nEND CHARACTER PLAN\n\n'
    );
  }

  writerTeam(team: ContentTeam, plan: ContextTeamPlan): ContentTeam {
    const selected = new Set(
      plan.mappings
        .filter((m) => m.action === 'replace' && m.status === 'active')
        .map((m) => norm(m.target)),
    );
    return {
      ...team,
      players: team.players.filter((name) => selected.has(norm(name))),
      headCoach:
        team.headCoach && selected.has(norm(team.headCoach))
          ? team.headCoach
          : null,
      captain:
        team.captain && selected.has(norm(team.captain)) ? team.captain : null,
    };
  }

  review(
    article: PreparedContent,
    plan: ContextTeamPlan,
    teams: ContentTeam[],
  ): string[] {
    const output =
      ' ' +
      norm(
        `${article.title} ${article.caption} ${article.content.replace(/<[^>]*>/g, ' ')}`,
      ) +
      ' ';
    const caption = ' ' + norm(article.caption) + ' ';
    const contains = (text: string, name: string) =>
      text.includes(' ' + norm(name) + ' ');
    const sameTeam =
      !!plan.sourceTeam && norm(plan.team).includes(norm(plan.sourceTeam));
    const allowed = new Set(
      plan.mappings
        .filter(
          (m) =>
            m.action === 'replace' ||
            m.action === 'preserve_fictional' ||
            (m.action === 'context' && sameTeam),
        )
        .map((m) => norm(m.target)),
    );
    const warnings: string[] = [];
    for (const name of new Set(
      teams.flatMap((t) => [
        ...t.players,
        ...(t.headCoach ? [t.headCoach] : []),
        ...(t.personnel ?? []).map((p) => p.name),
      ]),
    )) {
      if (!allowed.has(norm(name)) && contains(output, name))
        warnings.push(`Bản viết đưa tên ngoài chỉ thị nhân vật: ${name}.`);
    }
    for (const m of plan.mappings) {
      if (
        (m.action === 'replace' || m.action === 'preserve_fictional') &&
        m.inCaption &&
        !contains(caption, m.target)
      )
        warnings.push(`Caption chưa dùng nhân vật đã chốt: ${m.target}.`);
      if (m.action === 'replace' && !m.inCaption && contains(caption, m.target))
        warnings.push(
          `Caption nguồn không nêu ${m.sourceName}; bản viết lại thêm tên thay thế vào caption.`,
        );
      if (
        (m.action === 'replace' || m.action === 'generic') &&
        m.sourceName &&
        norm(m.sourceName) !== norm(m.target) &&
        contains(output, m.sourceName)
      )
        warnings.push(`Bản viết còn giữ tên nguồn cần thay: ${m.sourceName}.`);
      if (m.action === 'preserve_fictional' && !contains(output, m.target))
        warnings.push(`Bản viết không giữ tên hư cấu: ${m.target}.`);
    }
    return [...new Set(warnings)];
  }

  private historyKey(team: Pick<ContentTeam, 'sport' | 'team'>) {
    return (
      (this.config.value?.('CONTENT_HISTORY_SCOPE') ?? 'legacy') +
      '|' +
      contextTeamKey(team)
    );
  }
  record(plan: ContextTeamPlan) {
    const names = plan.mappings
      .filter((m) => m.action === 'replace')
      .map((m) => norm(m.target));
    if (!names.length) return;
    const key = this.historyKey(plan);
    this.history.set(
      key,
      [...(this.history.get(key) ?? []), ...names].slice(-60),
    );
    if (this.history.size > 1000)
      this.history.delete(this.history.keys().next().value!);
  }
}
