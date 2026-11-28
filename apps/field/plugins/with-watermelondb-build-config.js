/* eslint-disable @typescript-eslint/no-require-imports, no-restricted-syntax -- Expo loads config plugins with require() in Node during prebuild; this file is build set-up, not app code, and reaches no fenced module. */
// WatermelonDB 0.28's Android library reads BuildConfig.DEBUG, which the Android Gradle Plugin 9
// no longer generates for a library unless it asks (buildFeatures.buildConfig), and the old
// project-wide switch is gone. This config plugin turns it on for that one library when
// `expo prebuild` writes the Android project (the CI job "Field app native build", 28-11-2026).
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARK =
  '// Shakti Field: BuildConfig for WatermelonDB (plugins/with-watermelondb-build-config.js)';

module.exports = function withWatermelonDbBuildConfig(config) {
  return withProjectBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== 'groovy') {
      throw new Error('with-watermelondb-build-config expects the Groovy build.gradle');
    }
    if (!gradle.modResults.contents.includes(MARK)) {
      gradle.modResults.contents += `
${MARK}
subprojects { project ->
  if (project.name == 'nozbe_watermelondb') {
    project.plugins.withId('com.android.library') {
      project.android.buildFeatures.buildConfig = true
    }
  }
}
`;
    }
    return gradle;
  });
};
