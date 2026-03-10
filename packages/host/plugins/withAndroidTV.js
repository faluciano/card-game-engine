// Resolve @expo/config-plugins via expo's own node_modules to work
// around Bun monorepo hoisting (the package lives in .bun/ cache and
// isn't directly resolvable from this directory).
const path = require("path");
const fs = require("fs");
const expoDir = path.dirname(require.resolve("expo/package.json"));
const configPluginsPath = require.resolve("@expo/config-plugins", {
  paths: [expoDir],
});
const { withAndroidManifest, withDangerousMod } = require(configPluginsPath);

/**
 * Expo config plugin that adds Android TV manifest entries:
 * 1. Copies tv-banner.png to Android drawable resources
 * 2. android:banner attribute on the <application> element
 * 3. LEANBACK_LAUNCHER category on the main activity intent-filter
 * 4. android.software.leanback uses-feature (required=false)
 * 5. android.hardware.touchscreen uses-feature (required=false)
 */
function withAndroidTV(config) {
  // --- 1. Copy TV banner to Android drawable resources ---
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const drawableDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/drawable"
      );
      fs.mkdirSync(drawableDir, { recursive: true });

      const bannerSrc = path.resolve(__dirname, "../assets/tv-banner.png");
      const bannerDst = path.join(drawableDir, "tv_banner.png");

      if (fs.existsSync(bannerSrc)) {
        fs.copyFileSync(bannerSrc, bannerDst);
      } else {
        console.warn("withAndroidTV: tv-banner.png not found at", bannerSrc);
      }

      return config;
    },
  ]);

  // --- 2. Modify AndroidManifest.xml ---
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // --- 2a. Add <uses-feature> entries ---

    if (!manifest["uses-feature"]) {
      manifest["uses-feature"] = [];
    }

    const features = manifest["uses-feature"];

    const ensureFeature = (name, required) => {
      const exists = features.some(
        (f) => f.$?.["android:name"] === name
      );
      if (!exists) {
        features.push({
          $: {
            "android:name": name,
            "android:required": required,
          },
        });
      }
    };

    ensureFeature("android.software.leanback", "false");
    ensureFeature("android.hardware.touchscreen", "false");

    // --- 2b. Add LEANBACK_LAUNCHER to main activity intent-filter ---

    const application = manifest.application?.[0];
    if (!application) {
      console.warn(
        "withAndroidTV: No <application> found in AndroidManifest.xml"
      );
      return config;
    }

    // --- 2c. Add android:banner to <application> ---
    application.$["android:banner"] = "@drawable/tv_banner";

    // --- 2d. Leanback launcher category on main activity ---
    const activities = application.activity ?? [];
    const MAIN_ACTION = "android.intent.action.MAIN";
    const LEANBACK_CATEGORY = "android.intent.category.LEANBACK_LAUNCHER";

    for (const activity of activities) {
      const intentFilters = activity["intent-filter"] ?? [];

      for (const filter of intentFilters) {
        const actions = filter.action ?? [];
        const isMainFilter = actions.some(
          (a) => a.$?.["android:name"] === MAIN_ACTION
        );

        if (!isMainFilter) continue;

        // Found the main intent-filter — ensure LEANBACK_LAUNCHER category
        if (!filter.category) {
          filter.category = [];
        }

        const hasLeanback = filter.category.some(
          (c) => c.$?.["android:name"] === LEANBACK_CATEGORY
        );

        if (!hasLeanback) {
          filter.category.push({
            $: { "android:name": LEANBACK_CATEGORY },
          });
        }
      }
    }

    return config;
  });

  return config;
}

module.exports = withAndroidTV;
