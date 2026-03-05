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

        fs.writeFileSync(gradlePropsPath, contents);
      }

      return config;
    },
  ]);
}

module.exports = withGradleOptimizations;
