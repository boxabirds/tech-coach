import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchitectureConcern, BaselineConfidence } from "../../kernel/src/baselineTypes.js";
import type { ArchitectureEvidenceFact, ArchitectureFactKind, ClaimEvidenceFamily } from "../../kernel/src/claimTypes.js";
import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

const configNamePattern = /(^|\/)(package\.json|bun\.lock|tsconfig\.json|vite\.config\.[jt]s|next\.config\.[jt]s|wrangler\.toml(\.example)?|dockerfile|docker-compose\.ya?ml|\.github\/workflows\/.+\.ya?ml|\.env(\..*)?|terraform\/|infra\/|scripts\/deploy[^/]*\.(sh|ts|js))/i;
const maxReadBytes = 80_000;

export const configBoundaryProvider: OptionalSignalProvider = {
  name: "config-boundary",
  collect(context: SignalContext): OptionalSignalResult {
    const files = Array.from(new Set([...(context.knownFiles ?? []), ...context.changedFiles]));
    const configFiles = files.filter((file) => configNamePattern.test(file));
    const facts = configFiles.flatMap((file) => factsForConfigFile(context.cwd, file));
    if (configFiles.length === 0) {
      return {
        source: "config-boundary",
        status: "absent",
        category: "configuration_boundary",
        freshness: context.knownFiles ? "current" : "unknown",
        confidence: "low",
        evidence: [],
        error: "no configuration or deployment boundary files observed",
      };
    }

    return {
      source: "config-boundary",
      status: "present",
      category: "configuration_boundary",
      freshness: "current",
      confidence: facts.length >= 3 ? "high" : "medium",
      evidence: [
        `configuration files observed: ${configFiles.length}`,
        ...facts.map(formatFactEvidence).slice(0, 40),
        ...configFiles.slice(0, 12).map((file) => `configuration file: ${file}`),
      ],
      details: { configFiles },
      facts,
    };
  },
};

function factsForConfigFile(cwd: string, path: string): ArchitectureEvidenceFact[] {
  const content = readBounded(join(cwd, path));
  if (content === undefined) {
    return [];
  }
  const lowerPath = path.toLowerCase();
  if (/(^|\/)wrangler\.toml(\.example)?$/i.test(path)) {
    return wranglerFacts(path, content);
  }
  if (lowerPath.endsWith("package.json")) {
    return packageFacts(path, content);
  }
  if (/\.github\/workflows\/.+\.ya?ml$/i.test(path)) {
    return workflowFacts(path, content);
  }
  if (/(^|\/)scripts\/deploy[^/]*\.(sh|ts|js)$/i.test(path)) {
    return deployScriptFacts(path, content);
  }
  if (/(^|\/)\.env(\..*)?$/i.test(path)) {
    return envFacts(path, content);
  }
  return [];
}

function wranglerFacts(path: string, content: string): ArchitectureEvidenceFact[] {
  const facts: ArchitectureEvidenceFact[] = [];
  const workerName = firstMatch(content, /^\s*name\s*=\s*["']([^"']+)["']/m);
  facts.push(fact({
    id: "deployment.runtime.cloudflare-worker",
    concern: "deployment",
    family: "deployment_config",
    kind: "deployment.runtime",
    label: "Cloudflare Workers runtime",
    summary: `Cloudflare Workers runtime is configured${workerName ? ` for ${workerName}` : ""}.`,
    path,
    excerpt: excerptFor(content, /name\s*=|main\s*=|compatibility_date\s*=/i),
    confidence: "high",
  }));

  for (const env of Array.from(content.matchAll(/^\s*\[env\.([^\]]+)\]/gm)).map((match) => match[1])) {
    facts.push(fact({
      id: `deployment.environment.${env}`,
      concern: "deployment",
      family: "deployment_config",
      kind: "deployment.environment",
      label: `Cloudflare ${env} environment`,
      summary: `Cloudflare Workers has a configured ${env} environment.`,
      path,
      excerpt: `[env.${env}]`,
      confidence: "high",
      metadata: { environment: env },
    }));
  }

  for (const section of tomlArraySections(content)) {
    if (/d1_databases/i.test(section.header)) {
      const binding = firstMatch(section.body, /^\s*binding\s*=\s*["']([^"']+)["']/m) ?? "DB";
      facts.push(fact({
        id: `binding.d1.${binding}`,
        concern: "data_storage",
        family: "binding",
        kind: "binding.d1",
        label: `D1 binding ${binding}`,
        summary: `Cloudflare D1 binding ${binding} is configured.`,
        path,
        excerpt: `${section.header} ${binding}`,
        confidence: "high",
        metadata: { binding },
      }));
    }
    if (/kv_namespaces/i.test(section.header)) {
      const binding = firstMatch(section.body, /^\s*binding\s*=\s*["']([^"']+)["']/m) ?? "KV";
      facts.push(fact({
        id: `binding.kv.${binding}`,
        concern: binding.toLowerCase().includes("session") ? "authentication" : "data_storage",
        family: binding.toLowerCase().includes("session") ? "session" : "binding",
        kind: "binding.kv",
        label: `KV binding ${binding}`,
        summary: `Cloudflare KV binding ${binding} is configured.`,
        path,
        excerpt: `${section.header} ${binding}`,
        confidence: "high",
        metadata: { binding },
      }));
    }
    if (/durable_objects/i.test(section.header)) {
      const binding = firstMatch(section.body, /^\s*name\s*=\s*["']([^"']+)["']/m) ?? "durable object";
      facts.push(fact({
        id: `binding.durable-object.${binding}`,
        concern: "data_storage",
        family: "binding",
        kind: "binding.durable_object",
        label: `Durable Object ${binding}`,
        summary: `Cloudflare Durable Object binding ${binding} is configured.`,
        path,
        excerpt: `${section.header} ${binding}`,
        confidence: "high",
        metadata: { binding },
      }));
    }
  }
  return facts;
}

function packageFacts(path: string, content: string): ArchitectureEvidenceFact[] {
  try {
    const pkg = JSON.parse(content) as { workspaces?: unknown; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const facts: ArchitectureEvidenceFact[] = [];
    if (pkg.workspaces || Array.isArray((pkg as { workspace?: unknown }).workspace)) {
      facts.push(fact({
        id: "package.workspace.package-json",
        concern: "package_boundary",
        family: "package_boundary",
        kind: "package.workspace",
        label: "package workspace",
        summary: "package.json declares workspace boundaries.",
        path,
        excerpt: "workspaces",
        confidence: "high",
      }));
    }
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (/deploy|release|publish/i.test(name) || /wrangler|cloudflare|deploy/i.test(command)) {
        facts.push(fact({
          id: `deployment.script.package.${name}`,
          concern: "deployment",
          family: "deployment_config",
          kind: "deployment.script",
          label: `package script ${name}`,
          summary: `package.json script ${name} runs deployment or release command.`,
          path,
          excerpt: `${name}: ${command}`.slice(0, 220),
          confidence: "medium",
          metadata: { script: name },
        }));
      }
      if (/test/i.test(name)) {
        facts.push(fact({
          id: `test.surface.package.${name}`,
          concern: "testing",
          family: "test_surface",
          kind: "test.surface",
          label: `package test script ${name}`,
          summary: `package.json script ${name} defines a test surface.`,
          path,
          excerpt: `${name}: ${command}`.slice(0, 220),
          confidence: "medium",
          metadata: { script: name },
        }));
      }
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if ("wrangler" in deps || "@cloudflare/workers-types" in deps) {
      facts.push(fact({
        id: "deployment.runtime.cloudflare-package",
        concern: "deployment",
        family: "deployment_config",
        kind: "deployment.runtime",
        label: "Cloudflare package dependency",
        summary: "package dependencies indicate Cloudflare Worker tooling.",
        path,
        excerpt: "wrangler",
        confidence: "medium",
      }));
    }
    return facts;
  } catch {
    return [];
  }
}

function workflowFacts(path: string, content: string): ArchitectureEvidenceFact[] {
  if (!/deploy|release|wrangler|cloudflare|pages|production|staging/i.test(content)) {
    return [];
  }
  return [fact({
    id: `deployment.workflow.${path}`,
    concern: "deployment",
    family: "deployment_config",
    kind: "deployment.script",
    label: "deployment workflow",
    summary: "GitHub Actions workflow contains deployment or release steps.",
    path,
    excerpt: excerptFor(content, /deploy|release|wrangler|cloudflare|production|staging/i),
    confidence: "medium",
  })];
}

function deployScriptFacts(path: string, content: string): ArchitectureEvidenceFact[] {
  const facts: ArchitectureEvidenceFact[] = [fact({
    id: `deployment.script.${path}`,
    concern: "deployment",
    family: "deployment_config",
    kind: "deployment.script",
    label: "deployment script",
    summary: `Deployment script is present at ${path}.`,
    path,
    excerpt: excerptFor(content, /wrangler|cloudflare|deploy|production|staging/i),
    confidence: /production|staging|wrangler|cloudflare/i.test(content) ? "high" : "medium",
  })];
  for (const env of ["production", "staging", "preview"]) {
    if (new RegExp(env, "i").test(content)) {
      facts.push(fact({
        id: `deployment.environment.${env}.script`,
        concern: "deployment",
        family: "deployment_config",
        kind: "deployment.environment",
        label: `${env} deployment script environment`,
        summary: `Deployment script references ${env} environment.`,
        path,
        excerpt: excerptFor(content, new RegExp(env, "i")),
        confidence: "medium",
        metadata: { environment: env },
      }));
    }
  }
  return facts;
}

function envFacts(path: string, content: string): ArchitectureEvidenceFact[] {
  const facts: ArchitectureEvidenceFact[] = [];
  if (/GITHUB_(CLIENT|APP|OAUTH)|OAUTH/i.test(content)) {
    facts.push(fact({
      id: "auth.github-oauth.env",
      concern: "authentication",
      family: "external_provider",
      kind: "auth.github_oauth",
      label: "GitHub OAuth environment",
      summary: "Environment example references GitHub OAuth credentials.",
      path,
      excerpt: excerptFor(content, /GITHUB_|OAUTH/i),
      confidence: "medium",
    }));
  }
  if (/SESSION|COOKIE/i.test(content)) {
    facts.push(fact({
      id: "auth.session.env",
      concern: "authentication",
      family: "session",
      kind: "auth.session",
      label: "session environment",
      summary: "Environment example references session or cookie state.",
      path,
      excerpt: excerptFor(content, /SESSION|COOKIE/i),
      confidence: "medium",
    }));
  }
  return facts;
}

function tomlArraySections(content: string): Array<{ header: string; body: string }> {
  const sections: Array<{ header: string; body: string }> = [];
  const matches = Array.from(content.matchAll(/^\s*(\[\[[^\]]+\]\])\s*$/gm));
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]!;
    const next = matches[index + 1];
    sections.push({
      header: current[1],
      body: content.slice(current.index! + current[0].length, next?.index ?? content.length),
    });
  }
  return sections;
}

function fact(input: {
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
  return {
    id: stableId(input.id),
    concern: input.concern,
    family: input.family,
    kind: input.kind,
    label: input.label,
    summary: input.summary,
    source: "config-boundary",
    confidence: input.confidence,
    freshness: "current",
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
  const raw = readFileSync(path);
  return raw.subarray(0, maxReadBytes).toString("utf8");
}

function firstMatch(content: string, pattern: RegExp): string | undefined {
  return pattern.exec(content)?.[1];
}

function excerptFor(content: string, pattern: RegExp): string | undefined {
  const line = content.split(/\r?\n/).find((candidate) => pattern.test(candidate));
  return line?.trim().slice(0, 220);
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_./-]+/g, "-").replace(/-+/g, "-");
}
