import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

type CandidateRule = {
  family: string;
  concern: string;
  label: string;
  patterns: RegExp[];
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
  },
  {
    family: "session",
    concern: "authentication",
    label: "server-side session",
    patterns: [/sessions?\.[cm]?[jt]s$/i, /SESSION_KV/i, /web-sessions/i],
  },
  {
    family: "credential",
    concern: "authentication",
    label: "API key or token authentication",
    patterns: [/api[-_]?keys?/i, /token-utils/i, /legacy-token/i],
  },
  {
    family: "session",
    concern: "authentication",
    label: "MCP session binding",
    patterns: [/mcp\/session\.[cm]?[jt]s$/i, /mcp.*session/i],
  },
  {
    family: "authorization",
    concern: "authorization",
    label: "role or membership boundary",
    patterns: [/membership/i, /permissions?/i, /roles?/i, /rbac/i, /user[-_]projects/i],
  },
  {
    family: "schema",
    concern: "data_storage",
    label: "relational schema or migration",
    patterns: [/migrations\/.+\.sql$/i, /\.sql$/i, /schema/i],
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
  },
  {
    family: "runtime_boundary",
    concern: "package_boundary",
    label: "React to Rust or native runtime boundary",
    patterns: [/^src\/.+\.tsx$/i, /^crates\/[^/]+\/src\/.+\.rs$/i, /wasm/i],
  },
  {
    family: "test_surface",
    concern: "testing",
    label: "test surface",
    patterns: [/\/(__tests__|tests?|e2e)\//i, /\.(test|spec)\.[cm]?[jt]sx?$/i, /_test\.swift$/i],
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
  },
];

export const claimCandidateProvider: OptionalSignalProvider = {
  name: "claim-candidates",
  collect(context: SignalContext): OptionalSignalResult {
    const files = Array.from(new Set(context.knownFiles ?? context.changedFiles))
      .filter((file) => !isGeneratedPath(file));
    const evidence = collectEvidence(files);

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

function compareEvidencePaths(left: string, right: string): number {
  return pathRank(left) - pathRank(right) || left.localeCompare(right);
}

function pathRank(path: string): number {
  let rank = 0;
  if (/\/src\//.test(path)) rank -= 40;
  if (/\/Sources\//.test(path)) rank -= 40;
  if (/web-oauth|web-sessions|SignIn|session\.ts|token-utils|membership|wrangler|Package\.swift|Cargo\.toml/.test(path)) {
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
