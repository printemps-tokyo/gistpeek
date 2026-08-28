# Contributing

Thanks for your interest in contributing to gistpeek.

## Development

1. Fork / clone the repository
2. Install Node 20 or later and run `npm install`
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
normalizer. Add tests there. The injected page reader touches the DOM and is not
covered by that suite -- changes to it need a note in the PR saying which real
page you ran it against and what came back.
