import { describe, expect, it } from "vitest";
import { synthesizeArchitectureBaseline } from "./baseline.js";
import {
  assertValidTelemetryBundle,
  emptyTelemetryBundle,
  evidenceFromTelemetry,
  telemetryFromEvent,
  telemetryFromEvidence,
  validateTelemetryBundle,
} from "./telemetry.js";
import type {
  ArchitecturalTelemetryBundle,
  SignalEnvelope,
} from "./telemetryTypes.js";
import {
  absentAndFailedEvidence,
  mixedEvidence,
  telemetryEvent,
  weakEvidence,
} from "./__fixtures__/telemetry/scenarios.js";

describe("architectural telemetry", () => {
  it("converts existing event and evidence shapes into all signal families", () => {
    const bundle = telemetryFromEvidence({
      event: telemetryEvent,
      evidence: mixedEvidence,
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: "turn-1",
    });

    expect(validateTelemetryBundle(bundle)).toEqual({ valid: true, issues: [] });
    expect(bundle.lifecycle).toHaveLength(1);
    expect(bundle.repository.length).toBeGreaterThanOrEqual(2);
    expect(bundle.change.length).toBeGreaterThanOrEqual(2);
    expect(bundle.test.length).toBeGreaterThanOrEqual(2);
    expect(bundle.memory).toHaveLength(1);
    expect(bundle.runtime).toHaveLength(1);
    for (const family of [
      bundle.lifecycle,
      bundle.repository,
      bundle.change,
      bundle.test,
      bundle.memory,
      bundle.runtime,
    ]) {
      expect(family.every((signal) => signal.correlationId === "turn-1")).toBe(true);
    }
  });

  it("creates correlated lifecycle, change, test, and memory signals from an event", () => {
    const bundle = telemetryFromEvent(telemetryEvent, {
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: "turn-2",
    });

    expect(bundle.lifecycle[0]).toMatchObject({
      family: "lifecycle",
      source: "claude-code",
      scope: "session",
      confidence: "high",
      correlationId: "turn-2",
      payload: {
        event: "PostToolBatch",
        host: "claude-code",
      },
    });
    expect(bundle.change[0]).toMatchObject({
      family: "change",
      source: "event.changedFiles",
      correlationId: "turn-2",
    });
    expect(bundle.test[0]).toMatchObject({
      family: "test",
      source: "testSummary",
      correlationId: "turn-2",
    });
    expect(bundle.memory[0]).toMatchObject({
      family: "memory",
      source: "decision-localstorage-projects",
      correlationId: "turn-2",
    });
  });

  it("preserves absent and failed providers as diagnostics and low-confidence signals", () => {
    const bundle = telemetryFromEvidence({
      evidence: absentAndFailedEvidence,
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: "turn-3",
    });

    expect(bundle.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          family: "change",
          source: "lsp",
          severity: "info",
        }),
        expect.objectContaining({
          family: "runtime",
          source: "monitor",
          severity: "warning",
          message: "monitor failed: monitor unavailable",
        }),
      ]),
    );
    expect(bundle.change[0]).toMatchObject({
      status: "absent",
      confidence: "low",
    });
    expect(bundle.runtime[0]).toMatchObject({
      status: "failed",
      confidence: "low",
    });
  });

  it("keeps weak uncorrelated evidence low confidence", () => {
    const bundle = telemetryFromEvidence({
      evidence: weakEvidence,
      capturedAt: "2026-04-30T12:00:00.000Z",
    });

    expect(bundle.change[0]).toMatchObject({
      family: "change",
      confidence: "low",
      status: "present",
    });
    expect(evidenceFromTelemetry(bundle)[0]).toMatchObject({
      category: "symbol_reference",
      confidence: "low",
    });
  });

  it("validates malformed envelopes with actionable issues", () => {
    const bundle = emptyTelemetryBundle();
    bundle.lifecycle.push({
      id: "",
      family: "lifecycle",
      source: "",
      capturedAt: "",
      freshness: "fresh",
      confidence: "certain",
      scope: "global",
      status: "present",
      payload: {},
    } as unknown as SignalEnvelope<never>);

    const result = validateTelemetryBundle(bundle);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { field: "lifecycle[0].id", message: "must be a non-empty string" },
        { field: "lifecycle[0].source", message: "must be a non-empty string" },
        {
          field: "lifecycle[0].capturedAt",
          message: "must be a non-empty string",
        },
        {
          field: "lifecycle[0].freshness",
          message: "must be current, stale, or unknown",
        },
        {
          field: "lifecycle[0].confidence",
          message: "must be low, medium, or high",
        },
        {
          field: "lifecycle[0].scope",
          message: "must be session, repo, change, concern, or runtime",
        },
      ]),
    );
    expect(() => assertValidTelemetryBundle(bundle)).toThrow(/lifecycle/);
  });

  it("detects duplicate telemetry IDs across families", () => {
    const bundle = telemetryFromEvent(telemetryEvent, {
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: "turn-4",
    });
    bundle.change[0].id = bundle.lifecycle[0].id;

    expect(validateTelemetryBundle(bundle).issues).toContainEqual({
      field: bundle.lifecycle[0].id,
      message: "duplicate telemetry signal id",
    });
  });

  it("keeps story 13 baseline output stable when evidence is supplied as telemetry", () => {
    const telemetry = telemetryFromEvidence({
      event: telemetryEvent,
      evidence: mixedEvidence,
      capturedAt: "2026-04-30T12:00:00.000Z",
      correlationId: "turn-5",
    });

    const baseline = synthesizeArchitectureBaseline({
      event: telemetryEvent,
      telemetry,
    });

    expect(
      baseline.concerns.find((concern) => concern.concern === "data_storage"),
    ).toMatchObject({
      thresholdCandidates: expect.arrayContaining(["persistence", "revisit"]),
      currentState: "Revisit",
    });
    expect(
      baseline.concerns.find((concern) => concern.concern === "testing"),
    ).toBeDefined();
  });
});
