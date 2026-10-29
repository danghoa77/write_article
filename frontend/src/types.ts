export type Person = {
  name: string;
  role: "player" | "coach" | "staff" | "other";
  status: "active" | "former" | "unknown";
  careerStage: "rookie" | "established" | "veteran" | "unknown";
  importance: "star" | "supporting" | "unknown";
  traits: string[];
  position?: string;
};
export type CharacterMode = "auto" | "preserve" | "manual";
export type CharacterSelection = {
  sport: string;
  team: string;
  sourceName: string;
  targetName: string;
};
export type TeamFact = { sport: string; team: string; facts: string };
export type CharacterSettings = {
  characterMode: CharacterMode;
  characterSelections: CharacterSelection[];
  teamFacts: TeamFact[];
};
export type StoryAnalysis = {
  summary: string;
  scan?: {
    storyType: "sad_news" | "lifestyle" | "match" | "recognition" | "other";
    identityCase: "none" | "fictional" | "real" | "mixed" | "uncertain";
    eventSpecific: "none" | "personal" | "match";
    reason: string;
  };
  characters: {
    name: string;
    identity: "real" | "fictional" | "unspecified";
    role: Person["role"];
    narrativeRole?: "primary" | "supporting" | "reference";
    affiliation?: "source_team" | "external" | "unknown";
    requiredTraits: string[];
  }[];
};
export type Team = {
  team: string;
  sport: string;
  players: string[];
  categories: number[];
  headCoach?: string | null;
  captain?: string | null;
  season?: string;
  lineupAsOf?: string;
  personnel?: Person[];
};
export type PromptStage = "rewrite";
export type Prompts = Record<PromptStage, string>;
export type PromptDocument = {
  prompts: Prompts;
  revision: number;
  version?: string;
  currentVersion?: string;
  policy?: string;
  ruleIds?: string[];
  needsSync?: boolean;
  effectivePrompts?: Partial<Record<PromptStage, string>>;
};
export type Config = {
  teams: Team[];
  prompt: string;
  pipelinePrompts: Prompts;
  trello: { listId: string };
  credentials: Record<string, boolean>;
};
export type Session = { username: string; expiresAt: number };
export type Category = { id: number; name: string };
export type WorkspaceOptions = {
  slugSuffix: string;
  textProvider: "gemini" | "gpt";
  imageProvider: "tavily" | "serper";
  geminiModel: string;
  openaiModel: string;
  categories: Category[];
};
export type WorkspaceSettings = {
  keyPools?: Record<
    string,
    {
      id: string;
      label: string;
      active: boolean;
      status: string;
      updatedAt: string | null;
    }[]
  >;
  settings: WorkspaceOptions;
  revision: number;
  credentials: Record<string, { configured: boolean; saved: boolean }>;
  providers: Record<
    string,
    { configured: boolean; status: string; updatedAt: string | null }
  >;
};
export type ApiKeyAction = {
  provider: "gemini" | "gpt" | "tavily" | "serper";
  action: "add" | "rename" | "select" | "delete" | "reuse";
  id?: string;
  label?: string;
  key?: string;
};
export type LibraryItem = {
  id: string;
  title: string;
  caption: string;
  content: string;
  note: string;
};
export type Library = { items: LibraryItem[]; revision: number };
export type Preferences = {
  selected: string[];
  categories: Record<string, number[]>;
  textProvider: "gemini" | "gpt";
  imageProvider: "tavily" | "serper";
  slugSuffix: string;
  listId: string;
};
export type Result = {
  rotation?: {
    selected: string[];
    excluded: string[];
    cycle: number;
    note: string;
  };
  preview?: boolean;
  requiresReview?: boolean;
  reviewWarnings?: string[];
  article?: { title: string; caption: string; content: string };
  characterPlan?: {
    team: string;
    sport: string;
    warnings: string[];
    mappings: {
      sourceId: string;
      sourceName: string | null;
      target: string;
      action: string;
      reason: string;
      role: string;
      status: string;
      knowledgeSource?: string;
      backgroundSource?: string;
      position?: string;
      roleException?: string;
    }[];
  };
  team: string;
  sport?: string;
  success: boolean;
  postId?: string;
  cardId?: string;
  slug?: string;
  title?: string;
  caption?: string;
  published?: boolean;
  commented?: boolean;
  stage?: string;
  statusCode?: number;
  error?: unknown;
  message?: string;
  characters?: {
    source: string;
    target: string;
    role: string;
    reason?: string;
  }[];
};
export type Run = {
  context?: {
    status: "ready" | "fallback";
    warnings: string[];
    analysis: {
      storyType: string;
      hasIndividualFocus: boolean;
      narrativeAction: string;
      keyBeats: string[];
    } | null;
    modelWarnings?: string[];
  };
  analysis?: StoryAnalysis;
  id: string;
  time: string;
  success: boolean;
  partialSuccess?: boolean;
  uncertain?: boolean;
  sessionExpired?: boolean;
  results: Result[];
  sourceCardId?: string | null;
  summary: { total: number; succeeded: number; failed: number };
};
export const teamKey = (team: Pick<Team, "sport" | "team">) =>
  `${team.sport.trim().toLowerCase()}:${team.team.trim().toLowerCase()}`;
