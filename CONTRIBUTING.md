# Contributing

Thanks for your interest in contributing to gistpeek.

## Development

1. Fork / clone the repository
2. Install Node 22 or later and run `npm install`
3. Create a branch: `git switch -c feat/your-change`
4. Verify locally:
   ```bash
   npm run check
   ```
5. Load `dist/` as an unpacked extension and try the change on a real page
6. Commit and open a pull request

## Ground rules

- Nothing leaves the device. Inference is the browser's built-in model, and the
  only network request in the codebase is the opt-in robots.txt and llms.txt
  fetch for the origin the user is already on. A change that adds a remote
  model, an analytics ping or a crash reporter is not a change to this project.
- The panel works without a model. The deterministic checks render before any
  model work starts and never depend on it. Every new feature has to answer
  what it shows on a machine where the model is unavailable.
- Checks report evidence before advice. State what was found, quote it, then
  say what to change. No scores out of a hundred, and no claim about search
  rankings that nobody can verify.
- Model output is untrusted input. It arrives schema-constrained and is still
  normalized before it reaches the UI: unknown values fall back, lists are
  capped, and malformed output is an error the user sees rather than a
  half-rendered panel.
- Keep the build boring. No bundler, no framework, two dev dependencies. If a
  change needs a third, say in the PR what it buys.

## Tests

`npm test` compiles the tree and runs `node --test` over the parts that are
pure: the checks, the robots.txt parser, the report writers and the model-output
normalizer. Add tests there.

`npm run e2e` loads the built `dist/` into Chromium: the side panel has to load
and explain a page it cannot read, and the injected page reader has to read a
local test article (it runs in the page directly, since activeTab is only
granted by a click on the toolbar button). It needs Playwright's Chromium once
(`npx playwright install chromium`), or another Chromium build named by
`E2E_CHROMIUM`; CI runs it on every push. That article is one page, so changes
to the page reader still need a note in the PR saying which real pages you ran
it against and what came back.
