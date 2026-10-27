// The country registry lives in the calibration-tree package. The dashboard
// once kept it at lib/microcosm/countries and then a re-export there; neither
// may come back, and no dashboard module may name that location, so the
// registry has one import path: @policyengine/calibration-tree/countries.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const FRONTEND_ROOT = resolve(import.meta.dir, "../..");
const FORMER_REGISTRY = join(FRONTEND_ROOT, "lib", "microcosm", "countries");
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
// Calls whose first argument names a module.
const MODULE_LOADING_CALLS = new Set(["require", "require.resolve", "import.meta.resolve", "mock.module"]);

// Dashboard sources a checkout contains, relative to frontend/: tracked files
// and new files that are not ignored, without the package's own sources.
function dashboardSourceFiles(): string[] {
  const listing = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."],
    { cwd: FRONTEND_ROOT, stdout: "pipe", stderr: "pipe" },
  );
  if (listing.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${listing.stderr.toString()}`);
  }
  return listing.stdout
    .toString()
    .split("\0")
    .filter((relativePath) => SOURCE_FILE.test(relativePath))
    .filter((relativePath) => !relativePath.startsWith("packages/"))
    .filter((relativePath) => existsSync(join(FRONTEND_ROOT, relativePath)))
    .sort();
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isMetaProperty(expression)) {
    return `${ts.tokenToString(expression.keywordToken)}.${expression.name.text}`;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const objectName = calleeName(expression.expression);
    return objectName === null ? null : `${objectName}.${expression.name.text}`;
  }
  return null;
}

// Every module a source names as a string: static, type-only and dynamic
// imports, re-exports, import types, require(), mock.module() and
// triple-slash path references.
function moduleSpecifiers(fileName: string, sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers = sourceFile.referencedFiles.map(({ fileName: referencedPath }) =>
    /^\.{1,2}\//.test(referencedPath) ? referencedPath : `./${referencedPath}`,
  );
  const addLiteral = (node: ts.Node | undefined) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addLiteral(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addLiteral(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        MODULE_LOADING_CALLS.has(calleeName(node.expression) ?? ""))
    ) {
      addLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

// The file path a dashboard specifier points at without its extension, or
// null for a package name. `@/` is the dashboard root (tsconfig `paths`).
function dashboardTarget(fromFile: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = join(FRONTEND_ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) target = resolve(dirname(fromFile), specifier);
  else return null;
  const extension = SOURCE_EXTENSIONS.find((sourceExtension) => target.endsWith(sourceExtension));
  return extension === undefined ? target : target.slice(0, -extension.length);
}

test("the country registry has no copy or re-export at its former lib/microcosm location", () => {
  const formerRegistryFiles = [
    ...SOURCE_EXTENSIONS.map((extension) => `${FORMER_REGISTRY}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(FORMER_REGISTRY, `index${extension}`)),
  ]
    .filter(existsSync)
    .map((file) => relative(FRONTEND_ROOT, file));

  expect(formerRegistryFiles).toEqual([]);
});

test("dashboard modules import the country registry only from @policyengine/calibration-tree/countries", () => {
  const formerRegistryReferences = dashboardSourceFiles().flatMap((relativePath) => {
    const file = join(FRONTEND_ROOT, relativePath);
    return moduleSpecifiers(relativePath, readFileSync(file, "utf8"))
      .filter((specifier) => {
        const target = dashboardTarget(file, specifier);
        return target === FORMER_REGISTRY || target === join(FORMER_REGISTRY, "index");
      })
      .map((specifier) => `${relativePath}: "${specifier}"`);
  });

  expect(formerRegistryReferences).toEqual([]);
});
