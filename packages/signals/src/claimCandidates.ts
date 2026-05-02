import type { ArchitectureConcern, BaselineConfidence } from "../../kernel/src/baselineTypes.js";
import type {
  ArchitectureEvidenceFact,
  ArchitectureFactKind,
  ClaimEvidenceFamily,
} from "../../kernel/src/claimTypes.js";
import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

type CandidateRule = {
  family: ClaimEvidenceFamily;
  concern: ArchitectureConcern;
  label: string;
  patterns: RegExp[];
  factKind?: ArchitectureFactKind;
  factLabel?: string;
  factSummary?: string;
};

const generatedPathPatterns = [
  /^\.ceetrix\//,
  /^\.claude\//,
  /^\.agents\//,
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /(^|\/)\.build\//,
  /^coverage\//,
  /^test-results\//,
  /^playwright-report\//,
  /^\.next\//,
  /^\.turbo\//,
  /^\.cache\//,
  /(^|\/)chrome_profile\//,
  /(^|\/)Code Cache\//,
  /(^|\/)CacheStorage\//,
  /(^|\/)GPUCache\//,
  /(^|\/)Service Worker\//,
  /^target\//,
];

const candidateRules: CandidateRule[] = [
  {
    family: "route",
    concern: "authentication",
    label: "authentication route",
    patterns: [/\/auth\//i, /(^|\/)(login|signin|sign-in)\.[cm]?[jt]sx?$/i],
  },
  {
    family: "external_provider",
    concern: "authentication",
    label: "external identity provider",
    patterns: [/oauth/i, /github.*auth/i, /auth.*github/i, /github-(urls|jwt|access)/i],
    factKind: "auth.github_oauth",
    factLabel: "GitHub OAuth code path",
    factSummary: "Repository path indicates GitHub OAuth authentication code.",
  },
  {
    family: "session",
    concern: "authentication",
    label: "server-side session",
    patterns: [/sessions?\.[cm]?[jt]s$/i, /SESSION_KV/i, /(^|[-_/])sessions?[-_.]/i],
    factKind: "auth.session",
    factLabel: "server-side session code path",
    factSummary: "Repository path indicates server-side session handling.",
  },
  {
    family: "credential",
    concern: "authentication",
    label: "API key or token authentication",
    patterns: [/api[-_]?keys?/i, /tokens?/i, /credentials?/i, /bearer/i],
    factKind: "auth.credential",
    factLabel: "programmatic credential code path",
    factSummary: "Repository path indicates programmatic credential handling.",
  },
  {
    family: "session",
    concern: "authentication",
    label: "MCP session binding",
    patterns: [/mcp\/session\.[cm]?[jt]s$/i, /mcp.*session/i],
    factKind: "auth.session",
    factLabel: "MCP session code path",
    factSummary: "Repository path indicates MCP session handling.",
  },
  {
    family: "authorization",
    concern: "authorization",
    label: "role or membership boundary",
    patterns: [/membership/i, /permissions?/i, /roles?/i, /rbac/i, /access[-_]?control/i],
    factKind: "authz.membership_role",
    factLabel: "membership or role authorization code path",
    factSummary: "Repository path indicates membership, role, or permission authorization.",
  },
  {
    family: "schema",
    concern: "data_storage",
    label: "relational schema or migration",
    patterns: [/migrations\/.+\.sql$/i, /\.sql$/i, /schema/i],
    factKind: "storage.schema",
    factLabel: "relational schema or migration",
    factSummary: "Repository path indicates relational schema or migration storage.",
  },
  {
    family: "binding",
    concern: "data_storage",
    label: "database or KV binding",
    patterns: [/wrangler\.toml$/i, /d1/i, /SESSION_KV/i, /AUTH_KV/i, /KV/i],
  },
  {
    family: "deployment_config",
    concern: "deployment",
    label: "Cloudflare deployment",
    patterns: [/wrangler\.toml(\.example)?$/i, /\.github\/workflows\//i, /(^|\/)scripts\/deploy[^/]*\.(sh|ts|js)$/i],
  },
  {
    family: "package_boundary",
    concern: "package_boundary",
    label: "package or workspace boundary",
    patterns: [/^apps\//i, /^packages\//i, /^workers\//i, /Package\.swift$/i, /^crates\/[^/]+\/Cargo\.toml$/i],
    factKind: "package.workspace",
    factLabel: "package or workspace boundary",
    factSummary: "Repository path indicates a package or workspace boundary.",
  },
  {
    family: "runtime_boundary",
    concern: "package_boundary",
    label: "React to Rust or native runtime boundary",
    patterns: [/^src\/.+\.tsx$/i, /^crates\/[^/]+\/src\/.+\.rs$/i, /wasm/i],
    factKind: "runtime.boundary",
    factLabel: "runtime boundary",
    factSummary: "Repository path indicates a runtime boundary.",
  },
  {
    family: "test_surface",
    concern: "testing",
    label: "test surface",
    patterns: [/\/(__tests__|tests?|e2e)\//i, /\.(test|spec)\.[cm]?[jt]sx?$/i, /_test\.swift$/i],
    factKind: "test.surface",
    factLabel: "test surface",
    factSummary: "Repository path indicates a test surface.",
  },
  {
    family: "deployment_config",
    concern: "deployment",
    label: "macOS release or signing deployment",
    patterns: [/appcast\.xml$/i, /notari[sz]ation/i, /signing/i, /\.entitlements$/i],
  },
  {
    family: "observability",
    concern: "observability",
    label: "runtime feedback or operational signal",
    patterns: [/health/i, /analytics/i, /logging?/i, /metrics?/i, /notifications?/i],
    factKind: "observability.signal",
    factLabel: "runtime feedback or operational signal",
    factSummary: "Repository path indicates runtime feedback or operational signal handling.",
  },
];

export const claimCandidateProvider: OptionalSignalProvider = {
  name: "claim-candidates",
  collect(context: SignalContext): OptionalSignalResult {
    const files = Array.from(new Set(context.knownFiles ?? context.changedFiles))
      .filter((file) => !isGeneratedPath(file));
    const evidence = collectEvidence(files);
    const facts = collectFacts(files);

    if (evidence.length === 0) {
      return {
        source: "claim-candidates",
        status: "absent",
        category: "architecture_claim",
        freshness: context.knownFiles ? "current" : "unknown",
        confidence: "low",
        evidence: [],
        error: "no claim candidate evidence found",
      };
    }

    return {
      source: "claim-candidates",
      status: "present",
      category: "architecture_claim",
      freshness: "current",
      confidence: evidence.length >= 4 ? "high" : "medium",
      evidence,
      facts,
    };
  },
};

function collectEvidence(files: string[]): string[] {
  const evidence: string[] = [];
  for (const rule of candidateRules) {
    const matches = files
      .filter((file) => rule.patterns.some((pattern) => pattern.test(file)))
      .sort(compareEvidencePaths)
      .slice(0, 8);
    if (matches.length === 0) {
      continue;
    }
    evidence.push(
      `${rule.concern}.${rule.family}: ${rule.label}: ${matches.join(", ")}`,
    );
  }
  return evidence;
}

function collectFacts(files: string[]): ArchitectureEvidenceFact[] {
  const facts: ArchitectureEvidenceFact[] = [];
  for (const rule of candidateRules) {
    if (!rule.factKind) {
      continue;
    }
    const matches = files
      .filter((file) => rule.patterns.some((pattern) => pattern.test(file)))
      .sort(compareEvidencePaths)
      .slice(0, 12);
    for (const path of matches) {
      facts.push({
        id: stableFactId(rule.factKind, path),
        concern: rule.concern,
        family: rule.family,
        kind: rule.factKind,
        label: rule.factLabel ?? rule.label,
        summary: `${rule.factSummary ?? rule.label} ${path}`,
        source: "claim-candidates",
        confidence: confidenceForPath(path),
        freshness: "current",
        provenance: [{ path }],
      });
    }
  }
  return dedupeFacts(facts);
}

function compareEvidencePaths(left: string, right: string): number {
  return pathRank(left) - pathRank(right) || left.localeCompare(right);
}

function pathRank(path: string): number {
  let rank = 0;
  if (/\/src\//.test(path)) rank -= 40;
  if (/\/Sources\//.test(path)) rank -= 40;
  if (/(auth|oauth|login|signin|session|credential|token|membership|permission|role|rbac|deploy|wrangler|package\.swift|cargo\.toml)/i.test(path)) {
    rank -= 30;
  }
  if (/\/tests?\//.test(path) || /\.(test|spec)\./.test(path)) rank += 20;
  if (/^docs\//.test(path)) rank += 30;
  if (/^pocs\//.test(path)) rank += 35;
  if (/archive|reports|research/.test(path)) rank += 15;
  return rank;
}

function isGeneratedPath(file: string): boolean {
  return generatedPathPatterns.some((pattern) => pattern.test(file));
}

function confidenceForPath(path: string): BaselineConfidence {
  if (/(\.test\.|\/tests?\/|\/e2e\/)/.test(path)) {
    return "medium";
  }
  if (/^docs\//.test(path) || /^pocs\//.test(path)) {
    return "low";
  }
  return "high";
}

function dedupeFacts(facts: ArchitectureEvidenceFact[]): ArchitectureEvidenceFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    if (seen.has(fact.id)) {
      return false;
    }
    seen.add(fact.id);
    return true;
  });
}

function stableFactId(kind: string, path: string): string {
  return `${kind}:${path}`.replace(/[^a-zA-Z0-9:_./-]+/g, "-");
}
