# Node profile — sample-project validation

This example shows how to validate the generic Node profile without coupling the template to a specific product.

## Create a temporary sample

```bash
TMP=$(mktemp -d)
cp profiles/node/eslint.config.mjs profiles/node/prettier.config.mjs profiles/node/.editorconfig profiles/node/.prettierignore "$TMP"/
cp profiles/node/package.example.json "$TMP/package.json"
mkdir -p "$TMP/src"
printf "export function hello(name) {\n    return \`hello \${name}\`;\n}\n" > "$TMP/src/index.js"
cd "$TMP"
npm install --silent
npm run lint
npm run format:check
```

Expected:
- `npm run lint` passes on the clean sample.
- `npm run format:check` initially reports formatting changes for the intentionally unformatted file; `npm run format` then makes it pass.

## Negative checks

- Introduce an unused variable: lint must fail.
- Introduce a double-quoted string/tab indentation: format check must fail until formatted.

## Notes

- The package example is a **template**; merge its scripts/devDependencies rather than overwriting an existing project's package.json.
- Do not commit the temporary sample or its `node_modules`.
- Record profile validation evidence on the task/PR when changing profile files.
