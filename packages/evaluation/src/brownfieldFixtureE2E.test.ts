import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { captureAssessment } from "../../persistence/src/capture.js";
import {
  compareClaims,
  loadArtifacts,
  loadManualBaselines,
} from "./claimComparator.js";
import { assertInlineAdviceResponse } from "./inlineAdviceAssertions.js";

const maybeIt = process.versions.bun ? it : it.skip;
const baselinePath = resolve(
  process.cwd(),
  "packages/evaluation/fixtures/brownfield-claims/manual-baselines.json",
);

describe("self-contained brownfield fixture baselines", () => {
  maybeIt("captures fixture repositories passively and compares them with manual baselines", () => {
    const baselines = loadManualBaselines(baselinePath);

    for (const baseline of baselines) {
      const repo = copyFixtureRepo(baseline.path);
      try {
        const capture = captureAssessment({
          cwd: repo,
          now: `2026-05-01T12:00:0${baselines.indexOf(baseline)}.000Z`,
        });

        expect(capture.assessment.interactionContext).toBe("passive_baseline");
        expect(capture.assessment.action).toBe("Continue");
        expect(capture.openQuestions).toEqual([]);

        const comparison = compareClaims(
          { ...baseline, path: repo },
          loadArtifacts(repo),
        );
        expect(comparison.failures).toEqual([]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    }
  });

  maybeIt("validates recommendation-first inline advice against fixture evidence areas", () => {
    const baseline = loadManualBaselines(baselinePath)
      .find((item) => item.name === "rich-auth-platform");
    expect(baseline).toBeDefined();
    const repo = copyFixtureRepo(baseline!.path);
    try {
      captureAssessment({
        cwd: repo,
        now: "2026-05-01T12:01:00.000Z",
      });
      const artifacts = loadArtifacts(repo);
      expect(artifacts.claims.map((claim) => claim.concern)).toEqual(
        expect.arrayContaining(["authentication", "authorization", "data_storage", "deployment"]),
      );

      const response = [
        "Using Tech Lead baseline context, the likely direction is a local runtime profile rather than a fork.",
        "The storage, deployment, auth, and package boundary evidence says to preserve the existing boundaries while replacing hosted dependencies with local equivalents.",
        "Start by proving story and task workflows through the same persistence and API contracts.",
        "Two questions could change the plan: fully offline, or only no hosted Ceetrix dependency? Single-user local, or on-prem multi-user?",
      ].join("\n\n");

      expect(assertInlineAdviceResponse({
        prompt: "how do I create a local-only version of Ceetrix?",
        response,
        expectedEvidenceAreas: ["storage", "deployment", "auth", "boundary"],
      })).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

function copyFixtureRepo(source: string): string {
  const target = mkdtempSync(join(tmpdir(), `archcoach-fixture-${basename(source)}-`));
  cpSync(source, target, { recursive: true });
  return target;
}
