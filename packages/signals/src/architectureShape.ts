import type { OptionalSignalProvider, OptionalSignalResult, SignalContext } from "./index.js";

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
  /^pkg\/.*\.(js|d\.ts|wasm|map)$/i,
];

export const architectureShapeProvider: OptionalSignalProvider = {
  name: "repository-shape",
  collect(context: SignalContext): OptionalSignalResult {
    const files = uniqueFiles(context.knownFiles ?? context.changedFiles)
      .filter((file) => !isGeneratedOrToolingPath(file));
    if (files.length === 0) {
      return {
        source: "repository-shape",
        status: "absent",
        category: "architecture_shape",
        freshness: context.knownFiles ? "current" : "unknown",
        confidence: "low",
        evidence: [],
        error: "no source files available for architecture shape inference",
      };
    }

    const evidence = shapeEvidence(files);
    if (evidence.length === 0) {
      return {
        source: "repository-shape",
        status: "absent",
        category: "architecture_shape",
        freshness: "current",
        confidence: "low",
        evidence: [],
        error: "no recognizable application shape evidence observed",
      };
    }

    return {
      source: "repository-shape",
      status: "present",
      category: "architecture_shape",
      freshness: "current",
      confidence: evidence.length >= 3 ? "high" : "medium",
      evidence,
    };
  },
};

function shapeEvidence(files: string[]): string[] {
  const evidence: string[] = [];
  const hasTsx = files.some((file) => file.endsWith(".tsx"));
  const hasReactEntrypoint = files.some((file) =>
    /(^|\/)(main|index|app)\.tsx$/.test(file)
  );
  const hasReactDirs = files.some((file) =>
    /(^|\/)src\/(components|pages|routes|app)\//.test(file)
  );
  const hasRustCrates = files.some((file) => /^crates\/[^/]+\/src\/.*\.rs$/.test(file));
  const hasRustManifest = files.some((file) => file === "Cargo.toml" || /^crates\/[^/]+\/Cargo\.toml$/.test(file));
  const hasWasmMarkers = files.some((file) =>
    file === "wasm-pack.toml"
    || file === "Trunk.toml"
    || /(^|\/)(wasm|bindings?|pkg)\//i.test(file)
    || file.endsWith(".wasm")
  );
  const hasPackageBoundary = files.some((file) =>
    file === "package.json"
    || file.endsWith("/Package.swift")
    || file === "Package.swift"
    || file === "pnpm-workspace.yaml"
    || file === "bun.lock"
    || file.startsWith("packages/")
    || file.startsWith("apps/")
    || file.startsWith("pkg/")
  );
  const hasTests = files.some((file) =>
    /(^|\/)(tests?|__tests__)\/.+/.test(file)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
    || /(^|\/)crates\/[^/]+\/tests\//.test(file)
  );
  const hasStaticAssets = files.some((file) => /^public\//.test(file));
  const hasSwiftPackage = files.some((file) =>
    file === "Package.swift"
    || file.endsWith("/Package.swift")
    || /(^|\/)Sources\/.+\.swift$/.test(file)
  );
  const hasMacAppMarkers = files.some((file) =>
    file.endsWith(".entitlements")
    || file.endsWith(".xcodeproj/project.pbxproj")
    || /(^|\/)Sources\/.*(AppDelegate|WindowController|ViewModel|Document)\.swift$/.test(file)
  );

  if (hasTsx || hasReactEntrypoint || hasReactDirs) {
    evidence.push(`React/TypeScript frontend shape: ${sample(files, [
      /\.tsx$/,
      /(^|\/)src\/(components|pages|routes|app)\//,
      /(^|\/)(main|index|app)\.tsx$/,
    ]).join(", ")}`);
  }
  if (hasRustCrates || hasRustManifest) {
    evidence.push(`Rust crate/native module shape: ${sample(files, [
      /^crates\/[^/]+\/src\/.*\.rs$/,
      /^crates\/[^/]+\/Cargo\.toml$/,
      /^Cargo\.toml$/,
    ]).join(", ")}`);
  }
  if ((hasTsx || hasReactEntrypoint) && (hasRustCrates || hasRustManifest || hasWasmMarkers)) {
    evidence.push("Runtime boundary candidates: React/TypeScript frontend and Rust/WASM or native-module markers are both present.");
  }
  if (hasWasmMarkers) {
    evidence.push(`WASM/package boundary markers: ${sample(files, [
      /wasm/i,
      /^pkg\//,
      /bindings?/i,
      /wasm-pack\.toml$/,
    ]).join(", ")}`);
  }
  if (hasSwiftPackage || hasMacAppMarkers) {
    evidence.push(`Swift/macOS app shape: ${sample(files, [
      /(^|\/)Package\.swift$/,
      /(^|\/)Sources\/.+\.swift$/,
      /\.entitlements$/,
      /\.xcodeproj\/project\.pbxproj$/,
    ]).join(", ")}`);
  }
  if (hasPackageBoundary) {
    evidence.push(`Package boundary evidence: ${sample(files, [
      /^package\.json$/,
      /(^|\/)Package\.swift$/,
      /^pnpm-workspace\.yaml$/,
      /^bun\.lock$/,
      /^packages\//,
      /^apps\//,
      /^pkg\//,
    ]).join(", ")}`);
  }
  if (hasTests) {
    evidence.push(`Test surface evidence: ${sample(files, [
      /(^|\/)(tests?|__tests__)\/.+/,
      /\.(test|spec)\.[cm]?[jt]sx?$/,
      /(^|\/)crates\/[^/]+\/tests\//,
    ]).join(", ")}`);
  }
  if (hasStaticAssets) {
    evidence.push(`Static asset surface: ${sample(files, [/^public\//]).join(", ")}`);
  }

  return evidence.filter((item) => !item.endsWith(": "));
}

function sample(files: string[], patterns: RegExp[]): string[] {
  const matches = files.filter((file) => patterns.some((pattern) => pattern.test(file)));
  return matches.slice(0, 6);
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.filter((file) => file.trim().length > 0))).sort();
}

function isGeneratedOrToolingPath(file: string): boolean {
  return generatedPathPatterns.some((pattern) => pattern.test(file));
}
