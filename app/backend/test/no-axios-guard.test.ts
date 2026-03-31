import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, "..");
const packageJsonPath = path.join(backendDir, "package.json");
const packageLockPath = path.join(backendDir, "package-lock.json");
const sourceRoots = ["src", "scripts"].map((segment) => path.join(backendDir, segment));
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const forbiddenPackageName = `ax${"ios"}`;
const forbiddenImportPatterns = [
  new RegExp(String.raw`\bfrom\s*["']${forbiddenPackageName}["']`),
  new RegExp(String.raw`\brequire\(\s*["']${forbiddenPackageName}["']\s*\)`),
  new RegExp(String.raw`\bimport\(\s*["']${forbiddenPackageName}["']\s*\)`)
];

type DependencyMap = Record<string, string> | undefined;

type PackageManifest = {
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
  overrides?: Record<string, unknown>;
};

type PackageLockPackageInfo = {
  dependencies?: Record<string, string>;
};

type PackageLock = {
  packages?: Record<string, PackageLockPackageInfo>;
  dependencies?: Record<string, unknown>;
};

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return collectSourceFiles(fullPath);
      }

      if (!sourceExtensions.has(path.extname(entry.name))) {
        return [];
      }

      return [fullPath];
    })
  );

  return files.flat();
}

function assertDependencySectionDoesNotUseAxios(
  section: string,
  dependencies: DependencyMap
) {
  assert.equal(
    dependencies?.[forbiddenPackageName],
    undefined,
    `package.json must not declare ${forbiddenPackageName} in ${section}`
  );
}

test("backend package manifest does not declare axios", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageManifest;

  assertDependencySectionDoesNotUseAxios("dependencies", packageJson.dependencies);
  assertDependencySectionDoesNotUseAxios("devDependencies", packageJson.devDependencies);
  assertDependencySectionDoesNotUseAxios(
    "optionalDependencies",
    packageJson.optionalDependencies
  );
  assertDependencySectionDoesNotUseAxios("peerDependencies", packageJson.peerDependencies);
  assert.equal(
    packageJson.overrides?.[forbiddenPackageName],
    undefined,
    `package.json must not override ${forbiddenPackageName}`
  );
});

test("backend lockfile does not resolve axios anywhere in the dependency tree", async () => {
  const packageLock = JSON.parse(await readFile(packageLockPath, "utf8")) as PackageLock;
  const packages = packageLock.packages ?? {};
  const dependencyEntries = Object.entries(packages).filter(([, info]) =>
    Object.hasOwn(info.dependencies ?? {}, forbiddenPackageName)
  );

  assert.equal(
    packages[`node_modules/${forbiddenPackageName}`],
    undefined,
    `package-lock.json must not contain node_modules/${forbiddenPackageName}`
  );
  assert.equal(
    packageLock.dependencies?.[forbiddenPackageName],
    undefined,
    `package-lock.json must not resolve ${forbiddenPackageName} as a top-level dependency`
  );
  assert.deepEqual(
    dependencyEntries,
    [],
    `package-lock.json must not include ${forbiddenPackageName} in nested dependency maps`
  );
});

test("backend source and scripts do not import axios", async () => {
  const files = (await Promise.all(sourceRoots.map((root) => collectSourceFiles(root)))).flat();
  const importHits: string[] = [];

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");

    if (forbiddenImportPatterns.some((pattern) => pattern.test(source))) {
      importHits.push(path.relative(backendDir, filePath));
    }
  }

  assert.deepEqual(
    importHits,
    [],
    `source files must not import ${forbiddenPackageName}`
  );
});
