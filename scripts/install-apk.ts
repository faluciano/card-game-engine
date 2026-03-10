#!/usr/bin/env bun
// ─── Install APK ───────────────────────────────────────────────────
// CLI script that installs the built APK to a connected Android device
// via adb. Detects available devices and handles common error cases.
// Usage: bun run scripts/install-apk.ts [--debug] [--launch]

import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ANDROID_DIR = join(ROOT, "packages", "host", "android");
const PACKAGE_NAME = "com.cardgameengine.host";

const isDebug = process.argv.includes("--debug");
const shouldLaunch = process.argv.includes("--launch");
const variant = isDebug ? "debug" : "release";

async function exec(
  cmd: string[],
  opts?: { silent?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const code = await proc.exited;

  if (!opts?.silent && code !== 0) {
    process.stderr.write(stderr);
  }

  return { code, stdout, stderr };
}

async function findAdb(): Promise<string> {
  // Check ANDROID_HOME first, then PATH
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;

  if (androidHome) {
    const candidate = join(androidHome, "platform-tools", "adb");
    if (existsSync(candidate)) return candidate;
  }

  // Fall back to PATH
  const { code, stdout } = await exec(["which", "adb"], { silent: true });

  if (code === 0 && stdout.trim()) return stdout.trim();

  console.error("  adb not found. Ensure Android SDK platform-tools are installed and in PATH.");
  console.error("  Set ANDROID_HOME or ANDROID_SDK_ROOT to your SDK directory.");
  process.exit(1);
}

async function getDevices(adb: string): Promise<string[]> {
  const { code, stdout } = await exec([adb, "devices"]);

  if (code !== 0) {
    console.error("  Failed to list devices. Is the adb server running?");
    process.exit(1);
  }

  return stdout
    .split("\n")
    .slice(1) // skip header
    .map((line) => line.trim())
    .filter((line) => line.endsWith("device"))
    .map((line) => line.split(/\s+/)[0]);
}

async function main(): Promise<void> {
  console.log(`\nInstalling ${variant} APK...\n`);

  // 1. Locate APK
  const apkPath = join(
    ANDROID_DIR,
    "app",
    "build",
    "outputs",
    "apk",
    variant,
    `app-${variant}.apk`,
  );

  if (!existsSync(apkPath)) {
    console.error(`  APK not found: ${apkPath}`);
    console.error(`  Run \`bun run apk${isDebug ? " -- --debug" : ""}\` first to build it.`);
    process.exit(1);
  }

  const stat = await Bun.file(apkPath).stat();
  if (stat) {
    const sizeMB = (stat.size / 1_048_576).toFixed(2);
    console.log(`  APK: app-${variant}.apk (${sizeMB} MB)`);
  }

  // 2. Find adb
  const adb = await findAdb();
  console.log(`  adb: ${adb}`);

  // 3. Detect devices
  const devices = await getDevices(adb);

  if (devices.length === 0) {
    console.error("\n  No devices connected.");
    console.error("  Connect a device via USB or ensure adb over TCP is configured.");
    process.exit(1);
  }

  console.log(`  Device(s): ${devices.join(", ")}\n`);

  // 4. Install to each connected device
  for (const device of devices) {
    console.log(`> Installing to ${device}...`);

    const proc = Bun.spawn([adb, "-s", device, "install", "-r", "-d", apkPath], {
      stdio: ["inherit", "inherit", "inherit"],
    });

    const code = await proc.exited;

    if (code !== 0) {
      console.error(`\n  Install failed for ${device} (exit ${code})`);
      process.exit(code);
    }

    console.log(`  Installed to ${device}`);

    // 5. Optionally launch the app
    if (shouldLaunch) {
      console.log(`> Launching on ${device}...`);

      const launchProc = Bun.spawn(
        [
          adb, "-s", device,
          "shell", "am", "start",
          "-n", `${PACKAGE_NAME}/.MainActivity`,
        ],
        { stdio: ["inherit", "inherit", "inherit"] },
      );

      const launchCode = await launchProc.exited;

      if (launchCode !== 0) {
        console.error(`  Launch failed on ${device} (exit ${launchCode})`);
      } else {
        console.log(`  Launched on ${device}`);
      }
    }
  }

  console.log("\n  Done.\n");
}

main();
