import type {
  ArchitectureConcern,
  BaselineQuestion,
} from "../../kernel/src/baselineTypes.js";
import type { ArchitectureEvidenceFact } from "../../kernel/src/claimTypes.js";
import type { ArtifactPaths, CaptureAssessmentResult, PersistedAnswer } from "./types.js";

export type AssessmentGraphNodeType =
  | "run"
  | "recommendation"
  | "claim"
  | "concern"
  | "fact"
  | "evidence"
  | "question"
  | "decision"
  | "diagnostic"
  | "artifact";

export type AssessmentGraphRelation =
  | "supports"
  | "raises_question"
  | "leads_to_action"
  | "derived_from"
  | "contradicts"
  | "answered_by"
  | "stored_in"
  | "supersedes";

export type AssessmentGraphNode = {
  id: string;
  type: AssessmentGraphNodeType;
  label: string;
  summary: string;
  concern?: ArchitectureConcern;
  priority: number;
  detail: Record<string, unknown>;
};

export type AssessmentGraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: AssessmentGraphRelation;
  label: string;
};

export type NavigationHint = {
  reason: string;
  tool: "architecture.query_assessment_graph" | "architecture.get_assessment_node";
  arguments: Record<string, unknown>;
};

export type AssessmentGraph = {
  runId: string;
  nodes: AssessmentGraphNode[];
  edges: AssessmentGraphEdge[];
  counts: Record<AssessmentGraphNodeType, number>;
};

export type PageInfo = {
  limit: number;
  hasNextPage: boolean;
  nextCursor?: string;
  totalItems: number;
};

export type GraphQuery = {
  repoRoot?: string;
  runId?: string;
  nodeTypes?: AssessmentGraphNodeType[];
  concerns?: ArchitectureConcern[];
  relations?: AssessmentGraphRelation[];
  purpose?: string;
  limit?: number;
  cursor?: string;
};

export type GraphPage = {
  runId: string;
  items: AssessmentGraphNode[];
  pageInfo: PageInfo;
  navigationHints: NavigationHint[];
};

export type NodeDetailQuery = {
  repoRoot?: string;
  runId?: string;
  nodeId: string;
  includeEdges?: boolean;
  edgeLimit?: number;
  edgeCursor?: string;
};

export type NodeDetail = {
  runId: string;
  node: AssessmentGraphNode;
  edges: AssessmentGraphEdge[];
  pageInfo: PageInfo;
  navigationHints: NavigationHint[];
};

export type AssessmentIndexResult = {
  durableRecordCreated: boolean;
  storePath: string;
  runId: string;
  previousRunId?: string;
  lifecycleState: CaptureAssessmentResult["lifecycleState"];
  artifactPaths?: ArtifactPaths;
  diagnostics: CaptureAssessmentResult["diagnostics"];
  orientation: AssessmentOrientation;
  recommendation: {
    action: string;
    reason: string;
    status: string;
    intervention: string;
  };
  counts: Record<AssessmentGraphNodeType, number> & {
    answeredQuestions: number;
    skippedQuestions: number;
  };
  initialPage: GraphPage;
  navigationHints: NavigationHint[];
};

export type AssessmentOrientationState =
  | "first_use"
  | "existing_context"
  | "unavailable";

export type AssessmentOrientation = {
  state: AssessmentOrientationState;
  shouldShowPreamble: boolean;
  headline: string;
  preamble?: {
    problem: string;
    operation: string;
    technologies: string[];
    storageModel: string;
    engagement: string[];
    usageLoop: string[];
  };
  repeatNote?: string;
  artifactModel: {
    durableStore: string;
    generatedReports: Array<{
      name: string;
      description: string;
      path?: string;
    }>;
  };
  hostGuidance: string[];
};

const graphNodeTypes: AssessmentGraphNodeType[] = [
  "run",
  "recommendation",
  "claim",
  "concern",
  "fact",
  "evidence",
  "question",
  "decision",
  "diagnostic",
  "artifact",
];

const defaultLimit = 10;
const maxLimit = 50;

export class AssessmentGraphError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "AssessmentGraphError";
    this.field = field;
  }
}

export function buildAssessmentGraph(result: CaptureAssessmentResult): AssessmentGraph {
  const nodes: AssessmentGraphNode[] = [];
  const edges: AssessmentGraphEdge[] = [];
  const runId = result.runId;
  const assessment = result.assessment;
  const runNodeId = runNodeIdFor(runId);
  const recommendationNodeId = recommendationNodeIdFor(runId);
  const artifactEntries = result.artifactPaths ? Object.entries(result.artifactPaths) : [];

  pushNode(nodes, {
    id: runNodeId,
    type: "run",
    label: `Assessment run ${runId}`,
    summary: `${result.lifecycleState} assessment for ${assessment.baseline.repoRoot}`,
    priority: 0,
    detail: {
      runId,
      previousRunId: result.previousRunId,
      lifecycleState: result.lifecycleState,
      durableRecordCreated: result.durableRecordCreated,
      storePath: result.storePath,
      repoRoot: assessment.baseline.repoRoot,
    },
  });

  if (result.previousRunId) {
    pushNode(nodes, {
      id: runNodeIdFor(result.previousRunId),
      type: "run",
      label: `Previous assessment run ${result.previousRunId}`,
      summary: "Previous assessment context for this repository.",
      priority: 90,
      detail: {
        runId: result.previousRunId,
        supersededBy: runId,
      },
    });
    pushEdge(edges, runNodeId, runNodeIdFor(result.previousRunId), "supersedes", "Current run supersedes previous assessment context");
  }

  pushNode(nodes, {
    id: recommendationNodeId,
    type: "recommendation",
    label: assessment.action,
    summary: assessment.reason,
    priority: 1,
    detail: {
      action: assessment.action,
      reason: assessment.reason,
      status: assessment.status,
      intervention: assessment.intervention,
      doNotAdd: assessment.doNotAdd,
    },
  });
  pushEdge(edges, recommendationNodeId, runNodeId, "derived_from", "Recommendation belongs to this assessment run");

  const artifactNodeByName = new Map<string, string>();
  artifactEntries.forEach(([name, path], index) => {
    const id = artifactNodeIdFor(name);
    artifactNodeByName.set(name, id);
    pushNode(nodes, {
      id,
      type: "artifact",
      label: name,
      summary: path,
      priority: 80 + index,
      detail: { name, path },
    });
    pushEdge(edges, id, runNodeId, "stored_in", "Artifact belongs to this assessment run");
  });

  const latestAssessmentArtifact = artifactNodeByName.get("latestAssessmentJson")
    ?? artifactNodeByName.get("latestAssessmentMd");
  const questionsArtifact = artifactNodeByName.get("questionsJson");
  const evidenceArtifact = artifactNodeByName.get("evidenceJson");
  const decisionsArtifact = artifactNodeByName.get("decisionsJsonl");

  const evidenceIds = new Map<string, string>();
  const factIds = new Map<string, string>();
  assessment.evidence.forEach((item, index) => {
    const id = evidenceNodeIdFor(index);
    evidenceIds.set(item.summary, id);
    pushNode(nodes, {
      id,
      type: "evidence",
      label: `${item.source}${item.category ? `:${item.category}` : ""}`,
      summary: item.summary,
      concern: isConcern(item.category) ? item.category : undefined,
      priority: 30 + index,
      detail: item as unknown as Record<string, unknown>,
    });
    pushEdge(edges, id, recommendationNodeId, "supports", "Evidence contributes to the recommendation");
    if (evidenceArtifact) {
      pushEdge(edges, id, evidenceArtifact, "stored_in", "Evidence detail is stored in the evidence artifact");
    }
  });

  const normalizedFacts = extractNormalizedFacts(result);
  normalizedFacts.forEach((fact, index) => {
    const id = factNodeIdFor(fact.id);
    factIds.set(fact.id, id);
    pushNode(nodes, {
      id,
      type: "fact",
      label: fact.label,
      summary: fact.summary,
      concern: fact.concern,
      priority: 24 + index,
      detail: fact as unknown as Record<string, unknown>,
    });
    pushEdge(edges, id, recommendationNodeId, "supports", "Normalized fact contributes to the recommendation");
    if (evidenceArtifact) {
      pushEdge(edges, id, evidenceArtifact, "stored_in", "Normalized fact detail is stored in the evidence artifact");
    }
  });

  const concernNodes = new Map<ArchitectureConcern, string>();
  assessment.baseline.concerns.forEach((concern, index) => {
    const id = concernNodeIdFor(concern.concern);
    concernNodes.set(concern.concern, id);
    pushNode(nodes, {
      id,
      type: "concern",
      label: concern.concern,
      summary: concern.rationale,
      concern: concern.concern,
      priority: 20 + index,
      detail: {
        concern: concern.concern,
        currentState: concern.currentState,
        confidence: concern.confidence,
        axes: concern.axes,
        thresholdCandidates: concern.thresholdCandidates,
        rationale: concern.rationale,
        factIds: concern.facts.map((fact) => fact.id),
        unknownIds: concern.unknowns.map((unknown) => unknown.id),
      },
    });
    pushEdge(edges, id, recommendationNodeId, "leads_to_action", "Concern contributes to the recommendation");
    for (const fact of concern.facts) {
      for (const evidence of assessment.evidence) {
        if (fact.summary.includes(evidence.summary) || evidence.summary.includes(fact.summary)) {
          pushEdge(edges, evidenceIds.get(evidence.summary)!, id, "supports", "Evidence supports this concern");
        }
      }
    }
    for (const fact of normalizedFacts.filter((item) => item.concern === concern.concern)) {
      const factId = factIds.get(fact.id);
      if (factId) {
        pushEdge(edges, factId, id, "supports", "Normalized fact supports this concern");
      }
    }
  });

  for (const claim of assessment.claims ?? []) {
    const id = claimNodeIdFor(claim.id);
    pushNode(nodes, {
      id,
      type: "claim",
      label: claim.subject,
      summary: claim.claim,
      concern: claim.concern,
      priority: claim.confidence === "high" ? 5 : claim.confidence === "medium" ? 10 : 15,
      detail: claim as unknown as Record<string, unknown>,
    });
    pushEdge(edges, id, recommendationNodeId, "leads_to_action", "Claim contributes to the recommendation");
    const concernNodeId = concernNodes.get(claim.concern);
    if (concernNodeId) {
      pushEdge(edges, id, concernNodeId, "supports", "Claim supports this concern");
    }
    for (const evidenceText of claim.evidence) {
      const evidenceId = findEvidenceNodeId(evidenceIds, evidenceText);
      if (evidenceId) {
        pushEdge(edges, evidenceId, id, "supports", "Evidence supports this claim");
      }
      const factId = findFactNodeId(factIds, normalizedFacts, evidenceText);
      if (factId) {
        pushEdge(edges, factId, id, "supports", "Normalized fact supports this claim");
      }
    }
    for (const counterEvidence of claim.counterEvidence) {
      const evidenceId = findEvidenceNodeId(evidenceIds, counterEvidence);
      if (evidenceId) {
        pushEdge(edges, evidenceId, id, "contradicts", "Evidence contradicts this claim");
      }
    }
    if (latestAssessmentArtifact) {
      pushEdge(edges, id, latestAssessmentArtifact, "stored_in", "Claim detail is stored in the latest assessment artifact");
    }
  }

  const allQuestions: Array<{
    question: BaselineQuestion;
    state: "open" | "answered" | "skipped";
    answer?: PersistedAnswer;
  }> = [
    ...result.openQuestions.map((question) => ({ question, state: "open" as const })),
    ...result.answeredQuestions.map((answer) => ({
      question: questionFromAnswer(answer.questionId, answer.value ?? answer.note ?? answer.action),
      state: "answered" as const,
      answer,
    })),
    ...result.skippedQuestions.map((answer) => ({
      question: questionFromAnswer(answer.questionId, answer.note ?? answer.action),
      state: "skipped" as const,
      answer,
    })),
  ];

  allQuestions.forEach(({ question, state, answer }, index) => {
    const id = questionNodeIdFor(question.id);
    pushNode(nodes, {
      id,
      type: "question",
      label: displayQuestionLabel(question),
      summary: question.prompt,
      concern: question.concern,
      priority: state === "open" ? 40 + index : 55 + index,
      detail: {
        ...question,
        state,
        answer,
      } as unknown as Record<string, unknown>,
    });
    const concernNodeId = concernNodes.get(question.concern);
    if (concernNodeId) {
      pushEdge(edges, concernNodeId, id, "raises_question", "Concern raises this question");
    }
    if (questionsArtifact) {
      pushEdge(edges, id, questionsArtifact, "stored_in", "Question state is stored in the questions artifact");
    }
    if (answer) {
      for (const decision of result.decisions) {
        if (answer.runId && decision.runId === answer.runId) {
          pushEdge(edges, id, decisionNodeIdFor(decision.id), "answered_by", "Question context is connected to this decision");
        }
      }
    }
  });

  result.decisions.forEach((decision, index) => {
    const id = decisionNodeIdFor(decision.id);
    pushNode(nodes, {
      id,
      type: "decision",
      label: decision.id,
      summary: decision.decision,
      priority: 60 + index,
      detail: decision as unknown as Record<string, unknown>,
    });
    pushEdge(edges, id, runNodeIdFor(decision.runId ?? runId), "answered_by", "Decision is connected to this assessment run");
    if (decisionsArtifact) {
      pushEdge(edges, id, decisionsArtifact, "stored_in", "Decision is stored in the decisions artifact");
    }
  });

  [...result.diagnostics, ...assessment.baseline.diagnostics].forEach((diagnostic, index) => {
    const id = diagnosticNodeIdFor(index, diagnostic.id);
    pushNode(nodes, {
      id,
      type: "diagnostic",
      label: diagnostic.id,
      summary: diagnostic.message,
      priority: diagnostic.severity === "error" ? 2 + index : 70 + index,
      detail: diagnostic as unknown as Record<string, unknown>,
    });
    pushEdge(edges, id, runNodeId, "derived_from", "Diagnostic belongs to this assessment run");
  });

  return {
    runId,
    nodes: nodes.sort(compareNodes),
    edges: dedupeEdges(edges),
    counts: countNodes(nodes),
  };
}

function displayQuestionLabel(question: BaselineQuestion): string {
  const concern = question.concern === "unknown"
    ? "Architecture"
    : titleCase(question.concern.replace(/_/g, " "));
  return `${concern} question`;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

export function createAssessmentIndex(result: CaptureAssessmentResult, limit = defaultLimit): AssessmentIndexResult {
  const graph = buildAssessmentGraph(result);
  const initialPage = queryAssessmentGraph(graph, { limit, purpose: "initial" });
  return {
    durableRecordCreated: result.durableRecordCreated,
    storePath: result.storePath,
    runId: result.runId,
    ...(result.previousRunId ? { previousRunId: result.previousRunId } : {}),
    lifecycleState: result.lifecycleState,
    ...(result.artifactPaths ? { artifactPaths: result.artifactPaths } : {}),
    diagnostics: result.diagnostics,
    orientation: createAssessmentOrientation(result),
    recommendation: {
      action: result.assessment.action,
      reason: result.assessment.reason,
      status: result.assessment.status,
      intervention: result.assessment.intervention,
    },
    counts: {
      ...graph.counts,
      answeredQuestions: result.answeredQuestions.length,
      skippedQuestions: result.skippedQuestions.length,
    },
    initialPage,
    navigationHints: initialPage.navigationHints,
  };
}

export function createAssessmentOrientation(result: CaptureAssessmentResult): AssessmentOrientation {
  const state = orientationState(result);
  const artifactModel = artifactModelFor(result);
  const hostGuidance = [
    "The host agent should explain, interview, and summarize in normal conversation.",
    "MCP tools provide deterministic capture, durable state, artifact indexes, and paged graph navigation.",
    "Ask blocking questions directly; keep raw question ids and graph node ids as internal tool handles.",
    "Continue into the assessment after the orientation instead of presenting a menu of modes.",
  ];

  if (state === "first_use") {
    return {
      state,
      shouldShowPreamble: true,
      headline: "This is the first Ceetrix Tech Lead baseline for this repository.",
      preamble: {
        problem: "Ceetrix Tech Lead helps keep architecture proportional as complexity evolves, avoiding both premature structure and accumulated hacks.",
        operation: "Claude handles the conversation; local MCP tools inspect repository signals, persist assessment state, and expose paged evidence for follow-up.",
        technologies: [
          "Claude Code skill instructions",
          "Tech Lead MCP tools",
          "optional Claude lifecycle hooks",
          "repo-local bun:sqlite persistence",
          "generated Markdown and JSON reports under .ceetrix/tech-lead/",
        ],
        storageModel: `${artifactModel.durableStore} is the durable local source of truth; Markdown and JSON files are generated reports, indexes, or exports from that store.`,
        engagement: [
          "first repository baseline",
          "pending change assessment",
          "structure review",
          "horizon scan",
          "lifecycle hook signals where configured",
          "follow-up answer or decision capture",
        ],
        usageLoop: [
          "run the coach in a repository",
          "let it inspect local signals",
          "answer follow-up questions when confidence is blocked",
          "confirm durable decisions explicitly",
          "revisit generated reports or graph evidence on later runs",
        ],
      },
      artifactModel,
      hostGuidance,
    };
  }

  if (state === "existing_context") {
    return {
      state,
      shouldShowPreamble: false,
      headline: "Ceetrix Tech Lead found existing repository context.",
      repeatNote: "Use a short existing-context note and do not repeat the full preamble; show the full preamble only if the user asks for orientation.",
      artifactModel,
      hostGuidance,
    };
  }

  return {
    state,
    shouldShowPreamble: false,
    headline: "Ceetrix Tech Lead could not create durable repository context.",
    repeatNote: "Explain the persistence diagnostic and do not claim that generated reports or durable tracking exist.",
    artifactModel,
    hostGuidance,
  };
}

function orientationState(result: CaptureAssessmentResult): AssessmentOrientationState {
  if (!result.durableRecordCreated || result.lifecycleState === "unavailable") {
    return "unavailable";
  }
  return result.previousRunId ? "existing_context" : "first_use";
}

function artifactModelFor(result: CaptureAssessmentResult): AssessmentOrientation["artifactModel"] {
  return {
    durableStore: result.storePath,
    generatedReports: [
      generatedReport("latest-assessment.md", "generated human-readable latest assessment report", result.artifactPaths?.latestAssessmentMd),
      generatedReport("latest-assessment.json", "generated machine-readable latest-run snapshot", result.artifactPaths?.latestAssessmentJson),
      generatedReport("questions.json", "generated question state index", result.artifactPaths?.questionsJson),
      generatedReport("evidence.json", "generated evidence and claims index", result.artifactPaths?.evidenceJson),
      generatedReport("next-actions.md", "generated next-action report", result.artifactPaths?.nextActionsMd),
      generatedReport("decisions.jsonl", "generated confirmed-decision export", result.artifactPaths?.decisionsJsonl),
      generatedReport("changes-since-last.md", "generated rerun delta report", result.artifactPaths?.changesSinceLastMd),
    ],
  };
}

function generatedReport(
  name: string,
  description: string,
  path: string | undefined,
): AssessmentOrientation["artifactModel"]["generatedReports"][number] {
  return {
    name,
    description,
    ...(path ? { path } : {}),
  };
}

export function queryAssessmentGraph(graph: AssessmentGraph, query: GraphQuery = {}): GraphPage {
  const limit = normalizeLimit(query.limit);
  const offset = decodeCursor(query.cursor, graph.runId, "nodes", query);
  const filtered = filterNodes(graph, query);
  const items = filtered.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    runId: graph.runId,
    items,
    pageInfo: {
      limit,
      totalItems: filtered.length,
      hasNextPage: nextOffset < filtered.length,
      ...(nextOffset < filtered.length
        ? { nextCursor: encodeCursor(graph.runId, "nodes", query, nextOffset) }
        : {}),
    },
    navigationHints: navigationHintsForPage(graph, items, query),
  };
}

export function getAssessmentNode(graph: AssessmentGraph, query: NodeDetailQuery): NodeDetail {
  if (!query.nodeId) {
    throw new AssessmentGraphError("input.nodeId", "is required");
  }
  const node = graph.nodes.find((item) => item.id === query.nodeId);
  if (!node) {
    throw new AssessmentGraphError("input.nodeId", `unknown graph node ${query.nodeId}`);
  }
  const limit = normalizeLimit(query.edgeLimit);
  const offset = decodeCursor(query.edgeCursor, graph.runId, `edges:${node.id}`, {});
  const allEdges = query.includeEdges === false
    ? []
    : graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
  const edges = allEdges.slice(offset, offset + limit);
  const nextOffset = offset + edges.length;
  return {
    runId: graph.runId,
    node,
    edges,
    pageInfo: {
      limit,
      totalItems: allEdges.length,
      hasNextPage: nextOffset < allEdges.length,
      ...(nextOffset < allEdges.length
        ? { nextCursor: encodeCursor(graph.runId, `edges:${node.id}`, {}, nextOffset) }
        : {}),
    },
    navigationHints: navigationHintsForNode(graph, node, edges),
  };
}

function filterNodes(graph: AssessmentGraph, query: GraphQuery): AssessmentGraphNode[] {
  const relationNodeIds = new Set<string>();
  if (query.relations?.length) {
    for (const edge of graph.edges) {
      if (query.relations.includes(edge.relation)) {
        relationNodeIds.add(edge.from);
        relationNodeIds.add(edge.to);
      }
    }
  }
  return graph.nodes.filter((node) => {
    if (query.nodeTypes?.length && !query.nodeTypes.includes(node.type)) {
      return false;
    }
    if (query.concerns?.length && node.concern && !query.concerns.includes(node.concern)) {
      return false;
    }
    if (query.concerns?.length && !node.concern) {
      return false;
    }
    if (query.relations?.length && !relationNodeIds.has(node.id)) {
      return false;
    }
    return true;
  });
}

function navigationHintsForPage(
  graph: AssessmentGraph,
  items: AssessmentGraphNode[],
  query: GraphQuery,
): NavigationHint[] {
  const hints: NavigationHint[] = [];
  const claim = items.find((item) => item.type === "claim")
    ?? graph.nodes.find((item) => item.type === "claim");
  if (claim) {
    hints.push({
      reason: `Load supporting evidence for ${claim.label}.`,
      tool: "architecture.get_assessment_node",
      arguments: { runId: graph.runId, nodeId: claim.id, includeEdges: true, edgeLimit: 10 },
    });
  }
  if (!query.nodeTypes?.includes("question") && graph.counts.question > 0) {
    hints.push({
      reason: "Load open or answered architecture questions.",
      tool: "architecture.query_assessment_graph",
      arguments: { runId: graph.runId, nodeTypes: ["question"], limit: 10 },
    });
  }
  const artifact = graph.nodes.find((item) => item.type === "artifact" && item.id.includes("latestAssessmentMd"));
  if (artifact) {
    hints.push({
      reason: "Load the human-readable artifact path for manual inspection.",
      tool: "architecture.get_assessment_node",
      arguments: { runId: graph.runId, nodeId: artifact.id, includeEdges: false },
    });
  }
  return hints.slice(0, 4);
}

function navigationHintsForNode(
  graph: AssessmentGraph,
  node: AssessmentGraphNode,
  edges: AssessmentGraphEdge[],
): NavigationHint[] {
  const hints: NavigationHint[] = [];
  const evidenceEdge = edges.find((edge) =>
    edge.relation === "supports"
    && graph.nodes.find((item) => item.id === edge.from)?.type === "evidence"
  );
  if (evidenceEdge) {
    hints.push({
      reason: "Inspect the evidence behind this item.",
      tool: "architecture.get_assessment_node",
      arguments: { runId: graph.runId, nodeId: evidenceEdge.from, includeEdges: true, edgeLimit: 10 },
    });
  }
  if (node.concern) {
    hints.push({
      reason: `Load graph items for the ${node.concern} concern.`,
      tool: "architecture.query_assessment_graph",
      arguments: { runId: graph.runId, concerns: [node.concern], limit: 10 },
    });
  }
  return hints.slice(0, 3);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return defaultLimit;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new AssessmentGraphError("input.limit", `must be an integer between 1 and ${maxLimit}`);
  }
  return limit;
}

function encodeCursor(
  runId: string,
  scope: string,
  query: GraphQuery | Record<string, unknown>,
  offset: number,
): string {
  return Buffer.from(JSON.stringify({
    runId,
    scope,
    offset,
    nodeTypes: "nodeTypes" in query ? query.nodeTypes : undefined,
    concerns: "concerns" in query ? query.concerns : undefined,
    relations: "relations" in query ? query.relations : undefined,
  }), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string | undefined,
  runId: string,
  scope: string,
  query: GraphQuery | Record<string, unknown>,
): number {
  if (!cursor) {
    return 0;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new AssessmentGraphError("input.cursor", "is malformed");
  }
  if (parsed.runId !== runId || parsed.scope !== scope) {
    throw new AssessmentGraphError("input.cursor", "does not match the requested run or page scope");
  }
  if (JSON.stringify(parsed.nodeTypes ?? undefined) !== JSON.stringify("nodeTypes" in query ? query.nodeTypes : undefined)
    || JSON.stringify(parsed.concerns ?? undefined) !== JSON.stringify("concerns" in query ? query.concerns : undefined)
    || JSON.stringify(parsed.relations ?? undefined) !== JSON.stringify("relations" in query ? query.relations : undefined)) {
    throw new AssessmentGraphError("input.cursor", "does not match the requested graph filters");
  }
  if (!Number.isInteger(parsed.offset) || Number(parsed.offset) < 0) {
    throw new AssessmentGraphError("input.cursor", "has an invalid offset");
  }
  return Number(parsed.offset);
}

function pushNode(nodes: AssessmentGraphNode[], node: AssessmentGraphNode): void {
  if (!nodes.some((item) => item.id === node.id)) {
    nodes.push(node);
  }
}

function pushEdge(
  edges: AssessmentGraphEdge[],
  from: string,
  to: string,
  relation: AssessmentGraphRelation,
  label: string,
): void {
  if (!from || !to) {
    return;
  }
  edges.push({
    id: `${relation}:${from}->${to}`,
    from,
    to,
    relation,
    label,
  });
}

function dedupeEdges(edges: AssessmentGraphEdge[]): AssessmentGraphEdge[] {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}

function compareNodes(a: AssessmentGraphNode, b: AssessmentGraphNode): number {
  return a.priority - b.priority || a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
}

function countNodes(nodes: AssessmentGraphNode[]): Record<AssessmentGraphNodeType, number> {
  const counts = Object.fromEntries(graphNodeTypes.map((type) => [type, 0])) as Record<AssessmentGraphNodeType, number>;
  for (const node of nodes) {
    counts[node.type] += 1;
  }
  return counts;
}

function findEvidenceNodeId(evidenceIds: Map<string, string>, text: string): string | undefined {
  for (const [summary, id] of evidenceIds) {
    if (summary.includes(text) || text.includes(summary)) {
      return id;
    }
  }
  return undefined;
}

function findFactNodeId(
  factIds: Map<string, string>,
  facts: ArchitectureEvidenceFact[],
  text: string,
): string | undefined {
  const normalized = text.toLowerCase();
  for (const fact of facts) {
    const anchors = [
      fact.id,
      fact.label,
      fact.summary,
      ...fact.provenance.flatMap((item) => [item.path, item.excerpt, item.symbol].filter(Boolean) as string[]),
    ].map((item) => item.toLowerCase());
    if (anchors.some((anchor) => normalized.includes(anchor) || anchor.includes(normalized))) {
      return factIds.get(fact.id);
    }
    const haystack = [
      fact.id,
      fact.label,
      fact.summary,
      ...fact.provenance.flatMap((item) => [item.path, item.excerpt, item.symbol].filter(Boolean) as string[]),
    ].join(" ").toLowerCase();
    if (haystack.includes(normalized) || normalized.includes(fact.summary.toLowerCase())) {
      return factIds.get(fact.id);
    }
  }
  return undefined;
}

function extractNormalizedFacts(result: CaptureAssessmentResult): ArchitectureEvidenceFact[] {
  const signals = [
    ...(result.telemetry?.repository ?? []),
    ...(result.telemetry?.change ?? []),
    ...(result.telemetry?.test ?? []),
    ...(result.telemetry?.memory ?? []),
    ...(result.telemetry?.runtime ?? []),
  ];
  const facts = signals.flatMap((signal) => {
    const details = "details" in signal.payload ? signal.payload.details : undefined;
    return isRecord(details) && Array.isArray(details.facts)
      ? details.facts.filter(isArchitectureEvidenceFact)
      : [];
  });
  const seen = new Set<string>();
  return facts.filter((fact) => {
    if (seen.has(fact.id)) {
      return false;
    }
    seen.add(fact.id);
    return true;
  });
}

function isArchitectureEvidenceFact(value: unknown): value is ArchitectureEvidenceFact {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.label === "string"
    && typeof value.summary === "string"
    && typeof value.source === "string"
    && typeof value.concern === "string"
    && Array.isArray(value.provenance);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConcern(value: string | undefined): value is ArchitectureConcern {
  return typeof value === "string" && [
    "application_shape",
    "package_boundary",
    "entrypoint",
    "state_ownership",
    "data_storage",
    "authentication",
    "authorization",
    "deployment",
    "api_contract",
    "background_job",
    "testing",
    "observability",
    "risk_hotspot",
    "unknown",
  ].includes(value);
}

function questionFromAnswer(id: string, summary: string): BaselineQuestion {
  return {
    id,
    concern: "unknown",
    kind: "free_text",
    prompt: summary,
    reason: "Persisted answer from a previous assessment.",
    relatedFactIds: [],
    relatedUnknownIds: [],
    relatedSignalIds: [],
  };
}

function runNodeIdFor(runId: string): string {
  return `run:${runId}`;
}

function recommendationNodeIdFor(runId: string): string {
  return `recommendation:${runId}`;
}

function artifactNodeIdFor(name: string): string {
  return `artifact:${name}`;
}

function evidenceNodeIdFor(index: number): string {
  return `evidence:${index}`;
}

function factNodeIdFor(id: string): string {
  return `fact:${id}`;
}

function concernNodeIdFor(concern: ArchitectureConcern): string {
  return `concern:${concern}`;
}

function claimNodeIdFor(id: string): string {
  return `claim:${id}`;
}

function questionNodeIdFor(id: string): string {
  return `question:${id}`;
}

function decisionNodeIdFor(id: string): string {
  return `decision:${id}`;
}

function diagnosticNodeIdFor(index: number, id: string): string {
  return `diagnostic:${id || index}`;
}
