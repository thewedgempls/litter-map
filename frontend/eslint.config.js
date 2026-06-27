const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["litter-map.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        L: "readonly",
        firebase: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Top-level functions are called from inline HTML event handlers
      "no-unused-vars": ["error", {
        vars: "local",
        args: "after-used",
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    files: ["build.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },
];
