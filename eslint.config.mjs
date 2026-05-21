// @ts-check
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The destructure-to-omit idiom (`const { x, ...rest } = obj`) is used in the
      // tests to drop a key; ignoreRestSiblings keeps it from tripping no-unused-vars.
      // `_`-prefixed names are also treated as intentionally unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Must be last: turns off ESLint rules that would conflict with Prettier.
  eslintConfigPrettier,
);
