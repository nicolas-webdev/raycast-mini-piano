# AGENTS.md

## Job

Mini Piano is a macOS-only Raycast extension with one view command, `piano` (`src/piano.tsx`): typing in the search field plays notes.
Stack: TypeScript (strict, CommonJS) + React via `@raycast/api`, ESLint (`@raycast/eslint-config`), Prettier (120 cols, double quotes), pnpm.

Sound comes from `assets/helper.swift`, an AVAudioEngine synth compiled with `xcrun swiftc` on first launch (`src/engine.ts`).
If that fails, `src/synth.ts` renders WAVs played with `afplay`. Other modules: `src/hold.ts` (key-repeat sustain), `src/keymap.ts`, `src/tiles.ts`.

Install (pnpm, lockfile `pnpm-lock.yaml`; `pnpm-workspace.yaml` allows the esbuild build script):

```sh
pnpm install --frozen-lockfile
```

## Rules

- Never run `pnpm publish` / the `publish` script (`npx @raycast/api@latest publish`): it submits to the Raycast Store.
- Use pnpm only; don't add `package-lock.json` or `yarn.lock`. Commit `pnpm-lock.yaml` changes together with `package.json` changes.
- Bump `HELPER_VERSION` in `src/engine.ts` when `assets/helper.swift` changes, and `SYNTH_VERSION` in `src/synth.ts` when the fallback WAV synthesis changes.
- Don't edit or commit generated files: `dist/` and `raycast-env.d.ts` are gitignored.
- The extension must not change the user's macOS settings (e.g. `ApplePressAndHoldEnabled`); the README only documents them.
- Keep the README's key table and preferences in sync with `src/keymap.ts` and `package.json`.
- No secrets, tokens, phone numbers, DB URLs or env values in any file or PR.

## Skills

- `pnpm dev` runs `ray develop`; it needs the Raycast app on a Mac, so it can't run in a headless sandbox.
- `pnpm fix-lint` runs `ray lint --fix` (ESLint + Prettier autofix).
- `node scripts/make-icon.mjs` regenerates `assets/extension-icon.png` (no dependencies).
- The compiled helper can render offline: `helper --render out.wav < commands.txt`, with `wait <ms>` lines (macOS only).

## Verification

```sh
pnpm install --frozen-lockfile && pnpm lint && pnpm build && npx tsc --noEmit
```

There is no test script and no test files. There is no CI in this repo.
`pnpm install` needs the npm registry unless the pnpm store is already warm; `ray lint` and `ray build` passed here with network available, but offline runs were not verified.
