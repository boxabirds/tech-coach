import type { OptionalSignalResult } from "./index.js";
import {
  loadCeetrixHistoryRecords,
  summarizeCeetrixHistory,
} from "./ceetrixHistory.js";
import { loadGitHistory, summarizeGitHistory } from "./gitHistory.js";
import type {
  HistoryProviderInput,
  HistoryProviderResult,
  InteractionGuidance,
  LanguageComfort,
  QuestionStyle,
} from "./historyTypes.js";
import {
  discoverTranscriptPaths,
  loadTranscriptRecords,
  summarizeTranscripts,
} from "./transcripts.js";

export async function collectHistoryInteractionEvidenceFromProject(
  input: HistoryProviderInput,
): Promise<HistoryProviderResult> {
  const maxRecords = input.limits?.maxRecords ?? 100;
  const sourceDiagnostics: string[] = [];
  const transcriptPaths = input.transcriptPaths
    ?? await discoverTranscriptPaths({
      cwd: input.cwd,
      maxFiles: input.limits?.maxTranscriptFiles,
    });

  const transcripts = input.transcripts
    ?? (
      transcriptPaths.length > 0
        ? await loadSource(
          "agent transcript history",
          () => loadTranscriptRecords(transcriptPaths, maxRecords),
          sourceDiagnostics,
        )
        : undefined
    );
  if (!input.transcripts && transcriptPaths.length === 0) {
    sourceDiagnostics.push("agent transcript history unavailable: no transcript files discovered");
  }
  const gitCommits = input.gitCommits
    ?? await loadSource(
      "git history",
      () => loadGitHistory(input.cwd, maxRecords),
      sourceDiagnostics,
    );
  const ceetrixRecords = input.ceetrixRecords
    ?? (
      input.ceetrixHistoryPaths
        ? await loadSource(
          "Ceetrix history",
          () => loadCeetrixHistoryRecords(input.ceetrixHistoryPaths ?? [], maxRecords),
          sourceDiagnostics,
        )
        : undefined
    );

  const result = collectHistoryInteractionEvidence({
    ...input,
    transcripts,
    gitCommits,
    ceetrixRecords,
  });

  if (sourceDiagnostics.length === 0) {
    return result;
  }

  return {
    ...result,
    diagnostics: [...result.diagnostics, ...sourceDiagnostics],
    evidence: [
      ...result.evidence,
      {
        source: "history-interaction",
        status: "absent",
        category: "diagnostic",
        freshness: "unknown",
        confidence: "low",
        evidence: sourceDiagnostics,
        error: sourceDiagnostics.join("; "),
      },
    ],
  };
}

export function collectHistoryInteractionEvidence(
  input: HistoryProviderInput,
): HistoryProviderResult {
  const maxRecords = input.limits?.maxRecords ?? 100;
  const transcript = summarizeTranscripts(input.transcripts ?? [], maxRecords);
  const git = summarizeGitHistory(input.gitCommits ?? [], maxRecords);
  const ceetrix = summarizeCeetrixHistory(input.ceetrixRecords ?? [], maxRecords);
  const diagnostics: string[] = [];

  if (!input.cwd) {
    diagnostics.push("missing active project context");
  }
  if (!input.transcripts) {
    diagnostics.push("agent transcript history unavailable");
  }
  if (!input.gitCommits) {
    diagnostics.push("git history unavailable");
  }
  if (!input.ceetrixRecords) {
    diagnostics.push("Ceetrix history unavailable");
  }

  const interactionGuidance = chooseInteractionGuidance({
    technical: transcript.technicalSignals + git.technicalSignals + ceetrix.technicalSignals * 2,
    outcome: transcript.outcomeSignals + git.outcomeSignals + ceetrix.outcomeSignals * 2,
    risk: transcript.riskSignals + git.riskSignals + ceetrix.riskSignals * 2,
    repair: transcript.repairSignals + git.repairSignals + ceetrix.reworkSignals,
    direction: transcript.directionSignals + ceetrix.decisionSignals,
    currentRequest: input.currentRequest,
  });

  const evidence: OptionalSignalResult[] = [{
    source: "history-interaction",
    status: "present",
    category: "history_interaction",
    freshness: "current",
    confidence: input.ceetrixRecords ? "high" : input.transcripts || input.gitCommits ? "medium" : "low",
    evidence: [
      ...transcript.evidence,
      ...git.evidence,
      ...ceetrix.evidence,
      `interaction style: ${interactionGuidance.questionStyle}`,
      `language comfort: ${interactionGuidance.languageComfort}`,
    ],
    interactionGuidance,
  }];

  if (diagnostics.length > 0) {
    evidence.push({
      source: "history-interaction",
      status: "absent",
      category: "diagnostic",
      freshness: "unknown",
      confidence: "low",
      evidence: diagnostics,
      error: diagnostics.join("; "),
    });
  }

  return { evidence, diagnostics, interactionGuidance };
}

export function chooseInteractionGuidance(input: {
  technical: number;
  outcome: number;
  risk: number;
  repair: number;
  direction: number;
  currentRequest?: string;
}): InteractionGuidance {
  const currentOverride = styleFromCurrentRequest(input.currentRequest);
  const questionStyle = currentOverride ?? inferredQuestionStyle(input);
  const languageComfort = languageComfortFor(input);

  return {
    languageComfort,
    questionStyle,
    rationale: rationaleFor(questionStyle, input, Boolean(currentOverride)),
    suggestedQuestion: suggestedQuestionFor(questionStyle),
  };
}

function styleFromCurrentRequest(request: string | undefined): QuestionStyle | undefined {
  const text = request?.toLowerCase() ?? "";
  if (containsAny(text, ["gdpr", "privacy", "compliance", "audit", "retention", "deletion"])) {
    return "risk_compliance";
  }
  if (containsAny(text, ["sql", "nosql", "database", "technical", "tradeoff", "architecture"])) {
    return "technical_choice";
  }
  if (containsAny(text, ["user outcome", "business", "customer", "workflow", "sharing", "search", "export"])) {
    return "business_outcome";
  }
  return undefined;
}

function inferredQuestionStyle(input: {
  technical: number;
  outcome: number;
  risk: number;
  repair: number;
  direction: number;
}): QuestionStyle {
  if (input.risk >= Math.max(2, input.technical, input.outcome)) {
    return "risk_compliance";
  }
  if (input.technical >= Math.max(3, input.outcome + 1)) {
    return "technical_choice";
  }
  if (input.outcome >= Math.max(2, input.technical)) {
    return "business_outcome";
  }
  return "guided_default";
}

function languageComfortFor(input: {
  technical: number;
  outcome: number;
  risk: number;
  repair: number;
  direction: number;
}): LanguageComfort {
  if (input.technical >= input.outcome + 2 && input.direction >= input.repair) {
    return "technical";
  }
  if (input.outcome >= input.technical + 1 || input.risk > input.technical) {
    return "outcome_oriented";
  }
  if (input.technical > 0 || input.outcome > 0 || input.risk > 0) {
    return "mixed";
  }
  return "unknown";
}

function rationaleFor(
  style: QuestionStyle,
  input: { technical: number; outcome: number; risk: number; repair: number; direction: number },
  currentOverride: boolean,
): string {
  const source = currentOverride ? "Current request overrides history." : "Derived from compact project history.";
  return `${source} technical=${input.technical}, outcome=${input.outcome}, risk=${input.risk}, repair=${input.repair}, direction=${input.direction}; selected ${style}.`;
}

function suggestedQuestionFor(style: QuestionStyle): string {
  switch (style) {
    case "technical_choice":
      return "Do you have a technical preference for this boundary, or should the coach choose a reversible default?";
    case "business_outcome":
      return "What user outcome should this architecture decision protect next?";
    case "risk_compliance":
      return "Are there privacy, retention, access-control, audit, or compliance obligations the coach should preserve?";
    case "guided_default":
      return "The coach can use a reversible default for now; is that acceptable?";
  }
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

async function loadSource<T>(
  label: string,
  loader: () => Promise<T>,
  diagnostics: string[],
): Promise<T | undefined> {
  try {
    return await loader();
  } catch (error) {
    diagnostics.push(
      `${label} unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
