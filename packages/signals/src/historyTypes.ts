import type { OptionalSignalResult } from "./index.js";

export type HistorySourceKind =
  | "agent_transcript"
  | "git_history"
  | "ceetrix_history";

export type LanguageComfort =
  | "technical"
  | "mixed"
  | "outcome_oriented"
  | "unknown";

export type QuestionStyle =
  | "technical_choice"
  | "business_outcome"
  | "risk_compliance"
  | "guided_default";

export type InteractionGuidance = {
  languageComfort: LanguageComfort;
  questionStyle: QuestionStyle;
  rationale: string;
  suggestedQuestion: string;
};

export type HistoryProviderInput = {
  cwd: string;
  currentRequest?: string;
  transcripts?: HistoryTranscriptRecord[];
  transcriptPaths?: string[];
  gitCommits?: GitHistoryRecord[];
  ceetrixRecords?: CeetrixHistoryRecord[];
  ceetrixHistoryPaths?: string[];
  limits?: {
    maxRecords?: number;
    maxTranscriptFiles?: number;
  };
};

export type HistoryProviderResult = {
  evidence: OptionalSignalResult[];
  diagnostics: string[];
  interactionGuidance: InteractionGuidance;
};

export type HistoryTranscriptRecord = {
  speaker: "user" | "assistant" | "system" | "tool";
  text: string;
  timestamp?: string;
  source?: string;
};

export type GitHistoryRecord = {
  hash?: string;
  subject: string;
  body?: string;
  files?: string[];
  timestamp?: string;
};

export type CeetrixHistoryRecord = {
  kind: "story" | "task" | "comment" | "decision" | "retrospective";
  title?: string;
  body?: string;
  status?: string;
  timestamp?: string;
};
