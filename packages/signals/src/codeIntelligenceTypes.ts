export const codeIntelligenceSchemaVersion = "tech-coach.code-intelligence.v1";

export type CodeIntelligenceProducer = {
  name: string;
  engine?: string;
  version?: string;
};

export type CodeLanguageSummary = {
  id: string;
  files: number;
  parsed: number;
  skipped?: number;
  failed?: number;
  parser?: string;
  variants?: string[];
};

export type CodeFileSummary = {
  path: string;
  languageId: string;
  parsed: boolean;
  skipped?: boolean;
  error?: string;
};

export type CodeLocation = {
  file: string;
  startLine?: number;
  endLine?: number;
  column?: number;
};

export type CodeSymbol = {
  name: string;
  kind: string;
  languageId?: string;
  location: CodeLocation;
  parent?: string;
  complexity?: number;
};

export type CodeDependency = {
  source: string;
  target: string;
  kind: "import" | "call" | "inheritance" | "reference";
  languageId?: string;
  location?: CodeLocation;
};

export type CodeComplexitySummary = {
  unitCount?: number;
  totalCyclomaticComplexity?: number;
  maxUnitCyclomaticComplexity?: number;
};

export type CodeIntelligenceDiagnostic = {
  severity: "info" | "warning" | "error";
  message: string;
  file?: string;
  languageId?: string;
};

export type CodeIntelligenceReport = {
  schemaVersion: typeof codeIntelligenceSchemaVersion;
  producer: CodeIntelligenceProducer;
  repoRoot: string;
  generatedAt?: string;
  languages: CodeLanguageSummary[];
  files: CodeFileSummary[];
  symbols: CodeSymbol[];
  dependencies: CodeDependency[];
  complexity?: CodeComplexitySummary;
  diagnostics?: CodeIntelligenceDiagnostic[];
};
