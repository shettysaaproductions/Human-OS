module.exports = function (api) {
  api.cache(true);

  // babel-preset-expo is nested inside expo's own node_modules (not top-level),
  // so we must resolve it explicitly to avoid MODULE_NOT_FOUND.
  const babelPresetExpo = require.resolve('babel-preset-expo', {
    paths: [require.resolve('expo/package.json').replace('/package.json', '')],
  });

  return {
    presets: [babelPresetExpo],
    plugins: [
      // react-native-worklets/plugin is the Babel plugin for Reanimated 4.x
      // (replaces the old react-native-reanimated/plugin from v3 and below)
      // Must be listed LAST
      'react-native-worklets/plugin',
    ],
  };
};
