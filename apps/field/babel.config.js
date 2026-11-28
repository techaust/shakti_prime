// Expo's preset with NativeWind's class names (docs/08-design-system.md tokens through
// tailwind.config.js), and the decorators WatermelonDB's models are written with (ADR 0012).
module.exports = function config(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [['@babel/plugin-proposal-decorators', { legacy: true }]],
  };
};
