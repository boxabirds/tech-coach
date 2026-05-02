import type { CoachAction } from "../../kernel/src/protocol.js";

export type AgentOperationKind =
  | "local_edit"
  | "create_name"
  | "extract_boundary"
  | "replace_substrate"
  | "run_review"
  | "ask_user"
  | "record_decision"
  | "add_test"
  | "add_unrelated_architecture";

export type AgentOperation = {
  kind: AgentOperationKind;
  summary: string;
};

export type AgentBehaviorCase = {
  action: CoachAction;
  operations: AgentOperation[];
  questionsAsked?: number;
  decisionsRecorded?: number;
};

export type AgentBehaviorMismatchKind =
  | "missing_required_operation"
  | "forbidden_operation"
  | "missing_user_question"
  | "missing_decision_record"
  | "unrelated_architecture";

export type AgentBehaviorMismatch = {
  kind: AgentBehaviorMismatchKind;
  message: string;
  expected?: string;
  actual?: string;
};

export function assertAgentBehavior(
  input: AgentBehaviorCase,
): AgentBehaviorMismatch[] {
  return [
    ...assertRequiredOperations(input),
    ...assertForbiddenOperations(input),
    ...assertDecisionFlow(input),
  ];
}

function assertRequiredOperations(
  input: AgentBehaviorCase,
): AgentBehaviorMismatch[] {
  const expected = requiredOperationsFor(input.action);
  const actual = new Set(input.operations.map((operation) => operation.kind));
  return expected
    .filter((kind) => !actual.has(kind))
    .map((kind) => ({
      kind: "missing_required_operation",
      expected: kind,
      actual: Array.from(actual).join(", "),
      message: `${input.action} expected agent operation ${kind}.`,
    }));
}

function assertForbiddenOperations(
  input: AgentBehaviorCase,
): AgentBehaviorMismatch[] {
  const actual = input.operations.map((operation) => operation.kind);
  const forbidden = forbiddenOperationsFor(input.action);
  const mismatches: AgentBehaviorMismatch[] = [];
  for (const kind of actual) {
    if (forbidden.includes(kind)) {
      mismatches.push({
        kind: "forbidden_operation",
        expected: `not ${kind}`,
        actual: kind,
        message: `${input.action} forbids agent operation ${kind}.`,
      });
    }
    if (kind === "add_unrelated_architecture") {
      mismatches.push({
        kind: "unrelated_architecture",
        expected: "operations tied to the coach action",
        actual: kind,
        message: "Agent added architecture unrelated to the coach action.",
      });
    }
  }
  return mismatches;
}

function assertDecisionFlow(
  input: AgentBehaviorCase,
): AgentBehaviorMismatch[] {
  if (input.action === "Stop and decide" && (input.questionsAsked ?? 0) === 0) {
    return [{
      kind: "missing_user_question",
      expected: "at least one host-mediated question",
      actual: "none",
      message: "Stop and decide requires asking the user before implementation.",
    }];
  }
  if (input.action === "Record decision" && (input.decisionsRecorded ?? 0) === 0) {
    return [{
      kind: "missing_decision_record",
      expected: "durable decision record",
      actual: "none",
      message: "Record decision requires a durable architecture decision.",
    }];
  }
  return [];
}

function requiredOperationsFor(action: CoachAction): AgentOperationKind[] {
  switch (action) {
    case "Name":
      return ["create_name"];
    case "Insert boundary":
      return ["extract_boundary"];
    case "Run review":
      return ["run_review"];
    case "Add test harness":
      return ["add_test"];
    case "Record decision":
      return ["record_decision"];
    default:
      return [];
  }
}

function forbiddenOperationsFor(action: CoachAction): AgentOperationKind[] {
  switch (action) {
    case "Continue":
    case "Localize":
      return [
        "create_name",
        "extract_boundary",
        "replace_substrate",
        "run_review",
        "record_decision",
        "add_unrelated_architecture",
      ];
    case "Name":
      return ["replace_substrate", "add_unrelated_architecture"];
    case "Insert boundary":
      return ["replace_substrate", "add_unrelated_architecture"];
    case "Record decision":
    case "Stop and decide":
      return [
        "create_name",
        "extract_boundary",
        "replace_substrate",
        "add_unrelated_architecture",
      ];
    default:
      return ["add_unrelated_architecture"];
  }
}
