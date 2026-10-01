# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A 1280×640 link preview card (`docs/social-preview.png`) showing the capsule, the waveform
  and the card left untouched underneath it. GitHub only picks it up once it is uploaded
  under **Settings → Social preview**.

## [1.1.0] - 2026-10-01

Recording no longer takes the composer over, and the whole motion layer was rebuilt on
DeepSeek Harness's own vocabulary instead of a parallel one.

### Added

- **A press ring.** The hold used to be a dead zone: nothing on screen changed until the
  panel appeared. A ring now draws at the pointer over `HOLD_MS`, and retracts if the press
  turns out to be a click, a caret move or the start of a selection. It is a CSS transition,
  so reversing mid-hold drains it from wherever it had actually reached.
- **A floating recording capsule.** Recording renders as a capsule *above* the composer
  rather than a panel over it, so the draft stays readable and typeable while you dictate.
  It carries a live-state dot, the level waveform, and one short word.
- **[`tests/render.test.mjs`](tests/render.test.mjs)**, which loads the client bundle the way
  the DSH module loader does, mounts the component in every gesture state, and then asserts
  the motion rules. Wired into `npm run check` and CI.
- A changelog, issue forms, a pull request template, and contributor notes.

### Changed

- **The motion vocabulary is the host's, not the plugin's.** `cubic-bezier(.16,1,.3,1)` (the
  curve DSH's own menus enter on), `cubic-bezier(.4,0,.2,1)` (`--ds-ease-in-out`), 140–200 ms
  durations (inside `--ds-transition-duration`), and the `MenuSurface` material recipe
  (`--dsw-specific-menu` over `--dsw-menu-backdrop-filter`).
- **Entry and exit are transitions, never keyframes.** Entry rides `@starting-style`; exit a
  `data-leaving` attribute. Anything the user reverses mid-flight retargets from its current
  value. Every surface now has an exit — previously only the hint and the notice did.
- **The level meter is the shipped voice input's waveform**: a 28-slot shift register of RMS
  samples redrawn at 20 fps, replacing five bars that animated `height` (a layout per bar per
  frame) through a CSS variable set on the parent.
- **Drag-to-discard is continuous.** One number (`--dsh-htt-cancel`) drives the capsule's
  wash, the cross glyph, the card's hairline and the meter's retreat together. 48 px arms it,
  38 px disarms it, and the release decision reads velocity before position.
- **Text is a last resort.** The recording state went from two lines (~24 characters) over
  the draft to a single four-character word, and even that word only carries what the dot
  and the waveform cannot.
- **The hover hint moved into the tool row**, aimed at the gap in front of the trailing
  controls so it can never cover the draft. It elides, and is dropped when the row has no room.
- `HOLD_MS` 350 → 300 ms.

### Fixed

- **A surface that shielded the editor.** An exiting panel kept `pointer-events: auto` while
  it faded, so the 180 ms after every recording swallowed the next click into the draft.
  Exiting surfaces now stop accepting input.
- **A double insert.** The retained-transcript chip stayed clickable while it faded, and
  `pending` was only cleared once that exit finished, so a double click inserted the same
  transcript twice.
- **A leaked animation frame.** `cancel()` never stopped the meter, leaving a rAF loop that
  re-armed itself for the rest of the session after every `Esc`.
- **Layout thrash in the meter** — see Changed.
- **Reduced motion deleted feedback instead of softening it.** It now keeps the opacity
  cross-fades and drops only the movement.
- `prefers-reduced-transparency` and `prefers-contrast` are honoured.
- The press ring waits 110 ms before appearing, so ordinary clicks in the text field do not
  flash it.

## [1.0.0] - 2026-09-30

First release — the hold-to-talk gesture and everything it needs to be safe to use.

- Long-press anywhere on the composer card, release to transcribe into the draft. Nothing is
  ever sent automatically.
- Reuses the speech service the official voice-input bundle mounts. If that bundle is off,
  the plugin registers nothing and the composer keeps its normal behaviour.
- Cancel with `Esc`, or hold and swipe up (or leave the box) to discard.
- A transcript whose draft changed underneath it is retained in a chip rather than lost.
- Localised `zh` / `en`; light and dark themes; graceful degradation when a host contract is
  missing.

[Unreleased]: https://github.com/jryang1997/dsh-composer-dictation/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/jryang1997/dsh-composer-dictation/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.0.0
