import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchitectureConcern, BaselineConfidence } from "../../kernel/src/baselineTypes.js";
import type {
  ArchitectureEvidenceFact,
  ArchitectureFactKind,
  ClaimEvidenceFamily,
  EvidenceRole,
  EvidenceTimeframe,
} from "../../kernel/src/claimTypes.js";
import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

const maxDocFiles = 24;
const maxReadBytes = 48_000;

const docPathPattern = /(^README\.md$|^docs\/(self-hosting|ops|operations|runbooks?|deployment|staging|production|security|architecture|design|adr|decisions?)(\/|\.|$)|(^|\/)(runbook|deployment|staging|production|self-hosting|architecture|tech-architecture|technical-architecture)\.md$)/i;
const noisyDocPattern = /^docs\/(research|archive|reports|scratch|pocs)\//i;

export const documentationProvider: OptionalSignalProvider = {
  name: "documentation",
  collect(context: SignalContext): OptionalSignalResult {
    const files = Array.from(new Set(context.knownFiles ?? context.changedFiles))
      .filter((file) => docPathPattern.test(file) && !noisyDocPattern.test(file))
      .sort(compareDocumentPriority)
      .slice(0, maxDocFiles);
    const facts = files.flatMap((file) => factsForDocument(context.cwd, file));
    if (files.length === 0 || facts.length === 0) {
      return {
        source: "documentation",
        status: "absent",
        category: "architecture_claim",
        freshness: context.knownFiles ? "current" : "unknown",
        confidence: "low",
        evidence: [],
        error: "no bounded architecture, runbook, deployment, or security docs observed",
      };
    }
    return {
      source: "documentation",
      status: "present",
      category: "architecture_claim",
      freshness: "current",
      confidence: facts.length >= 4 ? "high" : "medium",
      evidence: facts.map(formatFactEvidence),
      details: {
        documentsRead: files,
        temporalEvidence: summarizeTemporalEvidence(facts),
        boundedBy: { maxDocFiles, maxReadBytes },
      },
      facts,
    };
  },
};

function factsForDocument(cwd: string, path: string): ArchitectureEvidenceFact[] {
  const content = readBounded(join(cwd, path));
  if (!content) {
    return [];
  }
  const facts: ArchitectureEvidenceFact[] = [];
  if (/cloudflare|wrangler|workers?|pages/i.test(content) && /deploy|host|environment|production|staging|self[- ]?host/i.test(content)) {
    facts.push(makeFact({
      id: `doc.deployment.cloudflare.${path}`,
      concern: "deployment",
      family: "deployment_config",
      kind: "doc.runbook",
      label: "Cloudflare deployment documentation",
      summary: "Bounded documentation describes Cloudflare deployment or hosting.",
      path,
      excerpt: excerptFor(content, /cloudflare|wrangler|workers?|production|staging|self[- ]?host/i),
      confidence: "high",
    }));
  }
  for (const env of ["local", "staging", "production"]) {
    if (new RegExp(`\\b${env}\\b`, "i").test(content) && /deploy|environment|wrangler|cloudflare|host/i.test(content)) {
      facts.push(makeFact({
        id: `doc.deployment.environment.${env}.${path}`,
        concern: "deployment",
        family: "deployment_config",
        kind: "deployment.environment",
        label: `${env} deployment documentation`,
        summary: `Bounded documentation describes ${env} deployment environment.`,
        path,
        excerpt: excerptFor(content, new RegExp(`\\b${env}\\b`, "i")),
        confidence: env === "production" ? "high" : "medium",
        metadata: { environment: env },
      }));
    }
  }
  if (/d1|sqlite|database|migration|schema/i.test(content)) {
    facts.push(makeFact({
      id: `doc.storage.${path}`,
      concern: "data_storage",
      family: /d1/i.test(content) ? "binding" : "schema",
      kind: /d1/i.test(content) ? "binding.d1" : "storage.schema",
      label: /d1/i.test(content) ? "D1 documentation" : "storage documentation",
      summary: "Bounded documentation describes persistent storage.",
      path,
      excerpt: excerptFor(content, /d1|sqlite|database|migration|schema/i),
      confidence: "medium",
    }));
  }
  if (isArchitectureDocument(path, content)) {
    facts.push(makeFact({
      id: `doc.architecture.${path}`,
      concern: "application_shape",
      family: "unknown",
      kind: "doc.architecture",
      label: "architecture documentation",
      summary: "Bounded documentation describes architecture, design basis, or system shape.",
      path,
      excerpt: excerptFor(content, /architecture|design|tech stack|mvp|pipeline|module|runtime|adr|decision/i),
      confidence: canonicalArchitectureDocument(path) ? "high" : "medium",
    }));
  }
  if (/github oauth|oauth|login|session|cookie/i.test(content)) {
    facts.push(makeFact({
      id: `doc.auth.${path}`,
      concern: "authentication",
      family: /session|cookie/i.test(content) ? "session" : "external_provider",
      kind: /github oauth/i.test(content) ? "auth.github_oauth" : "auth.session",
      label: "authentication documentation",
      summary: "Bounded documentation describes authentication or sessions.",
      path,
      excerpt: excerptFor(content, /github oauth|oauth|login|session|cookie/i),
      confidence: "medium",
    }));
  }
  if (hasAuthorizationDocumentation(content)) {
    facts.push(makeFact({
      id: `doc.authz.${path}`,
      concern: "authorization",
      family: "authorization",
      kind: "authz.membership_role",
      label: "authorization documentation",
      summary: "Bounded documentation describes role, membership, or permission boundaries.",
      path,
      excerpt: excerptFor(content, /authorization|membership|permission|rbac|access control|\broles?\b/i),
      confidence: "medium",
    }));
  }
  if (/test|vitest|playwright|e2e|integration/i.test(content)) {
    facts.push(makeFact({
      id: `doc.tests.${path}`,
      concern: "testing",
      family: "test_surface",
      kind: "test.surface",
      label: "testing documentation",
      summary: "Bounded documentation describes a test surface or test command.",
      path,
      excerpt: excerptFor(content, /test|vitest|playwright|e2e|integration/i),
      confidence: "medium",
    }));
  }
  return facts;
}

function makeFact(input: {
  id: string;
  concern: ArchitectureConcern;
  family: ClaimEvidenceFamily;
  kind: ArchitectureFactKind;
  label: string;
  summary: string;
  path: string;
  excerpt?: string;
  confidence: BaselineConfidence;
  metadata?: Record<string, unknown>;
}): ArchitectureEvidenceFact {
  const temporal = temporalForDocumentFact(input.path, input.kind);
  return {
    id: stableId(input.id),
    concern: input.concern,
    family: input.family,
    kind: input.kind,
    label: input.label,
    summary: input.summary,
    source: "documentation",
    confidence: input.confidence,
    freshness: "current",
    timeframe: temporal.timeframe,
    role: temporal.role,
    provenance: [{ path: input.path, ...(input.excerpt ? { excerpt: input.excerpt } : {}) }],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function formatFactEvidence(fact: ArchitectureEvidenceFact): string {
  const citations = fact.provenance.map((item) => item.path ?? item.excerpt).filter(Boolean).join(", ");
  return `${fact.concern}.${fact.family}: ${fact.label}: ${citations || fact.summary}`;
}

function readBounded(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path).subarray(0, maxReadBytes).toString("utf8");
}

function excerptFor(content: string, pattern: RegExp): string | undefined {
  const line = content.split(/\r?\n/).find((candidate) => pattern.test(candidate));
  return line?.trim().slice(0, 220);
}

function compareDocumentPriority(left: string, right: string): number {
  return documentPriority(right) - documentPriority(left) || left.localeCompare(right);
}

function documentPriority(path: string): number {
  if (canonicalArchitectureDocument(path)) return 100;
  if (/^docs\/design\//i.test(path)) return 80;
  if (/^docs\/architecture/i.test(path)) return 70;
  if (/^docs\/adr\//i.test(path)) return 50;
  if (/^README\.md$/i.test(path)) return 40;
  return 10;
}

function canonicalArchitectureDocument(path: string): boolean {
  return /(^|\/)(tech-architecture|technical-architecture|architecture)\.md$/i.test(path);
}

function isArchitectureDocument(path: string, content: string): boolean {
  return canonicalArchitectureDocument(path)
    || /^docs\/(design|architecture|adr|decisions?)(\/|\.|$)/i.test(path)
    || /architecture|technical design|tech stack|system shape|runtime boundary/i.test(content);
}

function hasAuthorizationDocumentation(content: string): boolean {
  if (/authorization|membership|permission|rbac|access control/i.test(content)) {
    return true;
  }
  const hasRoleLanguage = /\broles?\b/i.test(content);
  const hasAuthContext = /auth|login|session|oauth|users?|admin|tenant|project|resource|account/i.test(content);
  return hasRoleLanguage && hasAuthContext;
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_./-]+/g, "-").replace(/-+/g, "-");
}

function temporalForDocumentFact(
  path: string,
  kind: ArchitectureFactKind,
): { timeframe: EvidenceTimeframe; role: EvidenceRole } {
  if (kind === "doc.architecture" || /^docs\/(design|architecture)(\/|\.|$)/i.test(path)) {
    return { timeframe: "future", role: "architecture_basis" };
  }
  if (/^docs\/adr\//i.test(path)) {
    return { timeframe: "past", role: "decision_record" };
  }
  if (kind === "doc.runbook") {
    return { timeframe: "current", role: "repository_shape" };
  }
  if (kind === "test.surface") {
    return { timeframe: "current", role: "test_evidence" };
  }
  return { timeframe: "current", role: "repository_shape" };
}

function summarizeTemporalEvidence(
  facts: ArchitectureEvidenceFact[],
): Array<{ path?: string; timeframe: EvidenceTimeframe; role: EvidenceRole; summary: string }> {
  const seen = new Set<string>();
  return facts.flatMap((fact) =>
    fact.provenance.map((item) => ({
      path: item.path,
      timeframe: fact.timeframe ?? "uncertain",
      role: fact.role ?? "repository_shape",
      summary: fact.summary,
    }))
  ).filter((item) => {
    const key = `${item.path ?? ""}:${item.timeframe}:${item.role}:${item.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 12);
}
