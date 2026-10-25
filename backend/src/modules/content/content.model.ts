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
export interface PersonProfile {
  name: string;
  role: 'player' | 'coach' | 'staff' | 'other';
  status: 'active' | 'former' | 'unknown';
  careerStage: 'rookie' | 'established' | 'veteran' | 'unknown';
  importance: 'star' | 'supporting' | 'unknown';
  traits: string[];
  knowledgeSource?: 'input' | 'model_knowledge';
  knowledgeNote?: string;
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
}
export interface StoryAnalysis {
  summary: string;
  characters: SourceCharacter[];
}
export interface CharacterMapping {
  source: SourceCharacter;
  action: 'replace' | 'preserve';
  targetName: string;
  profile?: PersonProfile;
}
export interface TeamPlan {
  team: ContentTeam;
  mappings: CharacterMapping[];
}
export interface BatchContentBody {
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

export interface GenerateContentBody {
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

export interface CompleteWorkflowBody {
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
