# Overload — working rules

Single-file app: `index.html`. Vanilla JS, zero dependencies, no build step.
Deployed on every push to `main`, twice:
  - GitHub Pages → https://meni-gottesman.github.io/overload/  (his preferred URL)
  - Cloudflare Pages → https://overload-o3a.pages.dev  (isolated origin; `_headers` applies here only)
Both serve the same commit. IndexedDB is per-origin, so they hold separate local logs
until backup is connected. GitHub Pages ignores `_headers` and caches for 10 minutes.
Tests: `node test.js` (93 assertions) **and** `node test-sync.js` (23 assertions, runs the
real Sync code against a mock GitHub and an in-memory IndexedDB). Both must be green.

## The one rule that outranks everything

**Meni's training log must survive every change you make.**

His data lives in two places, and neither is yours to migrate:

1. **IndexedDB `overload`** on the device, object stores `events` / `kv` / `photos`.
2. **`meni-gottesman/overload-data`** (private), as NDJSON — one file per training day.

Every piece of derived state — working loads, weekly volume, the decision log — is a
*fold over the event log*. `rebuild()` replays it from scratch on every launch. That is
what makes the data durable, and it is also what makes it fragile in one specific way:

**Rename an event `type` or an existing payload field and the history silently stops
counting.** Not an error. Not a crash. His sets from last month just quietly stop
existing. That is the failure mode to be paranoid about.

So:

- **Never** change `DB_NAME`, the object store names, or `DB_VER` without a real migration.
- **Never** rename or remove an existing event `type` string: `settings`, `set`, `voidSet`,
  `weight`, `waist`, `note`, `photo`, `irritation`, `redflag`, `planStart`, `planEdit`,
  `sessionEnd`.
- **Never** rename or repurpose an existing field in an event payload. Adding a new
  *optional* field is fine and is how this schema is meant to grow.
- **Never** write a migration that rewrites past events. Append a correcting event instead —
  that is exactly what `voidSet` is for.
- **Never** make `rebuild()` throw on an event shape it does not recognise. Old logs must
  replay on new code, forever.

`fixtures/v1-log.json` is a frozen sample of real v1 event shapes, and `test.js` replays it
and asserts the derived state. **If that test fails, you broke backwards compatibility.**
Do not edit the fixture to make it pass — the fixture is the contract.

## Before any push

0. `python3 build.py` — **always, last, after every edit to index.html.** It stamps the
   build and re-pins the CSP `script-src` to the SHA-256 of the inline script. The policy
   has no `'unsafe-inline'`: if the hash is stale, the browser refuses to run the app at all
   and the page is blank. Run it, then verify the app opens.
1. `node test.js` **and** `node test-sync.js` — every assertion green. A red test is a stop.
2. Actually open the app and use it. Most real defects in this codebase have been found by
   driving the browser, not by reading: a warm-up eating a working set, a mid-session reload
   crashing the view, a set edit showing twice. None of those were visible in the source.
3. Never `--force`. The log repo and the app repo both keep history on purpose.

## Design commitments that are not up for casual revision

- **Every plan change emits a sentence.** `emit()` throws without a rule id and a sentence.
  This is deliberate. Do not soften it into a warning.
- **Loads are members of `loadableSet()`.** Never prescribe a weight the gym cannot make.
- **Progression is one rung.** 5 lb on the bar, 5 lb a hand, one pin on the stack. How far
  he beat the target decides whether to move, never how far. Do not reintroduce percentage
  steps that skip rungs.
- **No `alert()` or `confirm()`.** A native modal blocks the whole page on a phone.
- **No external subresource.** No CDN, no webfont, no analytics. The page holds a token with
  write access to a private repo; a third-party script would run with full authority over it.
  The CSP pins `connect-src` to `api.github.com` and `script-src` to the hash of the one
  inline script — an injected `<script>`, inline handler or `javascript:` URL does not execute.
  Never add an inline `onclick=`; use the delegated `data-act` listener.
- **The token is sealed at rest** (`Vault`): AES-GCM under a device-generated non-extractable
  CryptoKey. That protects a storage dump or device backup, not same-origin script — the CSP
  and the no-subresource rule are what protect against that.
- **Home Screen install is a security control, not a nicety.** Installed web apps get storage
  that Safari tabs cannot read (WebKit: "no other website data is shared"). On the shared
  `meni-gottesman.github.io` origin, that is the isolation.
- **Four weight tiers, 4:1 ratio, ≤4 distinct values** (`weightsLegal`). The per-muscle
  evidence cannot support a finer vector; a prettier one would be fitting sampling error.
- **No muscularity ceiling.** Curvature is real, its peak has never been located.
- **Body-fat percentage triggers nothing.** Consumer estimates carry ±3–5 points. Waist and
  scale trend only.
- **Engineering guesses stay labelled** in Settings → provenance. Do not quietly promote a
  guess to a finding.

## Where things are

    index.html              the whole app
    build.py                stamp + re-pin the CSP hash; run before EVERY commit
    test.js                 replays the planner in a VM, asserts the invariants
    test-sync.js            drives Sync against a mock GitHub + fake IndexedDB
    fixtures/v1-log.json    frozen v1 event shapes — the compatibility contract
    img/<exercise>_{0,1}.jpg  start/finish photos per lift, from free-exercise-db
                            (yuhonas, Unlicense / public domain), resized to 560 px.
                            Committed here so img-src stays 'self' — never hotlink.
    data/                   staging for the overload-data repo (not committed here)
    .claude/launch.json     local preview on :8931, serving /tmp/ovl-serve

Rule ids in the code (`PRG-*`, `VOL-*`, `SEL-*`, `FAI-*`, `SAF-*`, `PHA-*`, `CAP-01`,
`ENG-*`, `MIS-01`) are load-bearing: they appear in the user-facing audit trail. Keep them
stable and keep the comment above each threshold explaining where the number came from.
