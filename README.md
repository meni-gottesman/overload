# Overload

An autoregulated hypertrophy coach. One self-contained HTML file, no
dependencies, no build step, no server.

You report what you actually did — reps, the weight, and where you stopped. On
the first open of each new local day it reads that and writes the next session:
loads your gym can physically make, sets it can justify, and **one sentence per
change** explaining which observation caused it.

**Live:** https://overload-o3a.pages.dev

## What makes it different from a spreadsheet

- **A discrete actuator.** Every prescribed weight is a member of a `loadable_set`
  generated from your actual bar, plates, dumbbell rack and cable stack. When the
  math wants +2% and the smallest jump your gym can make is +9%, it does not fake
  a fractional kilogram and does not stall — it adds a rep instead, and if reps
  run past the band ceiling twice it forces the jump anyway.
- **A fatigue-aware expectation.** Performance is judged against what you should
  have managed at *that* position in the session with *that* much recovery, not
  as if you were fresh. Without this, the fourth exercise reads as a shortfall
  every week and the planner walks its load down forever.
- **A mandatory audit trail.** A plan change that cannot emit a sentence throws
  at write time. Not a UI nicety — a build failure.
- **Volume that can come down.** After eight flat weeks it *removes* two sets for
  a month to test whether they were doing anything. A ladder that only climbs
  ratchets a stoic lifter to the ceiling with no way to tell thriving from
  digging a hole.
- **Failure treated as a cost, not a stimulus.** Refalo 2024 measured quadriceps
  thickness at +0.181 cm to failure vs +0.182 cm at 1–2 RIR. Identical, at
  materially higher fatigue. So failure is spent, sparingly, on the last set of
  lifts that are safe to fail — never on a barbell that can pin you without a
  spotter flag set fresh that session.

## Data

Your log lives in a separate **private** repo as plain NDJSON, one file per
training day, written from the browser via the GitHub Contents API. `git clone`
plus any text editor recovers all of it, forever, offline. The export format is
the storage format, so portability cannot regress.

This repository is public and contains no data and no credentials.

## Tests

    node test.js

Replays the planner out of `index.html` in a VM and asserts the invariants:
the loadable set, the deadband, the increment-stall rule, the forced-jump
invariant, the asymmetric down-correction, the pinning rule, and the audit-trail
assert.

## Provenance

Thresholds carry their source in comments, and the ones that are engineering
guesses rather than findings say so — in the code and in the app's Setup screen.
The per-session set cap, the layoff bands, the 2–10% load steps and the two
fatigue priors are all labelled as such. No study in the evidence base measured
appearance; they measured muscle thickness. The visual-impact weights are
judgment, and the app says so on the screen where they matter.
