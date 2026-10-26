import type { ContentTeam, PersonProfile } from './content.model.js';
export const STORY_TYPES = [
  'contract_retention',
  'transfer',
  'farewell',
  'return_comeback',
  'life_event',
  'injury_recovery',
  'milestone',
  'rivalry',
  'other',
] as const;
export type ContextRole =
  'player' | 'head_coach' | 'coach_staff' | 'other' | 'unknown';
export interface ContextCharacter {
  id: string;
  name: string | null;
  description: string;
  identity: 'real' | 'anonymous' | 'fictional' | 'unknown';
  inCaption: boolean;
  role: ContextRole;
  positionOrFunction: string | null;
  temporalStatus: 'active' | 'former' | 'unknown';
  narrativeRole: 'primary' | 'supporting' | 'reference';
  narrativeWeight: 'star' | 'veteran' | 'emerging' | 'any';
  requiredTraits: string[];
}
export interface ContextAnalysis {
  storyType: (typeof STORY_TYPES)[number];
  hasIndividualFocus: boolean;
  sourceTeam: string | null;
  lifeEvent:
    | 'none'
    | 'new_baby'
    | 'marriage'
    | 'anniversary'
    | 'family_milestone'
    | 'other';
  narrativeAction: string;
  keyBeats: string[];
  hasDirectQuotes: boolean;
  characters: ContextCharacter[];
}
export interface ContextCandidate extends PersonProfile {
  id: string;
  headCoach: boolean;
  captain?: boolean;
}
export interface ContextChoice {
  candidateId: string;
  historicalName: string | null;
  score: number;
  confidence: 'high' | 'uncertain';
  reason: string;
  knownTraits: string[];
  position: string | null;
}
export interface ContextResponse extends ContextAnalysis {
  recommendations: {
    teamIndex: number;
    characterId: string;
    candidates: ContextChoice[];
  }[];
  warnings: string[];
}
export interface ContextMapping {
  sourceId: string;
  sourceName: string | null;
  inCaption: boolean;
  action:
    | 'replace'
    | 'preserve_anonymous'
    | 'preserve_fictional'
    | 'generic'
    | 'context';
  target: string;
  role: ContextRole;
  status: string;
  reason: string;
  knowledgeSource?: 'input' | 'model_knowledge';
  backgroundSource?: 'input' | 'model_knowledge';
  position?: string;
  roleException?: 'life_event';
}
export interface ContextTeamPlan {
  team: string;
  sport: string;
  sourceTeam?: string | null;
  mappings: ContextMapping[];
  warnings: string[];
}
export interface ContextBatchPlan {
  status: 'ready' | 'fallback';
  analysis: ContextAnalysis | null;
  warnings: string[];
  teams: ContextTeamPlan[];
  modelWarnings?: string[];
  recommendations?: ContextResponse['recommendations'];
}
export const normalizeIdentity = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export const contextTeamKey = (team: Pick<ContentTeam, 'sport' | 'team'>) =>
  normalizeIdentity(team.sport).replace(/^nfl football$/, 'nfl') +
  ':' +
  normalizeIdentity(team.team);
