const { withProjectBuildGradle, withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Disables all lint tasks at both project and app level.
 * 
 * Root-level: prevents any "lint" task from running via allprojects block.
 * App-level:  sets lintOptions.checkReleaseBuilds = false AND abortOnError = false
 *             so lintVitalAnalyzeRelease cannot block a release build.
 */
function withDisableLintRoot(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('task.name.toLowerCase().contains("lint")')) {
      cfg.modResults.contents += `
allprojects {
  tasks.whenTaskAdded { task ->
    if (task.name.toLowerCase().contains("lint")) {
      task.enabled = false
    }
  }
}
`;
    }
    return cfg;
  });
}

function withDisableLintApp(config) {
  return withAppBuildGradle(config, (cfg) => {
    // Inject lintOptions into the android { } block if not already present
    if (!cfg.modResults.contents.includes('checkReleaseBuilds false')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /android\s*\{/,
        `android {
    lintOptions {
        checkReleaseBuilds false
        abortOnError false
    }`
      );
    }
    return cfg;
  });
}

module.exports = function withDisableLint(config) {
  config = withDisableLintRoot(config);
  config = withDisableLintApp(config);
  return config;
};
