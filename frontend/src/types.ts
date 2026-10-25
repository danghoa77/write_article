export type Person = {
  name: string;
  role: "player" | "coach" | "staff" | "other";
  status: "active" | "former" | "unknown";
  careerStage: "rookie" | "established" | "veteran" | "unknown";
  importance: "star" | "supporting" | "unknown";
  traits: string[];
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
export type PromptStage = "analysis" | "characterKnowledge" | "writer";
export type Prompts = Record<PromptStage, string>;
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
  concurrency: number;
  textProvider: "gemini" | "gpt";
  imageProvider: "tavily" | "serper";
  geminiModel: string;
  openaiModel: string;
  categories: Category[];
};
export type WorkspaceSettings = {
  settings: WorkspaceOptions;
  revision: number;
  credentials: Record<string, { configured: boolean; saved: boolean }>;
  providers: Record<
    string,
    { configured: boolean; status: string; updatedAt: string | null }
  >;
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
  concurrency: number;
  listId: string;
};
export type Result = {
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
};
export type Run = {
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
