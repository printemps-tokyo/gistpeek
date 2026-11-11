# gistpeek

A Chrome side panel that reads the page you are looking at with the browser's
own on-device model, and shows you what it took away.

You write an article, you know what point it makes. What you cannot see is what
survives when something reads it in one pass and keeps a paragraph: an AI
search answer, a feed summary, a colleague skimming. gistpeek runs that pass
locally and puts the result next to the page, along with the boring structural
things that decide whether the page is quotable at all.

```
What the model takes away
  - 固定レイアウトEPUBはページごとにviewportを宣言する必要がある
  - 宣言がないとリーディングシステムが拡大縮小し、線画から崩れる

  > 固定レイアウトEPUBはページごとにviewportが要る。

  The point you wanted to land
  Intended: viewport宣言を忘れると入稿で落ちる
  Verdict:  missing
  Evidence: -

Checks                                      9/13 passed, 4 warning(s)
  ok    Structured data   BlogPosting with headline, author and both dates
  warn  Answer first      the opening paragraph starts with framing: "この記事では..."
  fail  Robots meta       the page asks not to be used: nosnippet
  warn  Outbound sources  no outbound links (7 internal)
```

The interesting line is the verdict. You type the one sentence you want a
reader to leave with, and the model says whether that sentence is in what it
took away -- kept, partial or missing, with the sentence that carries it. That
is a different question from "is this page optimized", and it is answerable.

## Everything stays on the device

Inference runs in the browser through Chrome's built-in APIs. The page text is
never uploaded, there is no API key, there is nothing to pay for, and it works
on an unpublished draft behind a login.

The one exception is explicit and opt-in: the AI crawler panel fetches
`robots.txt` and `llms.txt` from the site you are on, after asking for
permission for that origin. Nothing else touches the network.

## What it shows

1. What the model takes away. A short summary from the Summarizer API, then a
   reading from the Prompt API: the single takeaway, the questions the page
   actually answers, the facts worth quoting, and what a reader still has to
   look up elsewhere.
2. Whether your point survived. The verdict described above.
3. Thirteen deterministic checks. Structured data, author, dates, title,
   description, canonical, robots meta, language, heading outline, answer-first
   opening, question-shaped headings, extractable blocks (lists and tables),
   image alternatives, outbound sources and body length. These run with no
   model at all, so the panel is useful on a machine that cannot run one.
4. Who is allowed to read the site. robots.txt parsed per RFC 9309 rules
   (most specific group wins, longest path match wins, Allow breaks a tie) and
   reported for twelve named AI crawlers, plus whether `llms.txt` exists.

The whole report copies out as Markdown or saves as JSON.

## Requirements

- Chrome 138 or later. The Summarizer, Translator and Language Detector APIs
  became stable in Chrome 138, and the Prompt API is stable for extensions from
  the same version (on the open web it is stable from Chrome 148).
- The on-device model. Per the official documentation it is desktop-only and
  wants roughly 22 GB of free storage and 4 GB of VRAM or 16 GB of RAM. The
  model itself is a multi-gigabyte download.

If the model is missing, unavailable or still downloading, the panel says so in
the header and runs the deterministic checks anyway. That is the normal path on
plenty of machines, not an error state.

## Install

There is no store listing. Either take a release build or build it yourself,
then load it unpacked.

From a release: download `gistpeek-<version>.zip` and its `.sha256` from the
[Releases](https://github.com/printemps-tokyo/gistpeek/releases) page, then

```bash
shasum -a 256 -c gistpeek-<version>.zip.sha256
unzip gistpeek-<version>.zip -d gistpeek
```

From source:

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose Load unpacked
and select the unzipped `gistpeek/` directory (or `dist/` when built from
source). Chrome does not update an unpacked extension: to upgrade, replace the
directory's contents and press the reload button on the extension's card. Pin the icon; clicking it opens the panel, as
does Alt+Shift+G.

## Use

1. Open the article. Click the gistpeek icon.
2. Optionally type the point you want a reader to leave with.
3. Read this page.
4. Copy Markdown into the pull request, the editorial checklist or the draft.

## Limits, stated plainly

- The article body is found by heuristic: semantic containers first, then the
  densest block of paragraph text. The panel prints where it read from, and the
  body-length check tells you when that guess looks wrong. Images and text
  brought in by CSS or built by scripts after load are not seen.
- The model is small and local. It is good at lexical work -- summarizing,
  classifying, extracting -- and it is not a fact checker. Long pages are cut
  before it reads them (12,000 characters for the summary, 4,000 for the
  reading), and the panel says when that happened.
- The checks are about whether a page is easy to quote and easy to trust. They
  are not a ranking prediction, and nobody can honestly sell you one.
- Whether a given crawler obeys robots.txt is not something this tool can
  verify. It reports what the site asked for.

## Development

```bash
npm run typecheck   # tsc, no emit
npm test            # node --test over the compiled pure modules
npm run build       # dist/, loadable as an unpacked extension
npm run check       # all three
```

There is no bundler. Chrome runs ES modules in both the service worker and the
panel, so `tsc` plus a copy step is the whole build, and the two dev
dependencies are TypeScript and the Node type definitions.

The parts that can be tested without a browser are kept separate from the parts
that cannot: the checks, the robots.txt parser, the report writers and the
model-output normalizer are pure functions with tests. The injected page reader
is DOM-bound and is verified by hand against a real page.

## Sources

Written against the official documentation, read on 2026-08-29:

- [Built-in AI APIs](https://developer.chrome.com/docs/ai/built-in-apis) and
  their availability per Chrome version
- [Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api)
- [Prompt API for extensions](https://developer.chrome.com/docs/extensions/ai/prompt-api)
- [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [RFC 9309, Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)

## License

MIT. See [LICENSE](LICENSE).
