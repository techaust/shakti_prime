/* eslint-disable @typescript-eslint/no-require-imports, no-restricted-syntax -- Metro loads its config with require() in Node when it bundles; this file is build set-up, not app code, and reaches no fenced module. */
// Expo's Metro set-up for a pnpm workspace (it watches the repository and resolves the shared
// packages), with NativeWind compiling global.css against tailwind.config.js.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

module.exports = withNativeWind(getDefaultConfig(__dirname), { input: './global.css' });
