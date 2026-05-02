import type {
  ArchitectureConcern,
  AxisScore,
  BaselineConcernAssessment,
  BaselineConfidence,
  BaselineFact,
  ComplexityPressureAssessment,
  ComplexityPressureDriver,
  ComplexityPressureLevel,
  StructureAdequacyAssessment,
  StructureAdequacyStatus,
  StructuralSupportAssessment,
  StructuralSupportLevel,
  ThresholdCandidate,
} from "./baselineTypes.js";
import type { CoachAction } from "./protocol.js";

export type ComplexityAssessment = {
  pressure: ComplexityPressureAssessment;
  support: StructuralSupportAssessment;
  adequacy: StructureAdequacyAssessment;
};

export type ArchitectureDebtStatus =
  | "finding"
  | "accepted_debt"
  | "stale"
  | "reopened";

export type ArchitectureDebtAssessment = {
  id: string;
  concern: ArchitectureConcern;
  status: ArchitectureDebtStatus;
  adequacyStatus: StructureAdequacyStatus;
  pressure: ComplexityPressureLevel;
  support: StructuralSupportLevel;
  rationale: string;
  acceptedRisk?: string;
  revisitIf: string[];
  evidenceRefs: string[];
};

export function assessConcernComplexity(
  concern: BaselineConcernAssessment,
): ComplexityAssessment {
  const pressure = classifyComplexityPressure(concern);
  const support = classifyStructuralSupport(concern);
  const adequacy = compareStructureAdequacy(concern, pressure, support);
  return { pressure, support, adequacy };
}

export function classifyComplexityPressure(
  concern: BaselineConcernAssessment,
): ComplexityPressureAssessment {
  const drivers = pressureDriversFor(concern);
  const level = pressureLevelFor(concern, drivers);
  const evidenceRefs = evidenceRefsFor(concern.facts);
  const provisional = isProvisionalPressure(concern, drivers);
  const confidence = provisional ? minConfidence(concern.confidence, "low") : concern.confidence;
  return {
    concern: concern.concern,
    level,
    drivers,
    evidenceRefs,
    confidence,
    provisional,
    reason: pressureReason(concern.concern, level, drivers, provisional),
  };
}

export function classifyStructuralSupport(
  concern: BaselineConcernAssessment,
): StructuralSupportAssessment {
  if (concern.facts.length === 0) {
    return {
      concern: concern.concern,
      level: "unknown",
      supports: [],
      evidenceRefs: [],
      confidence: "low",
      reason: "No current evidence establishes structural support for this concern.",
    };
  }

  const text = factsText(concern.facts);
  const supports = supportSignalsFor(concern.concern, text);
  const level = supportLevelFor(concern.concern, text, supports);
  return {
    concern: concern.concern,
    level,
    supports,
    evidenceRefs: evidenceRefsFor(concern.facts),
    confidence: concern.confidence,
    reason: supportReason(concern.concern, level, supports),
  };
}

export function compareStructureAdequacy(
  concern: BaselineConcernAssessment,
  pressure: ComplexityPressureAssessment,
  support: StructuralSupportAssessment,
): StructureAdequacyAssessment {
  const pressureRank = pressureRankFor(pressure.level);
  const supportRank = supportRankFor(support.level);
  const status = adequacyStatusFor(pressure, support);
  const confidence = pressure.provisional || support.level === "unknown"
    ? "low"
    : minConfidence(pressure.confidence, support.confidence);

  return {
    concern: concern.concern,
    pressure: pressure.level,
    support: support.level,
    status,
    reason: adequacyReason(concern.concern, status, pressure, support, pressureRank, supportRank),
    nextAction: actionForAdequacy(concern.concern, status),
    evidenceRefs: Array.from(new Set([
      ...pressure.evidenceRefs,
      ...support.evidenceRefs,
    ])),
    confidence,
  };
}

export function debtAssessmentFor(input: {
  adequacy: StructureAdequacyAssessment;
  accepted?: boolean;
  rationale?: string;
  acceptedRisk?: string;
  revisitIf?: string[];
  stale?: boolean;
  status?: ArchitectureDebtStatus;
}): ArchitectureDebtAssessment {
  const accepted = input.accepted === true;
  const stale = input.stale === true;
  const status: ArchitectureDebtStatus = input.status ?? (stale
    ? "stale"
    : accepted
      ? input.adequacy.status === "under_structured"
        ? "accepted_debt"
        : "reopened"
      : "finding");
  return {
    id: `debt-${input.adequacy.concern}`,
    concern: input.adequacy.concern,
    status,
    adequacyStatus: input.adequacy.status,
    pressure: input.adequacy.pressure,
    support: input.adequacy.support,
    rationale: input.rationale ?? input.adequacy.reason,
    ...(input.acceptedRisk ? { acceptedRisk: input.acceptedRisk } : {}),
    revisitIf: input.revisitIf ?? revisitConditionsFor(input.adequacy),
    evidenceRefs: input.adequacy.evidenceRefs,
  };
}

export function coachActionForAdequacy(
  adequacy: StructureAdequacyAssessment,
): CoachAction {
  switch (adequacy.nextAction) {
    case "continue":
      return "Continue";
    case "localize":
      return "Localize";
    case "name":
      return "Name";
    case "extract":
      return "Extract";
    case "insert_boundary":
      return "Insert boundary";
    case "run_review":
      return "Run review";
    case "operationalize":
      return "Operationalize";
    case "stop_and_decide":
      return "Stop and decide";
    default:
      return "Record decision";
  }
}

function pressureDriversFor(
  concern: BaselineConcernAssessment,
): ComplexityPressureDriver[] {
  const drivers = new Set<ComplexityPressureDriver>();
  for (const threshold of concern.thresholdCandidates) {
    for (const driver of driversForThreshold(threshold)) {
      drivers.add(driver);
    }
  }

  const text = factsText(concern.facts);
  if (containsAny(text, ["shared state", "store", "state ownership"])) {
    drivers.add("shared_state");
  }
  if (containsAny(text, ["durable", "database", "sqlite", "postgres", "migration", "localstorage", "indexeddb"])) {
    drivers.add("durable_state");
  }
  if (containsAny(text, ["team", "share", "sharing", "multi-user", "collaboration", "sync"])) {
    drivers.add("collaboration");
  }
  if (containsAny(text, ["concurrent", "conflict", "many writers"])) {
    drivers.add("concurrency");
  }
  if (containsAny(text, ["external", "third-party", "webhook", "oauth provider"])) {
    drivers.add("external_integration");
  }
  if (containsAny(text, ["broad diff", "many files", "blast radius"])) {
    drivers.add("broad_change_surface");
  }

  return Array.from(drivers).sort();
}

function driversForThreshold(
  threshold: ThresholdCandidate,
): ComplexityPressureDriver[] {
  switch (threshold) {
    case "repetition":
      return ["repetition"];
    case "state_ownership":
      return ["shared_state"];
    case "persistence":
      return ["durable_state"];
    case "identity":
      return ["identity"];
    case "collaboration":
      return ["collaboration"];
    case "public_api":
      return ["public_access"];
    case "deployment":
      return ["operational_runtime"];
    case "operational":
      return ["operational_runtime"];
    case "security":
      return ["security_sensitive", "authorization"];
    case "blast_radius":
      return ["broad_change_surface"];
    case "revisit":
      return ["revisit_pressure"];
  }
}

function pressureLevelFor(
  concern: BaselineConcernAssessment,
  drivers: ComplexityPressureDriver[],
): ComplexityPressureLevel {
  if (drivers.length === 0 && concern.facts.length === 0) {
    return "none";
  }
  if (
    drivers.some((driver) =>
      [
        "authorization",
        "security_sensitive",
        "public_access",
        "collaboration",
        "concurrency",
        "broad_change_surface",
        "operational_runtime",
      ].includes(driver)
    )
    || concern.axes.complexity === "high"
  ) {
    return "high";
  }
  if (
    drivers.length > 0
    || concern.axes.complexity === "medium"
    || concern.thresholdCandidates.length > 0
  ) {
    return "medium";
  }
  return "low";
}

function isProvisionalPressure(
  concern: BaselineConcernAssessment,
  drivers: ComplexityPressureDriver[],
): boolean {
  if (concern.confidence === "low") {
    return true;
  }
  if (
    concern.axes.complexity === "high"
    || drivers.some((driver) =>
      [
        "collaboration",
        "concurrency",
        "security_sensitive",
        "public_access",
        "broad_change_surface",
        "operational_runtime",
      ].includes(driver)
    )
  ) {
    return false;
  }
  if (drivers.some((driver) => driver === "security_sensitive" || driver === "public_access")) {
    return false;
  }
  return uniqueSourceCount(concern.facts) < 2 && drivers.length > 0;
}

function supportSignalsFor(
  concern: ArchitectureConcern,
  text: string,
): string[] {
  const supports = new Set<string>();
  if (concern === "state_ownership" && containsAny(text, ["custom hook", "useproject", "hook owns", "state owner"])) {
    supports.add("state owner");
  }
  if (concern === "data_storage" && containsAny(text, ["repository", "adapter", "client boundary", "persistence boundary"])) {
    supports.add("repository boundary");
  }
  if (concern === "api_contract" && containsAny(text, ["request", "response", "contract", "openapi", "schema"])) {
    supports.add("contract");
  }
  if (
    (concern === "authentication" || concern === "authorization")
    && containsAny(text, ["middleware", "session", "oauth", "membership", "role", "rbac", "access control"])
  ) {
    supports.add("access boundary");
  }
  if (
    concern === "testing"
    && containsAny(text, ["integration coverage", "e2e", "playwright", "coverage", "harness", "boundary test"])
  ) {
    supports.add("test harness");
  }
  if (
    (concern === "deployment" || concern === "observability")
    && containsAny(text, ["health", "log", "metric", "alert", "rollback"])
  ) {
    supports.add("operational signal");
  }
  if (concern === "package_boundary" && containsAny(text, ["package", "workspace", "runtime boundary", "monorepo"])) {
    supports.add("package boundary");
  }
  if (supports.size === 0 && concern !== "unknown") {
    supports.add("localized implementation");
  }
  return Array.from(supports).sort();
}

function supportLevelFor(
  concern: ArchitectureConcern,
  text: string,
  supports: string[],
): StructuralSupportLevel {
  if (supports.length === 0) {
    return "absent";
  }
  if (supports.includes("operational signal") && concern !== "testing") {
    return "operationalized";
  }
  if (
    supports.includes("contract")
    || (
      supports.includes("test harness")
      && supports.some((support) =>
        ["repository boundary", "access boundary", "package boundary"].includes(support)
      )
    )
  ) {
    return "contracted";
  }
  if (
    supports.some((support) =>
      ["repository boundary", "access boundary", "package boundary", "state owner"].includes(support)
    )
  ) {
    return "bounded";
  }
  if (containsAny(text, ["named", "owner", "handler", "route", "component", "module"])) {
    return "named";
  }
  return "localized";
}

function adequacyStatusFor(
  pressure: ComplexityPressureAssessment,
  support: StructuralSupportAssessment,
): StructureAdequacyStatus {
  if (pressure.level === "none" && support.level === "unknown") {
    return "unknown";
  }
  if (pressure.provisional || support.level === "unknown") {
    return "unknown";
  }
  const pressureRank = pressureRankFor(pressure.level);
  const supportRank = supportRankFor(support.level);
  if (supportRank + 1 < pressureRank) {
    return "under_structured";
  }
  if (supportRank > pressureRank + 2 && pressureRank <= 1) {
    return "over_structured";
  }
  if (supportRank < pressureRank) {
    return "watch";
  }
  return "adequate";
}

function actionForAdequacy(
  concern: ArchitectureConcern,
  status: StructureAdequacyStatus,
): string {
  if (status === "adequate") {
    return "continue";
  }
  if (status === "over_structured") {
    return "localize";
  }
  if (status === "unknown" || status === "watch") {
    return "record_decision";
  }
  switch (concern) {
    case "state_ownership":
      return "extract";
    case "data_storage":
    case "api_contract":
    case "package_boundary":
      return "insert_boundary";
    case "authentication":
    case "authorization":
    case "risk_hotspot":
      return "run_review";
    case "deployment":
    case "observability":
      return "operationalize";
    default:
      return "name";
  }
}

function pressureRankFor(level: ComplexityPressureLevel): number {
  switch (level) {
    case "none":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

function supportRankFor(level: StructuralSupportLevel): number {
  switch (level) {
    case "absent":
      return 0;
    case "localized":
      return 1;
    case "named":
      return 2;
    case "bounded":
      return 3;
    case "contracted":
      return 4;
    case "operationalized":
      return 5;
    case "unknown":
      return -1;
  }
}

function pressureReason(
  concern: ArchitectureConcern,
  level: ComplexityPressureLevel,
  drivers: ComplexityPressureDriver[],
  provisional: boolean,
): string {
  const suffix = provisional ? "; this judgment is provisional." : ".";
  if (drivers.length === 0) {
    return `${concern} has ${level} pressure because no concrete pressure driver was found${suffix}`;
  }
  return `${concern} has ${level} pressure from ${drivers.join(", ")}${suffix}`;
}

function supportReason(
  concern: ArchitectureConcern,
  level: StructuralSupportLevel,
  supports: string[],
): string {
  if (supports.length === 0) {
    return `${concern} support is ${level} because no supporting structure was found.`;
  }
  return `${concern} support is ${level} through ${supports.join(", ")}.`;
}

function adequacyReason(
  concern: ArchitectureConcern,
  status: StructureAdequacyStatus,
  pressure: ComplexityPressureAssessment,
  support: StructuralSupportAssessment,
  pressureRank: number,
  supportRank: number,
): string {
  if (status === "under_structured") {
    return `${concern} is under-structured: ${pressure.level} pressure is above ${support.level} support.`;
  }
  if (status === "over_structured") {
    return `${concern} may be over-structured: ${support.level} support exceeds ${pressure.level} pressure.`;
  }
  if (status === "watch") {
    return `${concern} should be watched: ${pressure.level} pressure is slightly ahead of ${support.level} support.`;
  }
  if (status === "unknown") {
    return `${concern} adequacy is unknown because pressure or support evidence is provisional or missing.`;
  }
  return `${concern} structure is adequate: pressure rank ${pressureRank} is covered by support rank ${supportRank}.`;
}

function revisitConditionsFor(
  adequacy: StructureAdequacyAssessment,
): string[] {
  if (adequacy.status === "under_structured") {
    return ["pressure increases", "support weakens", "related files change"];
  }
  return ["new evidence changes pressure or support"];
}

function factsText(facts: BaselineFact[]): string {
  return facts.map((fact) => `${fact.label}\n${fact.summary}`).join("\n").toLowerCase();
}

function evidenceRefsFor(facts: BaselineFact[]): string[] {
  return Array.from(new Set(facts.flatMap((fact) => [
    fact.id,
    ...fact.sources.map((source) => `${source.source}:${source.category}`),
  ]))).sort();
}

function uniqueSourceCount(facts: BaselineFact[]): number {
  return new Set(facts.flatMap((fact) => fact.sources.map((source) => source.source))).size;
}

function minConfidence(
  left: BaselineConfidence,
  right: BaselineConfidence,
): BaselineConfidence {
  if (left === "low" || right === "low") {
    return "low";
  }
  if (left === "medium" || right === "medium") {
    return "medium";
  }
  return "high";
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}
