const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

const root = path.resolve(__dirname, "../..");
const sharedPackage = path.resolve(__dirname, "../shared");
const hostNodeModules = path.resolve(__dirname, "node_modules");

const resolvePackage = (name, searchPaths) => {
  for (const searchPath of searchPaths) {
    const candidate = path.resolve(searchPath, name);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  return path.resolve(searchPaths[0], name);
};

const couchKitHostPath = resolvePackage("@couch-kit/host", [
  hostNodeModules,
  path.resolve(root, "node_modules"),
]);
const couchKitHostNodeModules = path.resolve(couchKitHostPath, "../..");
const couchKitCorePath = resolvePackage("@couch-kit/core", [
  couchKitHostNodeModules,
  hostNodeModules,
  path.resolve(root, "node_modules"),
]);

config.watchFolders = [root, sharedPackage, couchKitHostPath, couchKitCorePath];

config.resolver.nodeModulesPaths = [
  hostNodeModules,
  path.resolve(root, "node_modules"),
  couchKitHostNodeModules,
];

config.resolver.unstable_enableSymlinks = true;

// Resolve real paths for critical singleton packages to prevent duplicates.
// Bun's .bun/ cache can contain multiple versions (e.g. react@18.3.1 AND react@19.1.0).
// Without this, react-native's internal modules may resolve to the wrong React copy.
const singletonSearchPaths = [hostNodeModules, path.resolve(root, "node_modules")];
const reactPath = resolvePackage("react", singletonSearchPaths);
const reactNativePath = resolvePackage("react-native", singletonSearchPaths);

const singletonPackages = {
  react: reactPath,
  "react-native": reactNativePath,
  "react/jsx-runtime": reactPath + "/jsx-runtime",
  "react/jsx-dev-runtime": reactPath + "/jsx-dev-runtime",
};

config.resolver.extraNodeModules = {
  "@card-engine/shared": sharedPackage,
  "@couch-kit/host": couchKitHostPath,
  "@couch-kit/core": couchKitCorePath,
  ...singletonPackages,
};

// Force singleton resolution for react/react-native from ANY location in the dependency tree.
// extraNodeModules only applies when the normal resolution fails — this interceptor
// ensures that even react-native's internal require("react") resolves to React 19.
const { resolve } = config.resolver;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (singletonPackages[moduleName]) {
    return {
      type: "sourceFile",
      filePath: require.resolve(singletonPackages[moduleName]),
    };
  }
  // Fall through to default resolution
  if (resolve) return resolve(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

// ─── Production Optimizations ──────────────────────────────────────
// Enable inline requires for faster cold start on low-powered TV devices.
// Strip console.* calls from production bundles.
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

config.transformer.minifierConfig = {
  compress: {
    drop_console: true,
  },
};

module.exports = config;
