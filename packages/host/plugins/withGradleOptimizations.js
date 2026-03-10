// Resolve @expo/config-plugins via expo's own node_modules to work
// around Bun monorepo hoisting (the package lives in .bun/ cache and
// isn't directly resolvable from this directory).
const path = require("path");
const fs = require("fs");
const expoDir = path.dirname(require.resolve("expo/package.json"));
const configPluginsPath = require.resolve("@expo/config-plugins", {
  paths: [expoDir],
});
const { withDangerousMod } = require(configPluginsPath);

/**
 * Expo config plugin that optimizes Gradle build settings in the
 * generated `gradle.properties`:
 * 1. Increases JVM heap from 2 GB to 3 GB (-Xmx3g)
 * 2. Enables the Gradle build cache (org.gradle.caching=true)
 * 3. Enables legacy JNI packaging (required by extractNativeLibs=true)
 * 4. Removes stale react-native-reanimated ProGuard rules
 * 5. Switches to proguard-android-optimize.txt for better R8 optimization
 * 6. Disables edgeToEdgeEnabled (no-op on Android TV)
 *
 * CI already applies its own overrides after prebuild, so this plugin
 * only affects local development builds.
 */
function withGradleOptimizations(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const gradlePropsPath = path.join(
        config.modRequest.platformProjectRoot,
        "gradle.properties"
      );

      if (fs.existsSync(gradlePropsPath)) {
        let contents = fs.readFileSync(gradlePropsPath, "utf8");

        // Increase JVM heap from 2GB to 3GB (preserve remaining flags)
        contents = contents.replace(/-Xmx2048m/, "-Xmx3g");

        // Enable build cache
        if (!contents.includes("org.gradle.caching=")) {
          contents += "\norg.gradle.caching=true\n";
        }

        // Enable legacy JNI packaging (pairs with extractNativeLibs=true in withAndroidTV)
        contents = contents.replace(
          /expo\.useLegacyPackaging=false/,
          "expo.useLegacyPackaging=true"
        );
        if (!contents.includes("expo.useLegacyPackaging=")) {
          contents += "expo.useLegacyPackaging=true\n";
        }

        // Disable edge-to-edge (no-op on Android TV, removes deprecation warning)
        contents = contents.replace(/edgeToEdgeEnabled=true/g, "edgeToEdgeEnabled=false");

        fs.writeFileSync(gradlePropsPath, contents);
      }

      // Remove stale react-native-reanimated ProGuard rules (not a dependency)
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        "app/proguard-rules.pro"
      );
      if (fs.existsSync(proguardPath)) {
        let proguard = fs.readFileSync(proguardPath, "utf8");
        proguard = proguard.replace(
          /# react-native-reanimated\n-keep class com\.swmansion\.reanimated\.\*\* \{ \*; \}\n-keep class com\.facebook\.react\.turbomodule\.\*\* \{ \*; \}\n\n?/,
          ""
        );
        fs.writeFileSync(proguardPath, proguard);
      }

      // Switch to optimized ProGuard defaults (enables method inlining, class merging)
      const buildGradlePath = path.join(
        config.modRequest.platformProjectRoot,
        "app/build.gradle"
      );
      if (fs.existsSync(buildGradlePath)) {
        let buildGradle = fs.readFileSync(buildGradlePath, "utf8");
        buildGradle = buildGradle.replace(
          'getDefaultProguardFile("proguard-android.txt")',
          'getDefaultProguardFile("proguard-android-optimize.txt")'
        );
        fs.writeFileSync(buildGradlePath, buildGradle);
      }

      return config;
    },
  ]);
}

module.exports = withGradleOptimizations;
