# WF-024 spike: Vercel functions vs Railway worker

- **Issue:** WF-024 (PRD §8.1, D6, R8)
- **Date:** 2026-09-30 (Vercel and Supabase docs checked on this date)
- **Status:** prototype and local measurements done. The on-Vercel check is waiting for the owner to connect the repo (see [§10](#10-owner-verification-checklist)).
- **Recommendation:** **drop the Railway worker.** Do the file conversion and the OpenRouter call on the Next.js server on Vercel. Confidence: **medium-high**, and it becomes high once the §10 checklist passes on a real deployment.

## 1. Question

PRD §8.1 keeps a Railway worker (`apps/worker`, Hono) only because "PDF rendering and HEIC conversion need native libraries … and AI parse jobs can run long". The question: **can a Vercel Node function on the Next.js server turn every allowed upload into images a vision model can read, within Vercel's limits?** If it can, the worker, its HMAC channel and a second deploy target all go away (R8).

The conversion has to do this (FR-IMP-1, NFR-PERF-6):

| Input | Must become |
|---|---|
| PDF, up to 5 pages, up to 10 MB | one JPEG per page, long edge ≤ 2000 px |
| HEIC (iPhone photos: 12 MP, up to 48 MP) | one JPEG, long edge ≤ 2000 px |
| JPEG / PNG / WebP | already compressed on the device. The server resizes only as a fallback |

## 2. Options considered

### PDF → image

| Engine | How it runs | Vercel fit | Licence | Verdict |
|---|---|---|---|---|
| **PDFium as WASM** (`@hyzyla/pdfium` 2.1.13) | Chrome's PDF engine compiled to WASM (4.0 MB `.wasm`) | Pure WASM, no binary. Turbopack emits the `.wasm` as a traced asset automatically | MIT (PDFium: BSD/Apache) | **Chosen.** Fastest in every test, and it can also extract text (`page.getText()`) |
| MuPDF as WASM (`mupdf` 1.28.1) | Official Artifex WASM build (10 MB `.wasm`) | Works | **AGPL-3.0** | Rejected. The AGPL's network clause would cover the hosted app. It was also 2–7× slower than PDFium here |
| `pdfjs-dist` 5.6 + `@napi-rs/canvas` | Mozilla's JS renderer with a Skia canvas | Native prebuilt `.node` (35 MB on linux-x64), which Vercel supports | Apache-2.0 / MIT | Rejected. It decodes embedded JPEGs in JS, so it's about 11× slower on scanned PDFs. It also needs the exact `@napi-rs/canvas` version it pins (1.x breaks `Path2D` with `InvalidArg`), plus `standardFontDataUrl` wiring |
| poppler / Ghostscript / ImageMagick CLIs | System binaries | Not on Vercel's image. We'd have to ship them ourselves ("custom binaries") | GPL / AGPL | Rejected. This is exactly what the worker existed for |

### HEIC → image

| Engine | Vercel fit | Licence | Verdict |
|---|---|---|---|
| sharp's prebuilt libvips | Works on Vercel (Next uses it for `next/image`) | Apache-2.0 / LGPL | **Can't decode HEIC.** The prebuilt covers JPEG, PNG, WebP, AVIF, TIFF, GIF and SVG, and HEVC-coded HEIC is left out because of patents. Measured: `sharp(heic)` fails with `bad seek`. |
| **libheif as WASM** (`heic-decode` 2.1.0 → `libheif-js` 1.23.2 `wasm-bundle`) | Pure WASM, embedded in JS (a 2 MB chunk) | ISC wrapper; libheif/libde265 are **LGPL-3.0** | **Chosen**, with sharp doing the resize and JPEG encode. We use the library unmodified on the server and don't distribute it, so LGPL has no practical effect. Keep its licence notice anyway |
| `heic-convert` | Same decoder, but encodes JPEG in pure JS | ISC | Rejected. Slower, and sharp is there anyway |
| libvips built with libde265 | A custom native binary | LGPL + HEVC patent exposure | Rejected. It's a custom binary |

**Client side first.** iOS Safari usually turns HEIC into JPEG when a web page asks for a photo, and Safari can draw HEIC to a canvas, so NFR-PERF-6's on-device compression covers most iPhone uploads. Chrome and Android can't decode HEIC, so a HEIC file picked from Files or a desktop still reaches the server. The server path is a **fallback**, but it's needed.

### Resize / encode

**sharp** 0.35.5, using its prebuilt libvips for linux-x64/arm64 (glibc ≥ 2.28, which Vercel's Amazon Linux 2023 image meets). Next.js lists `sharp` as a default server-external package, so it's traced into the function as-is.

## 3. Prototype

All the spike code is marked `SPIKE (WF-024)`:

| File | What it is |
|---|---|
| `apps/web/src/spike/wf-024/convert.ts` | `convertUpload(bytes)`: sniffs magic bytes, rejects PDFs over 5 pages and files over 10 MB, and turns PDF, HEIC, JPEG, PNG or WebP into JPEGs with a long edge ≤ 2000 px. The WASM engines load lazily and are cached per instance, and `initMs` reports the cold-start cost. |
| `apps/web/src/app/api/spike/wf-024/route.ts` | A Node-runtime route handler (`maxDuration = 60`). `POST` takes the file as the body. `GET ?src=<https URL>` fetches a file of up to 10 MB, standing in for "read from Supabase Storage". `&page=N` returns that page's JPEG. Both return JSON metrics (timings, `process.memoryUsage`, peak RSS, node, arch and region). |
| `apps/web/src/spike/wf-024/convert.test.ts` + `fixtures/tiny.{pdf,heic}` (6 KB) | Vitest: both WASM engines load and convert in plain Node (Node 20 in CI, Node 24 locally). |
| `apps/web/scripts/spike-wf-024/fixtures.ts` | Generates synthetic timetables: vector PDFs of 1, 5 and 6 pages, a 5-page "scanned" PDF made of five distinct 12 MP photos (6.2 MB), 12 MP and 48 MP JPEGs, and HEICs via macOS `sips`. No personal data. |
| `apps/web/scripts/spike-wf-024/bench.ts` | Runs each case in a fresh Node process (so peak RSS is clean), timing one cold run and three warm rounds, optionally 3 at once. |

**Gate.** The route returns 404 unless `NODE_ENV !== 'production'` (`next dev`), or `SPIKE_WF024_TOKEN` is set and the request sends the same value in `x-spike-token`, compared in constant time. A production deploy without the variable exposes nothing. `?src=` accepts only `https:`, refuses redirects and caps the body at 10 MB. Logs contain no file data (NFR-SEC-11).

Run it locally:

```sh
cd apps/web
node scripts/spike-wf-024/fixtures.ts        # Node ≥ 22.18 (type stripping)
node scripts/spike-wf-024/bench.ts
pnpm test src/spike
```

## 4. Measurements (local)

**Machine:** Apple M1 (4 performance + 4 efficiency cores), 8 GB, macOS, Node 24.10.0.

**Caveat:** the machine was shared with other heavy jobs during the spike (load average 8–25 on 8 cores). Wall times varied up to about 5× between runs. The tables show the **lightest-load run (A)** and a **heavily contended run (B)**. B mostly ran on efficiency cores, so it's a reasonable pessimistic stand-in for one Vercel vCPU. Treat A as the floor and B as the ceiling until §10 gives real numbers.

### 4.1 Converter (bench.ts, warm = best of 3)

| File | Conc. | Input | Output | Cold ms (init) A | Warm ms A | Warm ms B | Peak RSS MB A / B |
|---|---|---|---|---|---|---|---|
| vector-1p.pdf | 1 | 2 KB | 1413×1997 | 75 (21) | 23 | 446 | 233 / 134 |
| vector-5p.pdf | 1 | 10 KB | 5 × 1413×1997, 566 KB | 203 (17) | 138 | 1 245 | 283 / 177 |
| vector-6p.pdf | 1 | 12 KB | rejected: "PDF has 6 pages; the limit is 5" | | | | 111 / 89 |
| scan-5p.pdf | 1 | 6.2 MB | 5 × 1413×1997, 1.7 MB | 1 031 (25) | 964 | 13 747 | 335 / 155 |
| scan-5p.pdf | 3 at once | 6.2 MB | same | 1 033 (18) | 2 470 (all 3) | 17 120 (all 3) | 492 / 281 |
| photo-12mp.jpg | 1 | 3.4 MB | 2000×1500 | 74 | 71 | 290 | 185 / 141 |
| photo-48mp.jpg | 1 | 7.3 MB | 2000×1500 | 129 | 128 | 407 | 174 / 163 |
| photo-12mp.heic | 1 | 2.9 MB | 2000×1500, 332 KB | 960 (38) | 763 | 2 969 | 333 / 274 |
| photo-12mp.heic | 3 at once | 2.9 MB | same | 829 (31) | 2 272 (all 3) | 4 701 (all 3) | 515 / 422 |
| photo-48mp.heic | 1 | 7.2 MB | 2000×1500, 236 KB | 2 787 (34) | 3 338 | 8 526 | 580 / 522 |
| photo-48mp.heic | 3 at once | 7.2 MB | same | 6 762 (52) | 12 032 (all 3) | 66 989 (all 3, load avg 31) | 602 / 484 (1 001 in a third run) |

- **CPU time** (run B, `process.cpuUsage`, the thing Vercel bills as Active CPU): scan-5p ≈ 3.7 s, 48 MP HEIC ≈ 7.8–8.8 s and 12 MP HEIC ≈ 1.7–2.7 s per file, even under contention. Wall time in B is inflated by waiting for a core; CPU time is the better estimate of what one dedicated vCPU needs. Run A's wall times are about the uncontended CPU times.
- **Cold start** (loading and instantiating WASM) costs **20–110 ms for PDFium** and **30–160 ms for libheif**. It's negligible.
- **Memory is outside the V8 heap.** Nearly all of it is WASM linear memory plus sharp's native buffers (`external`/`arrayBuffers`). The worst cases still finish with `--max-old-space-size=128`, so heap flags don't matter. RSS is the number to compare with Vercel's 2 GB. **Worst single file: about 580–780 MB (48 MP HEIC). Worst measured with 3 at once: about 1.0 GB.** Every other case stays under 550 MB.
- The page cap works (6 pages rejected), and PDFs render at 1413×1997 for A4, about 171 dpi, which suits vision models.

### 4.2 Alternative PDF engines (same fixtures and machine, warm, a throwaway harness that isn't committed)

| Engine | vector-5p | scan-5p | Peak RSS |
|---|---|---|---|
| **PDFium WASM** (chosen) | **138 ms** | **964 ms** | 283–335 MB |
| MuPDF WASM | 1 012–2 557 ms | 2 742–7 667 ms | 117–192 MB |
| pdf.js + @napi-rs/canvas | 602 ms | 11 125 ms | 216–390 MB |

### 4.3 Inside Next.js (`next build` + `next start`, Turbopack, production mode)

Same machine, run B-level load, curl against `/api/spike/wf-024`:

| Request | totalMs | Notes |
|---|---|---|
| No token | HTTP 404 | The gate works in production mode |
| scan-5p.pdf (cold) | 3 401 | `initMs` 82 |
| scan-5p.pdf (warm, 4 runs) | 1 445–2 602 | |
| photo-12mp.heic (cold / warm) | 1 872 / 2 369–2 438 | `initMs` 146 |
| photo-48mp.heic | 6 293 | Process RSS after the whole sequence: **583 MB** |
| vector-6p.pdf | HTTP 400 | "PDF has 6 pages; the limit is 5" |
| vector-5p.pdf `?page=2` | HTTP 200 `image/jpeg` | Checked visually |

This confirms the bundled build works: Turbopack emitted `pdfium.<hash>.wasm` as a server asset and traced it, libheif is inlined in a 2 MB chunk, and sharp is external.

### 4.4 Function size (from `.next/server/app/api/spike/wf-024/route.js.nft.json`)

| | Traced size |
|---|---|
| Spike route (darwin-arm64 build) | **27.2 MB**: libvips 18.2 MB, pdfium.wasm 4.0 MB, libheif chunk 2.0 MB, route and runtime chunks about 3 MB |
| A normal page (`/now`) for comparison | 3.0 MB |
| On Vercel (linux-x64) | about the same: `@img/sharp-libvips-linux-x64@1.3.4` is 18.7 MB unpacked and `@img/sharp-linux-x64` is 0.4 MB |

So the conversion adds **about 25 MB against a 250 MB limit** (about 10 %). The pdf.js route would add another 35 MB of Skia, and MuPDF 10 MB of WASM.

## 5. Vercel limits (checked 2026-09-30)

Sources: [Functions limits](https://vercel.com/docs/functions/limitations), [Duration](https://vercel.com/docs/functions/configuring-functions/duration), [Memory](https://vercel.com/docs/functions/configuring-functions/memory), [Fair use / Hobby allotments](https://vercel.com/docs/limits/fair-use-guidelines), [Limits (legacy non-fluid durations)](https://vercel.com/docs/limits), [@vercel/functions `waitUntil`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Bypassing the 4.5 MB body limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions), [Build image (Amazon Linux 2023)](https://vercel.com/docs/deployments/build-image/build-image).

| Limit | Hobby | Pro | What we need |
|---|---|---|---|
| Max duration (fluid compute, the default for new projects) | 300 s default and max | 300 s default, 800 s max (1 800 s beta) | Conversion is ≤ about 10 s pessimistic. Conversion plus one LLM attempt is about 15–70 s. **Fits Hobby.** |
| Max duration **without** fluid compute (legacy projects) | 10 s default, 60 s max | 15 s / 300 s | Make sure fluid compute is **on** (§10) |
| Memory / CPU | 2 GB / 1 vCPU, fixed | 2 GB / 1 vCPU default, 4 GB / 2 vCPU option | Worst single conversion is about 0.8 GB, about 1 GB for three at once. **Fits**, with headroom that §8 protects |
| Bundle size (uncompressed) | 250 MB (up to 5 GB "large functions" beta) | same | +25 MB |
| Request **and response** body | **4.5 MB** (413 `FUNCTION_PAYLOAD_TOO_LARGE`) | same | Uploads are up to 10 MB, so **they can't go through a function** (§6) |
| Native code | Full Node API. Prebuilt linux-x64 `.node` addons work (sharp). No system poppler/libheif | same | Only sharp is native, and it's supported |
| File descriptors | 1 024 shared per instance | same | Not a concern |
| Hobby monthly allotment | 4 h Active CPU, 360 GB-h provisioned memory, 1 M invocations | usage-based | At 2–10 s CPU per parse, that's about 1 500–7 000 parses a month before other traffic. Enough for Milestone A |
| Commercial use | **Hobby is non-commercial only** | Pro needed for commercial use | whosfree has no monetisation (D16). The owner should confirm Hobby still fits their situation |

`after()` / `waitUntil` share the invocation's `maxDuration` ("Promises passed to `waitUntil()` will have the same timeout as the function itself"), so anything scheduled with `after()` must finish within the route's `maxDuration`.

## 6. Upload path (the 4.5 MB body limit)

FR-IMP-1 allows 10 MB, and Vercel rejects request bodies over 4.5 MB (Next Server Actions also default to a 1 MB body limit). **Files must never be proxied through a function.** PRD §8.5 step 1 already has the right design, and this spike makes it mandatory:

1. The server (as the user) creates the `scheduleFiles` row and returns a **Supabase signed upload URL** (`createSignedUploadUrl`, valid 2 h). The browser uploads directly with `uploadToSignedUrl`. Configure the bucket with `file_size_limit = 10 MB` and `allowed_mime_types` (the Supabase Free plan's global cap is 50 MB, so 10 MB per bucket is allowed).
2. The parse step on the server downloads the object from Storage with the service role. **Downloads are outbound traffic and have no 4.5 MB limit.** The spike's `GET ?src=` path checks this with a 7–10 MB file (§10). The server then checks magic bytes (NFR-SEC-6) before doing anything else.
3. JPEGs sent to OpenRouter are about 0.3 MB each (1.7 MB for 5 pages): an outbound request, with no Vercel limit.

## 7. How WF-027 runs without the worker

Proposed shape. WF-027 builds it, and the spike doesn't.

```
upload confirmed ─► server action: create_parse_job(fileId) → job 'queued'
                    after(() => dispatch(jobId))            // fire the run route, don't wait for the parse
                                                              
POST /api/internal/parse-jobs/run   (route handler, runtime nodejs, maxDuration = 300)
  auth: shared secret header (NFR-SEC-5 retargeted: Supabase cron / pg_net and our own server are the only callers)
  1. claim_parse_job(jobId) SQL fn: queued → processing with a lease (processing_until = now()+5 min), attempt++
     (returns nothing if already claimed → idempotent)
  2. respond 202 immediately; do the work in after():
  3. download from Storage → sniff → convertUpload() → ≤ 5 JPEGs (in memory only; never stored, D38)
  4. OpenRouter (packages/parser): one attempt per invocation, zod-validate, normalise
  5. save_parse_draft(jobId, draft, model, parserVersion, costUsd) SQL fn → needs_review → Realtime signal
     on failure: record error, back to 'queued' with next_attempt_at (backoff) or 'failed' after 3 attempts

Supabase Cron (every minute) → pg_net POST /api/internal/parse-jobs/run?sweep=1
  re-dispatches jobs that are 'queued' past next_attempt_at, or 'processing' past their lease (crash/timeout recovery)
```

- **Why a dedicated route, not `after()` in the Server Action:** it gets its own `maxDuration`, and it's configured differently from pages, so on Vercel it should land in a **separate function**. A memory spike from a hostile file then can't take down page renders on the same instance. Owner check in §10, step 8.
- **One LLM attempt per invocation.** Retries go back through the queue with backoff, so no single invocation carries three model calls, and the 300 s Hobby ceiling is never close.
- **The worst case fits inside one invocation:** download (< 1 s) + conversion (≤ 10 s pessimistic) + one vision call (typically 10–60 s) ≈ 75 s, against 300 s.
- **Active CPU is billed only while code runs.** Waiting on OpenRouter isn't billed as CPU. Memory time is billed, and it's small.
- Keep `dispatch(jobId)` as the single seam (PRD §8.1 "thin interface"). If a queue product or a worker is ever needed, only `dispatch` changes.
- Alternatives we don't need yet: Vercel Queues or Workflows (another vendor surface, when D40 already puts queues and cron in Postgres), and Supabase `pgmq` (only worth it if the `parseJobs` table plus a lease stops being enough).

## 8. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Real Vercel vCPU is slower than even run B | Low | 10× headroom on duration. §10 measures it. If needed, Pro's 2 vCPU option, or cap HEIC at 24 MP |
| **Decompression bombs**: a small HEIC or PDF that declares huge dimensions and OOMs the 2 GB instance, taking concurrent requests with it (fluid compute shares instances) | Medium (hostile input) | Before decoding: reject HEIC whose `ispe` size is over about 50 MP (48 MP iPhone photos must pass), and PDFs whose page box renders over the cap. sharp already caps at 268 MP (`limitInputPixels`). **One conversion at a time per instance** (a module-level semaphore). The dedicated parse route/function isolates any crash, and the lease plus cron recovers the job |
| CPU-bound WASM blocks the event loop of a shared fluid instance for up to about 3–8 s | Medium | Keep conversion in the dedicated parse function, which serves no latency-sensitive traffic. If that's not enough, run `convertUpload` in a `worker_threads` Worker |
| WASM memory never shrinks, so an instance that has decoded a 48 MP HEIC stays at about 600 MB RSS | Certain, harmless | 2 GB limit. Instances are recycled. Accept it |
| Library risk: `@hyzyla/pdfium` and `heic-decode` are small community wrappers | Medium | Both are thin wrappers over PDFium and libheif. Pin exact versions. The `convertUpload` seam lets us swap to a self-built WASM if needed. PDFium in WASM is also a *better* sandbox for untrusted PDFs than native poppler on a worker |
| LGPL-3.0 (libheif, libde265) | Low | Unmodified, used server-side, not distributed. Keep the licence file. Revisit only if we ever ship it to browsers |
| Hobby is non-commercial | Owner's call | Move to Pro before any monetisation, which D16 already rules out for the MVP |
| Vercel regions vs Supabase region add latency to Storage downloads | Low | Set the function region to match the Supabase project region |

## 9. Recommendation

**Drop the Railway worker (keeping it is not recommended).** On Vercel's Node runtime, with no custom binaries, the prototype turns every FR-IMP-1 input into vision-ready JPEGs in 0.02–3.3 s per file on an uncontended core (at most about 9 s of CPU per file even on contended efficiency cores), using under 1 GB of the 2 GB limit, and adds about 25 MB to the function against a 250 MB limit. The parse pipeline fits the Hobby 300 s duration with 4× headroom when it's structured as one LLM attempt per invocation. What the worker was meant to provide (native libs, long jobs, retry control) is covered by WASM engines, fluid compute's 300 s, and the Postgres job table with a Supabase Cron sweep (D40).

**Confidence: medium-high.** The only thing not directly measured is Vercel's own vCPU speed and memory accounting, and §10 closes that gap in about 15 minutes.

**Delete the spike route after the decision is recorded:** `apps/web/src/app/api/spike/`, `apps/web/scripts/spike-wf-024/`, and the `SPIKE_WF024_TOKEN` env var in Vercel. Move `convert.ts` (and its test and tiny fixtures) into WF-027's parser module (for example a Node-only `packages/parser/src/rasterise.ts`), keeping `sharp`, `@hyzyla/pdfium` and `heic-decode` as dependencies there instead of in `apps/web`. `pdf-lib` is only needed by the fixture script and test.

## 10. Owner verification checklist

Do this after connecting the repo to Vercel. It should take about 15 minutes.

1. **Project settings:** Root Directory `apps/web`, Framework Next.js, Node.js 22.x (or 24.x). Settings → Functions: **Fluid compute enabled**. Note the region, and ideally set it to the Supabase region.
2. **Env var (Preview only):** `SPIKE_WF024_TOKEN=$(openssl rand -hex 24)`. Deploy the branch that contains the spike commits as a Preview.
3. Previews have Deployment Protection by default. Create a *Protection Bypass for Automation* secret (Settings → Deployment Protection), then locally:
   ```sh
   export URL=https://<preview>.vercel.app  TOKEN=<token>  BYPASS=<bypass secret>
   H=(-H "x-spike-token: $TOKEN" -H "x-vercel-protection-bypass: $BYPASS")
   cd apps/web && node scripts/spike-wf-024/fixtures.ts   # Node ≥ 22.18; HEIC needs macOS `sips`
   F=$(node -p "require('os').tmpdir()")/whosfree-wf024
   ```
4. **Gate:**
   `curl -s -o /dev/null -w '%{http_code}\n' -H "x-vercel-protection-bypass: $BYPASS" -X POST $URL/api/spike/wf-024` → **404**
5. **Small files through the body** (≤ 4.5 MB). Run each twice: the first call is cold (`initMs` > 0).
   ```sh
   for f in vector-5p.pdf photo-12mp.heic photo-12mp.jpg vector-6p.pdf; do
     curl -s "${H[@]}" --data-binary @$F/$f $URL/api/spike/wf-024; echo; done
   ```
   Expect `vector-6p.pdf` → 400 "limit is 5". Record `totalMs`, `images[].ms`, `memory.after.maxRssMb`, and `runtime.arch`/`node`/`region`.
6. **The body limit is real:** `curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" --data-binary @$F/scan-5p.pdf $URL/api/spike/wf-024` → **413** (6.2 MB > 4.5 MB).
7. **Large files via a URL** (the Storage path): upload `scan-5p.pdf` and `photo-48mp.heic` to a private Supabase bucket, create signed URLs (Dashboard → Storage → file → *Get URL*, 10 min), then:
   ```sh
   curl -s "${H[@]}" "$URL/api/spike/wf-024?src=$(node -p 'encodeURIComponent(process.argv[1])' "<signed-url>")"
   ```
   Also run three at once to see a shared fluid instance:
   `for i in 1 2 3; do curl -s "${H[@]}" "$URL/api/spike/wf-024?src=…48mp…" & done; wait`
8. **Size and grouping:** Deployment → *Resources* → Functions. Find the function containing `/api/spike/wf-024` and note its size (expect about 30–60 MB including the Next runtime) and whether it's separate from the page functions.
9. **Visual check:** `curl -s "${H[@]}" "$URL/api/spike/wf-024?src=…&page=1" -o p1.jpg`, then open it.
10. **Pass criteria:** scan-5p `totalMs` < 20 000, 48 MP HEIC < 20 000, three-at-once 48 MP HEIC all 200 with `maxRssMb` < 1 800, and no 500s or `FUNCTION_INVOCATION_TIMEOUT`. If they pass, record the decision. If the CPU is much slower than expected, set Pro's 4 GB / 2 vCPU for that function, or reject HEIC over 24 MP. The worker still isn't needed.
11. **Clean up:** delete `SPIKE_WF024_TOKEN` and the bypass secret, and delete the spike route per §9.

## 11. What changes if the decision is accepted (for the PRD/ISSUES update)

- **D6**: replace "A Railway worker for heavy jobs only" with the new decision (proposed D46; D45 went to email sign-in).
- **§8.1**: remove the Railway box, the "Why there's still a Railway worker" paragraph and the "Revisit" note. Conversion and OpenRouter move to "The Next.js server" bullet.
- **§8.2**: remove `apps/worker`. **§8.4**: remove the "Worker HTTP: Hono" row and "Railway deploys from `main`". **§8.5 parse flow, steps 3–5**: replace with the §7 flow.
- **NFR-SEC-5**: becomes "internal routes (cron, job dispatch) are authenticated with a shared secret". **NFR-SEC-6** and **R12**: "owner and the worker" becomes "owner and the server". **NFR-SEC-8**: the OpenRouter key lives only in the Next.js server's environment (never `NEXT_PUBLIC_`). **NFR-REL-4**: "if a parse run fails or times out, the job is retried by the cron sweep". **NFR-SCALE-2**: drop, or restate as "parse runs are stateless". **NFR-OPS-4/5**: drop "worker".
- **NFR-SEC-4, NFR-COMP-4, NFR-COST-2, §4 Constraints, glossary "Worker"**: remove Railway.
- **R8**: mitigated (one fewer server piece).
