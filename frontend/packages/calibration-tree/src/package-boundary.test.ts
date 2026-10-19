// The package must stay self-contained so it can leave the dashboard's
// repository: its modules import only each other, Node built-ins and the
// dependencies its manifest declares, never the dashboard's `@/` aliases,
// Next.js or `server-only`. Consumers reach it only through its exports.
import { Glob } from "bun";
import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const SOURCE_ROOT = join(PACKAGE_ROOT, "src");
// Bun lists its own modules (`bun`, `bun:test`, ...) among the built-ins.
const NODE_BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith("bun")));

interface PackageManifest {
  name: string;
  exports: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function packageManifest(): PackageManifest {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
}

function sourceFiles(): string[] {
  return [...new Glob("**/*.ts").scanSync({ cwd: SOURCE_ROOT })].sort();
}

// Tests and their support code may also use the test runner, the package's
// own entry points and its development dependencies.
function isTestCode(relativePath: string): boolean {
  return relativePath.endsWith(".test.ts") || relativePath.startsWith("test-support/");
}

function importSpecifiers(source: string): string[] {
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\bmock\.module\(\s*["']([^"']+)["']/g,
  ];
  return patterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1])
  );
}

function packageName(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

function resolvesInsidePackage(fromFile: string, specifier: string): boolean {
  const base = resolve(dirname(fromFile), specifier);
  if (relative(PACKAGE_ROOT, base).startsWith("..")) return false;
  return [base, `${base}.ts`, join(base, "index.ts")].some(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

function importViolation(
  relativePath: string,
  specifier: string,
  manifest: PackageManifest,
): string | null {
  const file = join(SOURCE_ROOT, relativePath);
  const testCode = isTestCode(relativePath);
  if (specifier.startsWith(".")) {
    return resolvesInsidePackage(file, specifier) ? null : "does not resolve inside the package";
  }
  if (specifier === "bun" || specifier.startsWith("bun:")) {
    return testCode ? null : "is test-runner code outside a test";
  }
  if (specifier.startsWith("node:")) {
    return NODE_BUILTINS.has(specifier.slice("node:".length)) ? null : "is not a Node built-in";
  }
  if (NODE_BUILTINS.has(specifier)) return "must use the node: prefix";
  if (specifier.startsWith("@/")) return "is a dashboard path alias";
  if (packageName(specifier) === manifest.name) {
    if (!testCode) return "is a self-reference; package modules import each other relatively";
    return `./${specifier.slice(manifest.name.length + 1)}` in manifest.exports
      ? null
      : "is not a package export";
  }
  const declared = {
    ...manifest.dependencies,
    ...(testCode ? manifest.devDependencies : {}),
  };
  return packageName(specifier) in declared ? null : "is not a declared dependency";
}

test("package modules import only package files, Node built-ins and declared dependencies", () => {
  const manifest = packageManifest();
  const violations = sourceFiles().flatMap((relativePath) =>
    importSpecifiers(readFileSync(join(SOURCE_ROOT, relativePath), "utf8")).flatMap((specifier) => {
      const violation = importViolation(relativePath, specifier, manifest);
      return violation ? [`${relativePath}: "${specifier}" ${violation}`] : [];
    })
  );

  expect(violations).toEqual([]);
});

test("every package export resolves to a package module", () => {
  const manifest = packageManifest();
  const unresolved = Object.entries(manifest.exports).flatMap(([subpath, target]) => {
    const file = resolve(PACKAGE_ROOT, target);
    const valid =
      subpath === `./${basename(target, ".ts")}` &&
      !relative(SOURCE_ROOT, file).startsWith("..") &&
      existsSync(file);
    return valid ? [] : [`${subpath} -> ${target}`];
  });

  expect(Object.keys(manifest.exports).length).toBeGreaterThan(0);
  expect(unresolved).toEqual([]);
});

test("every package module is exported", () => {
  const manifest = packageManifest();
  const exportedTargets = new Set(Object.values(manifest.exports));
  const unexported = sourceFiles()
    .filter((relativePath) => !isTestCode(relativePath))
    .filter((relativePath) => !exportedTargets.has(`./src/${relativePath}`));

  expect(unexported).toEqual([]);
});
