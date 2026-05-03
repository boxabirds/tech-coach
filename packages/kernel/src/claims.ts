import type {
  ArchitectureConcern,
  BaselineConfidence,
  BaselineFreshness,
} from "./baselineTypes.js";
import type {
  ArchitecturalTelemetryBundle,
  SignalEnvelope,
  SignalFamily,
} from "./telemetryTypes.js";
import type {
  ArchitectureClaim,
  ArchitectureEvidenceFact,
  ArchitectureEvidenceGraph,
  ArchitectureEvidenceNode,
  ArchitectureFactKind,
  ArchitectureFactProvenance,
  ClaimEvidenceFamily,
} from "./claimTypes.js";

type SignalLike = SignalEnvelope<{
  category?: string;
  evidence?: string[];
  details?: Record<string, unknown>;
}>;

type ClaimRule = {
  concern: ArchitectureConcern;
  requiredFamilies: ClaimEvidenceFamily[];
  optionalFamilies?: ClaimEvidenceFamily[];
  subject: string;
  claim: string;
  residualUnknowns?: string[];
};

const claimRules: ClaimRule[] = [
  {
    concern: "authentication",
    requiredFamilies: ["route", "external_provider", "session"],
    optionalFamilies: ["credential"],
    subject: "web user authentication",
    claim: "Web users authenticate through an external identity provider and server-side sessions.",
  },
  {
    concern: "authentication",
    requiredFamilies: ["credential", "session"],
    subject: "programmatic authentication",
    claim: "Programmatic access uses credentials and server-side session state.",
  },
  {
    concern: "authorization",
    requiredFamilies: ["authorization"],
    optionalFamilies: ["schema"],
    subject: "authorization boundary",
    claim: "Repository evidence shows role, membership, or permission boundaries.",
    residualUnknowns: ["Which future access-control change or risk should guide the next architecture review."],
  },
  {
    concern: "data_storage",
    requiredFamilies: ["schema"],
    optionalFamilies: ["binding"],
    subject: "persistent data storage",
    claim: "Persistent data appears to be backed by relational schema or migrations.",
    residualUnknowns: ["Which storage operations are most important to protect first."],
  },
  {
    concern: "deployment",
    requiredFamilies: ["deployment_config"],
    subject: "deployment target",
    claim: "Deployment or release configuration is present and should be treated as load-bearing.",
    residualUnknowns: ["Which rollout risk should guide the next operational check."],
  },
  {
    concern: "package_boundary",
    requiredFamilies: ["package_boundary"],
    optionalFamilies: ["runtime_boundary", "test_surface"],
    subject: "package or workspace boundary",
    claim: "Package or workspace boundaries are visible.",
  },
  {
    concern: "package_boundary",
    requiredFamilies: ["runtime_boundary"],
    optionalFamilies: ["test_surface"],
    subject: "runtime boundary",
    claim: "Runtime boundary evidence is visible.",
  },
  {
    concern: "testing",
    requiredFamilies: ["test_surface"],
    subject: "test surface",
    claim: "The repository contains a visible test surface that can anchor targeted harnesses.",
  },
  {
    concern: "observability",
    requiredFamilies: ["observability"],
    subject: "runtime feedback",
    claim: "Runtime feedback or operational evidence is visible.",
    residualUnknowns: ["Which user-visible failure should runtime monitoring protect first."],
  },
];

export function buildArchitectureEvidenceGraph(
  telemetry: ArchitecturalTelemetryBundle,
): ArchitectureEvidenceGraph {
  const signals = flattenSignals(telemetry);
  const facts = dedupeFacts(signals.flatMap((signal) => factsFromSignal(signal)));
  const nodes = signals.flatMap((signal) =>
    evidenceNodesFromSignal(signal)
  );
  return {
    nodes: dedupeNodes(nodes),
    facts,
    diagnostics: [],
  };
}

export function inferArchitectureClaims(
  graph: ArchitectureEvidenceGraph,
): ArchitectureClaim[] {
  const claims: ArchitectureClaim[] = [];
  for (const rule of claimRules) {
    const nodes = graph.nodes.filter((node) => node.concern === rule.concern);
    const required = rule.requiredFamilies.flatMap((family) =>
      nodes.filter((node) => node.family === family)
    );
    if (!hasAllFamilies(nodes, rule.requiredFamilies)) {
      continue;
    }
    const optional = (rule.optionalFamilies ?? []).flatMap((family) =>
      nodes.filter((node) => node.family === family)
    );
    const evidenceNodes = selectEvidenceNodes(rule, [...required, ...optional]);
    if (!claimHasMinimumSupport(rule, evidenceNodes)) {
      continue;
    }
    const confidence = confidenceForClaim(rule, evidenceNodes);
    claims.push({
      id: stableId("claim", rule.concern, rule.subject),
      concern: rule.concern,
      subject: rule.subject,
      claim: specializeClaim(rule, evidenceNodes),
      confidence,
      evidenceNodeIds: evidenceNodes.map((node) => node.id),
      evidence: selectClaimCitations(evidenceNodes),
      counterEvidence: [],
      residualUnknowns: rule.residualUnknowns ?? [],
    });
  }
  return dedupeClaims(claims);
}

function selectClaimCitations(nodes: ArchitectureEvidenceNode[], limit = 10): string[] {
  const selected: string[] = [];
  for (const node of nodes) {
    const citation = node.citations.find((item) => item.trim().length > 0);
    if (citation && !selected.includes(citation)) {
      selected.push(citation);
    }
  }
  for (const citation of nodes.flatMap((node) => node.citations)) {
    if (selected.length >= limit) {
      break;
    }
    if (!selected.includes(citation)) {
      selected.push(citation);
    }
  }
  return selected.slice(0, limit);
}

function selectEvidenceNodes(
  rule: ClaimRule,
  candidates: ArchitectureEvidenceNode[],
): ArchitectureEvidenceNode[] {
  const deduped = dedupeNodes(candidates);
  const selected: ArchitectureEvidenceNode[] = [];
  for (const family of [...rule.requiredFamilies, ...(rule.optionalFamilies ?? [])]) {
    const familyNode = deduped.find((node) => node.family === family);
    if (familyNode) {
      selected.push(familyNode);
    }
  }
  for (const node of deduped) {
    if (selected.length >= 12) {
      break;
    }
    if (!selected.some((existing) => existing.id === node.id)) {
      selected.push(node);
    }
  }
  return selected;
}

export function claimsForTelemetry(
  telemetry: ArchitecturalTelemetryBundle,
): ArchitectureClaim[] {
  return inferArchitectureClaims(buildArchitectureEvidenceGraph(telemetry));
}

function evidenceNodesFromSignal(signal: SignalLike): ArchitectureEvidenceNode[] {
  const evidence = Array.isArray(signal.payload.evidence)
    ? signal.payload.evidence
    : [];
  const factNodes = factsFromSignal(signal).map((fact, index) =>
    makeNode({
      concern: fact.concern,
      family: fact.family,
      label: fact.label,
      summary: fact.summary,
      citations: citationsForFact(fact),
      signal,
      index,
      factId: fact.id,
      factKind: fact.kind,
      provenance: fact.provenance,
      confidence: fact.confidence,
      freshness: fact.freshness,
    })
  );
  const textNodes = evidence
    .map((line, index) => parseEvidenceLine(line, signal, index))
    .filter((node): node is ArchitectureEvidenceNode => Boolean(node));
  return [...factNodes, ...textNodes];
}

function parseEvidenceLine(
  line: string,
  signal: SignalLike,
  index: number,
): ArchitectureEvidenceNode | undefined {
  const tagged = /^(?<concern>[a-z_]+)\.(?<family>[a-z_]+):\s*(?<label>[^:]+):\s*(?<citations>.+)$/i.exec(line);
  if (tagged?.groups) {
    const concern = normalizeConcern(tagged.groups.concern);
    const family = normalizeFamily(tagged.groups.family);
    const citations = tagged.groups.citations
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return makeNode({
      concern,
      family,
      label: tagged.groups.label.trim(),
      summary: line,
      citations,
      signal,
      index,
    });
  }

  const concern = concernFromText(line);
  if (!concern) {
    return undefined;
  }
  return makeNode({
    concern,
    family: familyFromText(line),
    label: `${concern} evidence`,
    summary: line,
    citations: [line],
    signal,
    index,
  });
}

function makeNode(input: {
  concern: ArchitectureConcern;
  family: ClaimEvidenceFamily;
  label: string;
  summary: string;
  citations: string[];
  signal: SignalLike;
  index: number;
  factId?: string;
  factKind?: ArchitectureFactKind;
  provenance?: ArchitectureFactProvenance[];
  confidence?: BaselineConfidence;
  freshness?: BaselineFreshness;
}): ArchitectureEvidenceNode {
  return {
    id: input.factId
      ? stableId("evidence", input.signal.id, input.factId)
      : stableId("evidence", input.signal.id, input.index.toString(), input.family),
    concern: input.concern,
    family: input.family,
    label: input.label,
    summary: input.summary,
    citations: input.citations,
    ...(input.factId ? { factId: input.factId } : {}),
    ...(input.factKind ? { factKind: input.factKind } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    signalFamily: input.signal.family,
    signalId: input.signal.id,
    source: input.signal.source,
    confidence: input.confidence ?? normalizeConfidence(input.signal.confidence),
    freshness: input.freshness ?? normalizeFreshness(input.signal.freshness),
  };
}

function hasAllFamilies(
  nodes: ArchitectureEvidenceNode[],
  families: ClaimEvidenceFamily[],
): boolean {
  const present = new Set(nodes.map((node) => node.family));
  return families.every((family) => present.has(family));
}

function confidenceForClaim(
  rule: ClaimRule,
  nodes: ArchitectureEvidenceNode[],
): BaselineConfidence {
  const presentFamilies = new Set(nodes.map((node) => node.family));
  const corroboration = presentFamilies.size;
  const highEvidence = nodes.filter((node) => node.confidence === "high").length;
  if (rule.concern === "authorization" && hasConcreteAuthorizationEvidence(nodes)) {
    return "high";
  }
  if (rule.concern === "deployment" && hasConcreteDeploymentEvidence(nodes)) {
    return "high";
  }
  if (rule.concern === "authentication" && hasConcreteAuthenticationEvidence(nodes)) {
    return "high";
  }
  if (corroboration >= Math.max(3, rule.requiredFamilies.length) || highEvidence >= 2) {
    return "high";
  }
  if (corroboration >= rule.requiredFamilies.length) {
    return "medium";
  }
  return "low";
}

function specializeClaim(rule: ClaimRule, nodes: ArchitectureEvidenceNode[]): string {
  const text = nodes.flatMap((node) => node.citations).join(" ").toLowerCase();
  if (rule.concern === "authentication" && rule.subject === "programmatic authentication") {
    return "Programmatic access uses credentials and server-side session state.";
  }
  if (rule.concern === "authentication" && text.includes("github")) {
    if (text.includes("session")) {
      return "Web users authenticate through an external OAuth provider with server-side session state.";
    }
    return "Web users authenticate through an external OAuth provider.";
  }
  if (rule.concern === "authorization") {
    if (/(user[-_ ]?projects?|project)/.test(text) && /(role|membership|member)/.test(text)) {
      return "Membership and role boundaries are visible and should be treated as load-bearing authorization.";
    }
    if (/(permission|resource)/.test(text)) {
      return "Resource-level permission boundaries are visible and should be treated as load-bearing authorization.";
    }
    if (/(admin)/.test(text)) {
      return "Admin-only authorization boundaries are visible and should be treated as load-bearing authorization.";
    }
    if (/(membership|member|role|rbac)/.test(text)) {
      return "Role or membership authorization boundaries are visible and should be treated as load-bearing authorization.";
    }
  }
  if (rule.concern === "data_storage" && (text.includes("d1") || text.includes(".sql"))) {
    return "Persistent data appears to be backed by relational schema or migrations.";
  }
  if (rule.concern === "deployment" && /cloudflare|wrangler|worker/.test(text)) {
    const environments = ["local", "staging", "production", "preview"]
      .filter((environment) => text.includes(environment));
    if (environments.includes("staging") && environments.includes("production")) {
      return `Deployment evidence includes ${environments.join(", ")} environment signals.`;
    }
    return "Deployment evidence points to configured hosted runtime services.";
  }
  if (rule.concern === "package_boundary" && text.includes("rust")) {
    return "A frontend surface and a native, WASM, or compiled runtime boundary are both visible.";
  }
  if (rule.concern === "package_boundary" && text.includes("package.swift")) {
    return "Application package boundaries are visible.";
  }
  return rule.claim;
}

function hasConcreteAuthorizationEvidence(nodes: ArchitectureEvidenceNode[]): boolean {
  const text = nodes.flatMap((node) => node.citations).join(" ").toLowerCase();
  const hasAuthzShape = /(membership|member|role|rbac|permission|user[-_ ]?projects?|admin|resource)/.test(text);
  const hasImplementationAnchor = /(\.test\.|tests?\/|migrations?\/|\.sql|src\/|workers\/|apps\/)/.test(text);
  return hasAuthzShape && hasImplementationAnchor;
}

function claimHasMinimumSupport(rule: ClaimRule, nodes: ArchitectureEvidenceNode[]): boolean {
  if (rule.concern === "authorization") {
    return hasConcreteAuthorizationEvidence(nodes);
  }
  return true;
}

function hasConcreteAuthenticationEvidence(nodes: ArchitectureEvidenceNode[]): boolean {
  const text = nodeText(nodes);
  const hasProvider = /(github|oauth|external_provider)/.test(text);
  const hasSession = /(session|cookie|session_kv)/.test(text);
  const hasImplementationAnchor = /(\.test\.|tests?\/|src\/|workers\/|apps\/|\.env|wrangler)/.test(text);
  return hasProvider && hasSession && hasImplementationAnchor;
}

function hasConcreteDeploymentEvidence(nodes: ArchitectureEvidenceNode[]): boolean {
  const text = nodeText(nodes);
  const hasRuntime = /(cloudflare|wrangler|worker)/.test(text);
  const hasEnvironment = /(staging|production|preview|local)/.test(text);
  const hasNonCodeAnchor = /(wrangler\.toml|\.github\/workflows|scripts\/deploy|docs\/self-hosting|docs\/ops|readme\.md)/.test(text);
  return hasRuntime && hasEnvironment && hasNonCodeAnchor;
}

function nodeText(nodes: ArchitectureEvidenceNode[]): string {
  return nodes.flatMap((node) => [
    node.summary,
    node.label,
    ...node.citations,
    ...(node.provenance ?? []).flatMap((item) => [item.path, item.excerpt, item.symbol].filter(Boolean) as string[]),
  ]).join(" ").toLowerCase();
}

function concernFromText(text: string): ArchitectureConcern | undefined {
  const normalized = text.toLowerCase();
  if (/(auth|oauth|login|session|api[-_ ]?key|token)/.test(normalized)) {
    return "authentication";
  }
  if (hasAuthorizationEvidenceText(normalized)) {
    return "authorization";
  }
  if (/(migration|database|sqlite|postgres|d1|kv|storage)/.test(normalized)) {
    return "data_storage";
  }
  if (/(deploy|worker|cloudflare|wrangler|production|appcast|notari|signing)/.test(normalized)) {
    return "deployment";
  }
  if (/(package|workspace|runtime boundary|rust\/wasm|package\.swift|crates\/)/.test(normalized)) {
    return "package_boundary";
  }
  if (/(test|spec|e2e|harness)/.test(normalized)) {
    return "testing";
  }
  if (/(health|metric|logging|analytics|observability)/.test(normalized)) {
    return "observability";
  }
  return undefined;
}

function familyFromText(text: string): ClaimEvidenceFamily {
  const normalized = text.toLowerCase();
  if (/(\/auth\/|login|signin)/.test(normalized)) return "route";
  if (/(oauth|github)/.test(normalized)) return "external_provider";
  if (/session/.test(normalized)) return "session";
  if (/(api[-_ ]?key|token)/.test(normalized)) return "credential";
  if (hasAuthorizationEvidenceText(normalized)) return "authorization";
  if (/(migration|\.sql|schema)/.test(normalized)) return "schema";
  if (/(kv|d1|binding|wrangler)/.test(normalized)) return "binding";
  if (/(worker|deploy|appcast|notari|signing)/.test(normalized)) return "deployment_config";
  if (/(package|workspace|apps\/|packages\/|workers\/|package\.swift)/.test(normalized)) return "package_boundary";
  if (/(rust|wasm|native)/.test(normalized)) return "runtime_boundary";
  if (/(test|spec|e2e)/.test(normalized)) return "test_surface";
  if (/(health|metric|logging|analytics)/.test(normalized)) return "observability";
  return "unknown";
}

function normalizeConcern(value: string): ArchitectureConcern {
  const allowed: ArchitectureConcern[] = [
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
  ];
  return allowed.includes(value as ArchitectureConcern)
    ? value as ArchitectureConcern
    : "unknown";
}

function hasAuthorizationEvidenceText(text: string): boolean {
  if (/(authorization|membership|permission|rbac|access[-_ ]?control)/.test(text)) {
    return true;
  }
  return /\broles?\b/.test(text)
    && /(auth|login|session|oauth|users?|admin|tenant|project|resource|account|access)/.test(text);
}

function normalizeFamily(value: string): ClaimEvidenceFamily {
  const allowed: ClaimEvidenceFamily[] = [
    "route",
    "external_provider",
    "session",
    "credential",
    "authorization",
    "schema",
    "binding",
    "deployment_config",
    "package_boundary",
    "runtime_boundary",
    "test_surface",
    "observability",
    "unknown",
  ];
  return allowed.includes(value as ClaimEvidenceFamily)
    ? value as ClaimEvidenceFamily
    : "unknown";
}

function normalizeConfidence(value: string): BaselineConfidence {
  return value === "high" || value === "medium" ? value : "low";
}

function normalizeFreshness(value: string): BaselineFreshness {
  return value === "current" || value === "stale" ? value : "unknown";
}

function flattenSignals(telemetry: ArchitecturalTelemetryBundle): SignalLike[] {
  return [
    ...telemetry.repository,
    ...telemetry.change,
    ...telemetry.test,
    ...telemetry.memory,
    ...telemetry.runtime,
  ] as SignalLike[];
}

function factsFromSignal(signal: SignalLike): ArchitectureEvidenceFact[] {
  const detailsFacts = isRecord(signal.payload.details) && Array.isArray(signal.payload.details.facts)
    ? signal.payload.details.facts
    : [];
  return detailsFacts.filter(isArchitectureFact);
}

function isArchitectureFact(value: unknown): value is ArchitectureEvidenceFact {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.label === "string"
    && typeof value.summary === "string"
    && typeof value.source === "string"
    && typeof value.kind === "string"
    && typeof value.concern === "string"
    && typeof value.family === "string"
    && Array.isArray(value.provenance);
}

function citationsForFact(fact: ArchitectureEvidenceFact): string[] {
  const citations = fact.provenance.flatMap((item) => [
    item.path,
    item.line !== undefined && item.path ? `${item.path}:${item.line}` : undefined,
    item.excerpt,
  ]).filter((item): item is string => Boolean(item));
  return citations.length > 0 ? citations : [fact.summary];
}

function dedupeFacts(facts: ArchitectureEvidenceFact[]): ArchitectureEvidenceFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.id}:${fact.provenance.map((item) => `${item.path}:${item.line ?? ""}`).join("|")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeNodes(nodes: ArchitectureEvidenceNode[]): ArchitectureEvidenceNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = `${node.concern}:${node.family}:${node.citations.join("|")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeClaims(claims: ArchitectureClaim[]): ArchitectureClaim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = `${claim.concern}:${claim.subject}:${claim.claim}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function stableId(...parts: string[]): string {
  return parts.join(":")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/-+/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
