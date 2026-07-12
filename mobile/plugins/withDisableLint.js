const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withDisableLint(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('task.name.toLowerCase().contains("lint")')) {
      config.modResults.contents += `
allprojects {
  tasks.whenTaskAdded { task ->
    if (task.name.toLowerCase().contains("lint")) {
        task.enabled = false
    }
  }
}
`;
    }
    return config;
  });
};
