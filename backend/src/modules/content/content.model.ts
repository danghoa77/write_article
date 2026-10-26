import type { PromptOverrides } from './prompt.types.js';

export interface ContentTeam {
  sport: string;
  team: string;
  categories: number[];
  headCoach?: string | null;
  captain?: string | null;
  players: string[];
  personnel?: PersonProfile[];
  season?: string;
  lineupAsOf?: string;
}

export interface TeamSelection {
  sport: string;
  team: string;
}

export type TextProvider = 'gpt' | 'gemini';
export type CharacterMode = 'auto' | 'preserve' | 'manual';
export interface CharacterOptions {
  characterMode?: CharacterMode;
  characterSelections?: {
    sport: string;
    team: string;
    sourceName: string;
    targetName: string;
  }[];
  teamFacts?: { sport: string; team: string; facts: string }[];
}
export interface StoryScan {
  storyType: 'sad_news' | 'lifestyle' | 'match' | 'recognition' | 'other';
  identityCase: 'none' | 'fictional' | 'real' | 'mixed' | 'uncertain';
  eventSpecific: 'none' | 'personal' | 'match';
  reason: string;
}
export interface PersonProfile {
  name: string;
  role: 'player' | 'coach' | 'staff' | 'other';
  status: 'active' | 'former' | 'unknown';
  careerStage: 'rookie' | 'established' | 'veteran' | 'unknown';
  importance: 'star' | 'supporting' | 'unknown';
  traits: string[];
  knowledgeSource?: 'input' | 'model_knowledge';
  knowledgeNote?: string;
  position?: string;
}
export interface SourceCharacter {
  id: string;
  name: string;
  identity: 'real' | 'fictional' | 'unspecified';
  inCaption: boolean;
  role: PersonProfile['role'];
  status: 'active' | 'former' | 'any';
  careerStage: 'rookie' | 'established' | 'veteran' | 'any';
  importance: 'star' | 'supporting' | 'any';
  requiredTraits: string[];
  evidence: string;
  narrativeRole?: 'primary' | 'supporting' | 'reference';
  affiliation?: 'source_team' | 'external' | 'unknown';
}
export interface StoryAnalysis {
  summary: string;
  sourceTeam?: string;
  characters: SourceCharacter[];
  scan?: StoryScan;
}
export interface CharacterMapping {
  source: SourceCharacter;
  action: 'replace' | 'preserve' | 'context' | 'generalize';
  targetName: string;
  profile?: PersonProfile;
  selectionReason?: string;
  suitabilityScore?: number;
  roleException?: 'life_event';
}
export interface TeamPlan {
  team: ContentTeam;
  mappings: CharacterMapping[];
}
export interface CharacterRecommendation {
  sourceCharacterId: string;
  targetName: string;
  score: number;
  reason: string;
  confidence: 'high' | 'uncertain';
}
export interface BatchContentBody extends CharacterOptions {
  caption: string;
  content: string;
  teams: ContentTeam[];
  textProvider?: TextProvider;
  prompt?: string;
  prompts?: PromptOverrides;
  concurrency?: number;
}

export interface SourceContent {
  cardId: string;
  caption: string;
  content: string;
}

export interface GenerateContentBody extends CharacterOptions {
  team: ContentTeam;
  caption: string;
  content: string;
  prompt?: string;
  prompts?: PromptOverrides;
  textProvider?: TextProvider;
}

export interface PreparedContent {
  title: string;
  caption: string;
  content: string;
  sportTeam: string;
  thumbnailUrl?: string | null;
  thumbnailTier?: number;
}

export interface CompleteWorkflowBody extends CharacterOptions {
  promptVersion?: string;
  promptRevision?: number;
  login?: { username: string; password: string };
  listId?: string;
  teams?: (ContentTeam | TeamSelection)[];
  prompt?: string;
  prompts?: PromptOverrides;
  slugSuffix?: string;
  imageProvider: 'serper' | 'tavily';
  textProvider?: TextProvider;
  caption?: string;
  content?: string;
  concurrency?: number;
}
