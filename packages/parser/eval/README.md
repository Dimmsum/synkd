# Parser eval harness (WF-022)

Runs one OpenRouter model with one prompt version over the eval set (WF-020), scores each sample against a hand-written expected draft, and saves the results so runs can be compared. It supports NFR-OPS-3 (parser changes are checked against the eval set) and FR-ADM-3 (accuracy per model and prompt), and it's what the WF-023 model spike runs on.

## Privacy first

The samples are real people's timetables, and this repo is public.

- Real samples live in **`evals/schedules/`** at the repo root (PRD §8.2). That folder is **gitignored**. Never commit anything from it, and never copy a sample into this folder.
- Results go to **`packages/parser/eval/results/`**, which is also gitignored. They hold sample ids and numbers only. The model's output (which contains titles) is stored only if you pass `--keep-output`.
- The only sample in git is `example/synthetic-week.png`, a made-up timetable.
- The CLI prints aggregate numbers only (NFR-SEC-11). Per-sample detail is in the result file.
- Only the file's extension goes to OpenRouter as a filename (`schedule.png`), never the sample's name.
- Requests use `provider.data_collection: "deny"` and, by default, `provider.zdr: true`, so they only go to providers that don't keep or train on prompts (NFR-SEC-8, WF-013). `--allow-non-zdr` relaxes the ZDR part only.
- Use neutral file names such as `uni/uwi-01.png` or `roster/retail-02.jpg`. Don't use people's names.
- Crop out names, ID numbers and photos before adding a file where you can (R12). Rooms and addresses can stay in the image, because the parser must learn to ignore them, but they never go in the expected file (D35).

## Adding samples

Each sample is two files side by side, with the same name:

```
evals/schedules/
├── uni/
│   ├── uwi-01.png
│   └── uwi-01.expected.json
├── roster/
│   ├── retail-01.pdf
│   └── retail-01.expected.json
└── photo-01.jpg
    photo-01.expected.json
```

- **Schedule file**: `.pdf`, `.png`, `.jpg`/`.jpeg`, `.webp`, or `.heic`/`.heif` (FR-IMP-1). No OpenRouter vision model takes HEIC, so HEIC samples are listed as `skipped` until you convert them. On macOS: `sips -s format jpeg photo.heic --out photo.jpg`. In production the upload step does this conversion (WF-024/WF-026).
- **Expected file** (`<name>.expected.json`): a `ParseDraft` from `@whosfree/shared`. It's validated with that same zod schema, with one convenience: `confidence` can be left out and defaults to 1. Unknown keys (e.g. a `notes` field) are ignored, and there is no location field (D35).
- **Sub-folders** are optional. The first folder name becomes the sample's **group** (e.g. `uni`, `school`, `roster`, `photo`), and results are broken down by group.
- Consent records (WF-020) can live in the same folder. Files that aren't schedules are ignored.

`example/synthetic-week.expected.json` shows every feature:

```json
{
  "events": [
    {
      "title": "SYN1001 Lecture",
      "category": "class",
      "start": "09:00",
      "end": "10:00",
      "when": { "kind": "weekly", "days": ["mon", "wed"], "pattern": { "type": "every" } }
    },
    {
      "title": "SYN1002 Lab",
      "category": "lab",
      "start": "10:00",
      "end": "12:00",
      "when": { "kind": "weekly", "days": ["tue"], "pattern": { "type": "alternating", "parity": "odd" } }
    },
    {
      "title": "SYN1003 Tutorial",
      "category": "tutorial",
      "start": "13:00",
      "end": "14:00",
      "when": { "kind": "weekly", "days": ["thu"], "pattern": { "type": "weeks", "weeks": [2, 3, 4, 5, 6] } }
    }
  ],
  "suggestedPeriod": {
    "start": "2026-09-07",
    "end": "2026-12-11",
    "exceptions": [{ "start": "2026-10-26", "end": "2026-10-30", "label": "Reading week" }]
  }
}
```

Writing expected files:

- `category` is one of `class`, `lab`, `tutorial`, `work`, `meeting`, `event`, `other`.
- Times are 24-hour `HH:MM` wall-clock times. For a night shift, `end` is earlier than `start`.
- Weekly events use `"kind": "weekly"`. Patterns are `every`, `alternating` (week A = `odd`, week B = `even`, D42) or `weeks` (explicit week numbers, week 1 = the week containing the period's start).
- Dated events (rosters) use `{ "kind": "date", "date": "YYYY-MM-DD" }`, one per date.
- An event on Mon and Wed can be written as one event with two days or as two events. Both score the same.
- Only add `suggestedPeriod` if the file shows the dates. If it doesn't, leave it out; a model that invents one is then marked wrong.
- Write titles the way a user would want them. Leave out rooms, lecturer names and ID numbers.

Check the set without spending anything (no API key needed):

```sh
pnpm --filter @whosfree/parser eval:check
```

It lists every problem at once: schedules without an expected file, expected files without a schedule, schema errors (by path, without quoting the file), and files whose contents don't match their extension. `eval` runs the same check before it makes any request.

## Running an eval

Put `OPENROUTER_API_KEY` in the root `.env` or export it in your shell. The CLI reads only that one variable from `.env`, and only for `eval`. Nothing else in the package reads the environment: `parseSchedule` takes the key as an argument, so the web app can't pick it up by importing the package (NFR-SEC-8). Then, from the repo root:

```sh
pnpm --filter @whosfree/parser eval --model google/gemini-2.5-flash --prompt v1
```

| Option | Default | |
|---|---|---|
| `--model <id>` | required | Any OpenRouter model id that takes images and structured output |
| `--prompt <version>` | `v1` | Loads `packages/parser/prompts/<version>.md` |
| `--samples <dir>` | `evals/schedules` | Relative paths resolve from where you ran the command. Try `--samples packages/parser/eval/example` for a first smoke run. |
| `--out <dir>` | `packages/parser/eval/results` | |
| `--concurrency <n>` | 4 | Requests in flight |
| `--timeout <seconds>` | 120 | Per request, including reading the response |
| `--pdf-engine <name>` | OpenRouter's default | `native` (model reads the PDF, billed as input tokens), `mistral-ocr` (billed per page), or `cloudflare-ai` (free text extraction). Record which one you used. |
| `--strict-schema` | off | Sets `strict: true` on the JSON schema. Some providers reject our schema in strict mode; zod validates either way. |
| `--allow-non-zdr` | off | Also routes to endpoints without zero data retention |
| `--keep-output` | off | Saves each validated model output (with titles) in the result file, for debugging |

The run prints a summary table and writes `packages/parser/eval/results/<timestamp>-<model>-<prompt>.json`.

There are no retries and no fallback models: each sample gets exactly one request, so failures show up in the numbers. The production pipeline adds retries (WF-027).

## Comparing runs

```sh
# The two newest result files (older = A, the baseline)
pnpm --filter @whosfree/parser eval:compare

# Or two specific files
pnpm --filter @whosfree/parser eval:compare packages/parser/eval/results/A.json packages/parser/eval/results/B.json
```

This prints every metric for A and B with the change and whether it's better or worse, then each sample's edit count in both runs. It warns when the runs used different samples, or when the same prompt version has different text (the file was edited without bumping the version).

## Adding a prompt version

Copy `packages/parser/prompts/v1.md` to `v2.md` and change it. Don't edit a version that has results you still compare against: each result records the prompt's SHA-256, and `compare` warns when they differ.

## What gets scored

Scoring is in `src/eval/scoring.ts`. Keep this section in sync with it.

**Units.** Each event is split into one unit per day: a weekly event on Mon and Wed is two units, `w:mon` and `w:wed`. A dated event is one unit keyed by its date, `d:2026-10-05`. Counting units means "one event on two days" and "two events on one day each" score the same.

**Matching.** A predicted unit can only match an expected unit with the same key (same weekday, or same date; a weekly event never matches a dated one). The pair must also have either:

- similar titles (similarity ≥ 0.5), or
- start and end both within ±5 minutes.

Allowed pairs are then taken greedily, best score first. The score is title similarity + time closeness (1 − (|Δstart| + |Δend|) / 240 min, floored at 0), plus 0.1 for the same category and 0.1 for the same week pattern. Each unit is used at most once.

**Title similarity** (0–1): 1 if the titles are equal after lower-casing and removing accents and punctuation. 0.9 if every word of one title appears in the other, and it either covers at least half the words or includes a course code (letters and digits together, e.g. `COMP1161`). Otherwise, the Sørensen–Dice coefficient of their character bigrams.

**Metrics per sample:**

| Metric | Definition |
|---|---|
| Event recall | matched units / expected units (1 if nothing was expected) |
| Event precision | matched units / predicted units (1 if nothing was predicted) |
| F1 | harmonic mean of recall and precision |
| Time exact | matched units with start and end both exactly right |
| Time ±5 min | matched units with start and end both within 5 minutes |
| Week pattern | matched weekly units with an equal pattern (`every`, the same parity, or the same set of week numbers) |
| Date range | `suggestedPeriod` start and end both equal, or both absent |
| Exceptions | matched on equal start and end (labels ignored), with recall and precision |

**Edits** estimate how many changes a user would make on the review screen (FR-IMP-11). An edit is an add, a delete or a field change:

- **Add**: each expected event with at least one unmatched day costs 1 (add the event, or add the missing day to it).
- **Delete**: each predicted event with at least one unmatched day costs 1 (delete it, or remove the extra day).
- **Field change**: for each matched (predicted event, expected event) pair, 1 per wrong field. The fields are title (similarity < 0.9), category, start, end and week pattern.
- **Period**: 1 if the date range is wrong or missing, plus 1 per missing or extra exception. If the file shows no dates but the model suggested some, removing them costs 1 in total.

A sample is **acceptable** when it needs **≤ 3 edits**. **Acceptance** is the share of acceptable samples, which estimates PRD §10's "parse acceptance" (target ≥ 70%). A wrong day counts as a delete plus an add, and a title that's wrong at the same time as a time more than 5 minutes off does too, so the estimate leans pessimistic.

**Failed parses** (HTTP error, timeout, invalid JSON, output that fails the schema) are scored as an empty draft, so they count against recall and acceptance. Skipped samples (HEIC) aren't scored.

**Aggregates.** Event recall, precision and F1 are micro-averaged over all units. Macro F1 is the mean of the per-sample F1s, so one large timetable can't dominate. Time and pattern rates are over all matched units. Acceptance, date range accuracy and mean/median edits are per sample. Metrics with nothing to measure are `null`, shown as `–`.

**Cost and latency.** Cost is `usage.cost` from OpenRouter's response: the USD credits charged, which OpenRouter includes on every response. Failed parses still cost money, so they're included. Latency is wall-clock time from sending the request to reading the whole response. The summary gives the total, mean and max cost per sample, and the mean, p50, p95 (nearest rank) and max latency. For NFR-PERF-4 (p95 ≤ 60 s from upload to review), remember that the real pipeline adds upload, conversion and queueing on top.

## Result file

`EvalResult` in `src/eval/results.ts` is the schema, and `compare` validates files against it. The top-level keys are:

- `formatVersion`: currently 1.
- `createdAt`.
- `run`: the model, prompt version and SHA-256, concurrency, timeout, PDF engine, ZDR, strict and keep-output settings.
- `summary`: sample counts, failures by kind, the aggregate `scores`, `cost`, `latency`, and `byGroup` (acceptance and F1 per group).
- `samples[]`: for each sample, its id, group, file type and size, status (`ok`, `failed` or `skipped`), error (`kind`, safe `message`, HTTP `status`, and schema issue paths), latency, usage (cost and tokens), OpenRouter generation id, served model, provider, finish reason, and the full `score`. `output` is only there with `--keep-output`.
