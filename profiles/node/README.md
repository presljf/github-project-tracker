# Node profile (generic)

A reusable Node >=22 lint/format baseline for projects adopting the Project Tracker OS.

This profile is **generic**. It is not CastDeck-specific; the pilot example lives in `examples/` and only shows overrides.

## Files

| File | Purpose |
|---|---|
| `eslint.config.mjs` | Flat ESLint 9 config: recommended + pragmatic correctness rules, Node globals, ignore dirs |
| `prettier.config.mjs` | Prettier style: print width 100, single quotes, semicolons, trailing commas, LF |
| `.editorconfig` | Basic editor consistency (UTF-8, LF, 2-space, final newline) |
| `.prettierignore` | Generated/vendor/lockfile ignores |
| `package.example.json` | Reference scripts/devDependencies — **merge, do not blindly overwrite** |

## Apply to a project

1. Copy `eslint.config.mjs`, `prettier.config.mjs`, `.editorconfig`, `.prettierignore` into the project root.
2. Merge the `scripts` and `devDependencies` from `package.example.json` into the project's `package.json`.
   - Do **not** overwrite the project's existing name/version/license/other deps.
   - Install with the project's package manager (npm/pnpm/yarn).
3. Run the local parity commands:
   ```bash
   npm run lint
   npm run format:check
   ```
4. Fix violations / format the codebase in a dedicated task (implementation belongs to the adopting project).
5. Add overrides only for real project needs; document them in the project's tracker config.

## Overrides

### Browser code
The base profile uses Node globals. For browser bundles, add a config entry in `eslint.config.mjs`:

```js
import globals from 'globals';

export default [
  // ...base config...
  {
    files: ['src/web/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
```

### Style
Change `printWidth`/quotes only deliberately. Formatting changes should be isolated in their own commit/task so review stays readable.

### Ignore paths
Add generated/vendor/build paths to the ignores in `eslint.config.mjs` and `.prettierignore`. Keep lockfiles and generated server/build output out of formatting.

## Command mapping

| Workflow need | Script |
|---|---|
| lint | `npm run lint` / `lint:fix` |
| format check | `npm run format:check` |
| format write | `npm run format` |
| tests | project-defined (`npm test`) |
| verify | project-defined (`npm run verify`) |
| build | project-defined (`npm run build`) |

## Validation

`node --check` validates the JS/MJS config syntax. A real sample-project validation is documented in `examples/node-profile/README.md`; run it before claiming profile changes work.

## Compatibility

- Node >=22 (ESLint 9 flat config, ESM).
- Projects on older Node must pin compatible ESLint/Prettier versions and document the deviation.
- This profile does not include TypeScript; TypeScript projects should extend with `typescript-eslint` and keep the same scripts/override model.
