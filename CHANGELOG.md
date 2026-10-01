# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-10-01

### Added

- **A settings page**, under Settings → Plugins → Dictation. Four knobs, and deliberately only
  four: the hold duration, the motion level, the hover hint, and which keyboard chord to use.
- The bundle now registers into `plugins.bundle.config`, keyed by package name — the seat the
  manager offers a bundle for its own page.

### Changed

- **Configuration became a module.** `createConfig` owns the defaults, the clamping, the
  persistence and the change notification behind a four-method interface — `get` / `set` /
  `subscribe` / `reset`. These values used to be module constants read straight out of the
  gesture, and a page that writes them would have scattered storage calls across the whole
  effect. This is the first of three deepenings; the gesture's thresholds and the surface
  lifetimes are still inline.
- **Motion is a preference as well as a signal.** "Calm" applies the same softening as
  `prefers-reduced-motion` — opacity stays, the movement goes — for people who want it without
  changing an operating-system setting.
- The press ring's duration is now driven from configuration instead of being baked into the
  stylesheet.
- Chord matching moved from a hard-coded `Ctrl+Shift+Space` to a small catalogue matched on
  `event.code`, so a keyboard layout that moves the letters around cannot silently break it.

### Notes

- Settings live in the browser's storage, not the DSH profile. That keeps the plugin free of
  any `@deepseek-ai/dsh-*` dependency — a wrong peer range makes DSH skip the entire bundle,
  silently — at the cost of not travelling between machines. The reasoning is in the README.

## [1.2.0] - 2026-10-01

Making good on the three gaps the previous release left open: the gesture had no keyboard
equivalent, a failure flashed past without offering a way out, and errors announced
themselves as politely as a status update.

### Added

- **A keyboard equivalent.** Hold `Ctrl`+`Shift`+`Space` to record and release to transcribe —
  the same gesture, the same state machine, no pointer. The chord is deliberately awkward to
  hit by accident and never claims a keystroke unless it actually starts a recording. It also
  runs through the same discard path, so `Esc` while still holding discards.
- **Retry, in place.** A failed transcription used to mean saying the whole sentence again.
  The failure card now re-sends the recording that is already captured, so a network hiccup or
  a provider error costs one click instead of one repetition.
- **A 1280×640 link preview card** (`docs/social-preview.png`) showing the capsule, the
  waveform and the card left untouched underneath it. GitHub only picks it up once it is
  uploaded under **Settings → Social preview**.

### Changed

- **A failure is no longer a notice.** It stays on screen until it is dismissed or retried,
  carries its own controls, clamps to two lines with the full text on hover, and uses
  `role="alert"` so assistive technology treats it as urgent. The transient notice keeps
  `role="status"`, because nothing is being asked of the user there.
- **Saying nothing is no longer silent.** A recording shorter than `MIN_SECONDS` used to drop
  out with no feedback at all, which a keyboard tap makes much easier to hit. It now says so.
- A second entry point into `begin()` is guarded, so a hold and a chord can never race into
  two captures.

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

[Unreleased]: https://github.com/jryang1997/dsh-composer-dictation/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/jryang1997/dsh-composer-dictation/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/jryang1997/dsh-composer-dictation/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jryang1997/dsh-composer-dictation/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.0.0
