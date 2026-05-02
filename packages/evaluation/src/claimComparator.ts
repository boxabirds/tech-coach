import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ArchitectureClaim } from "../../kernel/src/claimTypes.js";
import type { ArchitectureConcern, BaselineQuestion } from "../../kernel/src/baselineTypes.js";

export type RequiredClaimExpectation = {
  concern: ArchitectureConcern;
  claimContains: string[];
  evidenceContains?: string[];
};

export type RequiredFactExpectation = {
  concern?: ArchitectureConcern;
  kindContains?: string;
  labelContains?: string;
  summaryContains?: string;
  provenanceContains?: string;
};

export type BrownfieldClaimBaseline = {
  name: string;
  path: string;
  requiredClaims: RequiredClaimExpectation[];
  requiredResidualQuestions?: string[];
  requiredFacts?: RequiredFactExpectation[];
  forbiddenQuestions?: string[];
  forbiddenEvidence?: string[];
};

export type BrownfieldClaimBaselineFile = {
  repositories: BrownfieldClaimBaseline[];
};

export type BrownfieldClaimArtifacts = {
  claims: ArchitectureClaim[];
  questions: BaselineQuestion[];
  evidenceText: string[];
  facts?: unknown[];
};

export type ClaimComparisonFailure = {
  category:
    | "missing_claim"
    | "missing_evidence"
    | "missing_fact"
    | "missing_question"
    | "forbidden_question"
    | "forbidden_evidence"
    | "artifact_missing";
  message: string;
};

export type ClaimComparisonResult = {
  repository: string;
  passed: boolean;
  failures: ClaimComparisonFailure[];
};

export function loadManualBaselines(path: string): BrownfieldClaimBaseline[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as BrownfieldClaimBaselineFile;
  if (!Array.isArray(raw.repositories)) {
    throw new Error(`Manual baseline file must contain repositories[]: ${path}`);
  }
  const baseDir = dirname(path);
  return raw.repositories.map((baseline) => ({
    ...baseline,
    path: isAbsolute(baseline.path) ? baseline.path : resolve(baseDir, baseline.path),
  }));
}

export function loadArtifacts(repoRoot: string): BrownfieldClaimArtifacts {
  const root = join(repoRoot, ".ceetrix", "tech-lead");
  const latestPath = join(root, "latest-assessment.json");
  const questionsPath = join(root, "questions.json");
  const evidencePath = join(root, "evidence.json");
  for (const path of [latestPath, questionsPath, evidencePath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing assessment artifact: ${path}`);
    }
  }

  const latest = JSON.parse(readFileSync(latestPath, "utf8")) as {
    run?: { assessment?: { claims?: ArchitectureClaim[] } };
    openQuestions?: BaselineQuestion[];
  };
  const questions = JSON.parse(readFileSync(questionsPath, "utf8")) as {
    open?: BaselineQuestion[];
  };
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as unknown;
  return {
    claims: latest.run?.assessment?.claims ?? [],
    questions: questions.open ?? latest.openQuestions ?? [],
    evidenceText: flattenStrings(evidence),
    facts: readFacts(evidence),
  };
}

export function compareClaims(
  baseline: BrownfieldClaimBaseline,
  artifacts: BrownfieldClaimArtifacts,
): ClaimComparisonResult {
  const failures: ClaimComparisonFailure[] = [];

  for (const required of baseline.requiredClaims) {
    const claim = artifacts.claims.find((candidate) =>
      candidate.concern === required.concern
      && containsAll(candidate.claim, required.claimContains)
    );
    if (!claim) {
      failures.push({
        category: "missing_claim",
        message: `${baseline.name}: missing ${required.concern} claim containing ${required.claimContains.join(", ")}`,
      });
      continue;
    }
    for (const evidenceNeedle of required.evidenceContains ?? []) {
      if (!containsAnyText([claim.evidence.join("\n"), ...artifacts.evidenceText], evidenceNeedle)) {
        failures.push({
          category: "missing_evidence",
          message: `${baseline.name}: ${required.concern} claim lacks evidence containing ${evidenceNeedle}`,
        });
      }
    }
  }

  for (const requiredQuestion of baseline.requiredResidualQuestions ?? []) {
    if (!containsAnyText(artifacts.questions.map((question) => question.prompt), requiredQuestion)) {
      failures.push({
        category: "missing_question",
        message: `${baseline.name}: missing residual question containing ${requiredQuestion}`,
      });
    }
  }

  for (const requiredFact of baseline.requiredFacts ?? []) {
    if (!(artifacts.facts ?? []).some((fact) => factMatches(fact, requiredFact))) {
      failures.push({
        category: "missing_fact",
        message: `${baseline.name}: missing normalized fact ${JSON.stringify(requiredFact)}`,
      });
    }
  }

  for (const forbidden of baseline.forbiddenQuestions ?? []) {
    if (containsAnyText(artifacts.questions.map((question) => question.prompt), forbidden)) {
      failures.push({
        category: "forbidden_question",
        message: `${baseline.name}: forbidden broad question returned: ${forbidden}`,
      });
    }
  }

  for (const forbidden of baseline.forbiddenEvidence ?? []) {
    const claimEvidence = artifacts.claims.flatMap((claim) => claim.evidence);
    if (containsAnyText([...claimEvidence, ...artifacts.evidenceText], forbidden)) {
      failures.push({
        category: "forbidden_evidence",
        message: `${baseline.name}: noisy evidence returned: ${forbidden}`,
      });
    }
  }

  return {
    repository: baseline.name,
    passed: failures.length === 0,
    failures,
  };
}

export function compareBaselineArtifacts(
  baselines: BrownfieldClaimBaseline[],
): ClaimComparisonResult[] {
  return baselines.map((baseline) => {
    try {
      return compareClaims(baseline, loadArtifacts(baseline.path));
    } catch (error) {
      return {
        repository: baseline.name,
        passed: false,
        failures: [{
          category: "artifact_missing",
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  });
}

function containsAll(value: string, needles: string[]): boolean {
  return needles.every((needle) => value.toLowerCase().includes(needle.toLowerCase()));
}

function containsAnyText(values: string[], needle: string): boolean {
  const normalized = needle.toLowerCase();
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStrings(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => flattenStrings(item));
  }
  return [];
}

function readFacts(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const facts = (value as { normalizedFacts?: unknown }).normalizedFacts;
  return Array.isArray(facts) ? facts : [];
}

function factMatches(fact: unknown, expectation: RequiredFactExpectation): boolean {
  if (!fact || typeof fact !== "object") {
    return false;
  }
  const record = fact as Record<string, unknown>;
  if (expectation.concern && record.concern !== expectation.concern) {
    return false;
  }
  const text = flattenStrings(fact).join("\n").toLowerCase();
  return [
    expectation.kindContains,
    expectation.labelContains,
    expectation.summaryContains,
    expectation.provenanceContains,
  ].filter((item): item is string => Boolean(item))
    .every((needle) => text.includes(needle.toLowerCase()));
}
