#!/usr/bin/env bun
// ─── Build APK ─────────────────────────────────────────────────────
// CLI script that builds a release APK via Gradle without deploying.
// Runs build:client + bundle:client first, then assembleRelease.
// Usage: bun run scripts/build-apk.ts [--debug]

import { existsSync } from "node:fs";
import { join } from "node:path";
const ROOT = join(import.meta.dir, "..");
const HOST_DIR = join(ROOT, "packages", "host");
const ANDROID_DIR = join(HOST_DIR, "android");

const isDebug = process.argv.includes("--debug");
const variant = isDebug ? "Debug" : "Release";
const variantLower = variant.toLowerCase();

async function run(
  label: string,
  cmd: string[],
  cwd: string,
): Promise<void> {
  console.log(`\n> ${label}`);
  console.log(`  $ ${cmd.join(" ")}\n`);

  const proc = Bun.spawn(cmd, {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env },
  });

  const code = await proc.exited;

  if (code !== 0) {
    console.error(`\n  Failed: ${label} (exit ${code})`);
    process.exit(code);
  }
}

async function main(): Promise<void> {
  console.log(`\nBuilding ${variant} APK...\n`);

  // 1. Verify android/ project exists
  if (!existsSync(ANDROID_DIR)) {
    console.error(
      "  android/ directory not found. Run `bun run prebuild` in packages/host first.",
    );
    process.exit(1);
  }

  // 2. Build + bundle client into host assets
  await run("Build client", ["bun", "run", "build:client"], ROOT);
  await run("Bundle client into host assets", ["bun", "run", "bundle:client"], ROOT);

  // 3. Build APK via Gradle
  const gradlew = join(ANDROID_DIR, "gradlew");

  if (!existsSync(gradlew)) {
    console.error("  gradlew not found. Run `bun run prebuild` in packages/host first.");
    process.exit(1);
  }

  await run(
    `Gradle assemble${variant}`,
    ["./gradlew", `assemble${variant}`],
    ANDROID_DIR,
  );

  // 4. Report output
  const apkDir = join(
    ANDROID_DIR,
    "app",
    "build",
    "outputs",
    "apk",
    variantLower,
  );
  const apkName = `app-${variantLower}.apk`;
  const apkPath = join(apkDir, apkName);

  if (existsSync(apkPath)) {
    const stat = await Bun.file(apkPath).stat();
    if (stat) {
      const sizeMB = (stat.size / 1_048_576).toFixed(2);
      console.log(`\n  APK: ${apkPath}`);
      console.log(`  Size: ${sizeMB} MB\n`);
    }
  } else {
    console.log(`\n  APK expected at: ${apkPath}`);
    console.log("  (file not found — check Gradle output above)\n");
  }
}

main();
