// eslint.config.mjs
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import js from "@eslint/js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize FlatCompat for backward compatibility with .eslintrc-style configs
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

// Export the flat configuration array
export default [
    // Global ignores (replacing globalIgnores and .eslintignore)
    {
        ignores: ["**/node_modules/", "**/main.js"],
    },

    // Base JavaScript recommended config
    js.configs.recommended,

    // Compatibility with legacy extends
    ...compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:@typescript-eslint/recommended"
    ),

    // Main configuration object
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
        },

        languageOptions: {
            globals: {
                ...globals.node,
            },
            parser: tsParser,
            ecmaVersion: 5,
            sourceType: "module",
        },

        rules: {
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
            "@typescript-eslint/ban-ts-comment": "off",
            "no-prototype-builtins": "off",
            "@typescript-eslint/no-empty-function": "off",
        },
    },
];