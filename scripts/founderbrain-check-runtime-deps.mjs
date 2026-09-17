#!/usr/bin/env node
/**
 * Assert every dependency in deploy/railway/package.json resolves to the same
 * version installed from the root package-lock.json. The Dockerfile builds with
 * the root lockfile, then installs the runtime manifest — those two must agree.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = JSON.parse(readFileSync(join(root, "deploy/railway/package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const deps = runtime.dependencies ?? {};
const failures = [];

for (const [name, runtimeSpec] of Object.entries(deps)) {
  const rootSpec = rootPkg.dependencies?.[name] ?? rootPkg.devDependencies?.[name];
  if (rootSpec === undefined) {
    failures.push(`${name}: listed in deploy/railway/package.json but missing from root package.json`);
    continue;
  }
  if (rootSpec !== runtimeSpec) {
    failures.push(
      `${name}: root package.json has ${JSON.stringify(rootSpec)} but deploy/railway has ${JSON.stringify(runtimeSpec)}`,
    );
  }
  const locked = lock.packages?.[`node_modules/${name}`];
  if (!locked?.version) {
    failures.push(`${name}: not present in root package-lock.json under node_modules/${name}`);
    continue;
  }
  // Semver ranges in both manifests must resolve to the locked version used in CI/Docker.
  const rangeOk = satisfiesCaretOrExact(runtimeSpec, locked.version);
  if (!rangeOk) {
    failures.push(
      `${name}: deploy/railway range ${JSON.stringify(runtimeSpec)} does not match lockfile version ${locked.version}`,
    );
  }
}

if (failures.length) {
  console.error("FounderBrain runtime dependency drift detected:");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(
  `Runtime deps match root lockfile (${Object.keys(deps).length} packages: ${Object.keys(deps).join(", ")}).`,
);

/** Enough for the caret ranges this repo uses (`^x.y.z`) plus exact versions. */
function satisfiesCaretOrExact(range, version) {
  if (range === version) return true;
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const v = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m || !v) return false;
  const [ , rMaj, rMin, rPatch ] = m.map(Number);
  const [ , vMaj, vMin, vPatch ] = v.map(Number);
  if (rMaj !== vMaj) return false;
  if (rMaj === 0) {
    if (rMin !== vMin) return false;
    return vPatch >= rPatch;
  }
  if (vMin !== rMin) return vMin > rMin;
  return vPatch >= rPatch;
}
