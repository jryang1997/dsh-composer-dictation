# How this plugin hooks into DSH

Notes for anyone extending this plugin — or writing another composer-level plugin.
Everything below was verified against DSH `0.1.7-rc.2` by reading the shipped packages in
`app.asar` and the live client slot tree. **These are internal interfaces and can change
between releases**; the plugin is written so that a change degrades rather than breaks.

## The three things a composer plugin needs

| Need | What DSH provides | Where |
|---|---|---|
| A place to render inside the input box | `conversation.input.overlay` — a `list` slot, `replaceRisk: none`, rendered inside the composer card | declared by `conversation.composer.bar` |
| A way to write the draft | `inputActions`, delivered as a **slot standard prop** | `dsh-client-ui-conversation/lib/client.js:13461-13484` |
| A way to transcribe | `ctx.remote.speech` — a client Cordis service | `dsh-experimental-client-ui-voice-input/lib/client.js:5779` |

### Why not `conversation.input.activity`

That is the seat the shipped microphone uses (`VoiceInput`, registered by `registerUi` at
`.../client-ui-voice-input/lib/client.js:5793`). It is a **single** slot: registering at the
same priority throws, and taking it would mean displacing the shipped UI. The `overlay`
slot is a `list`, so a new `id` simply joins `slash-menu` / `command-popup` /
`feedback-dialog` without touching them.

### Reading the draft API

```js
const span = inputActions.captureInsertion();   // { start, end, draftRev }
inputActions.insertText(text, span);            // boolean
```

`insertText` **replaces** `[start, end)` as one undoable edit, and returns `false` when the
draft revision moved on or the composer is busy (`adjudicating` / `submitting`). Retain the
text and let the user place it — that is what the shipped plugin does, and what the
lower-right chip in this plugin is for.

## The gesture surface

`conversation.input.overlay` renders inside the card's first child, so a component can walk
up to the card from its own node:

```
div[data-composer-card]                     ← position: relative
  └ div.<hash>_overlayAnchor                ← height: 0; position: absolute; inset: 0 0 auto
      └ div[data-slot="conversation.input.overlay"]   ← display: contents
          └ this plugin's layer
```

`[data-composer-card]` is set by the composer itself
(`dsh-client-ui-conversation/lib/client.js:17367`). The editor inside is a Lexical
`div[data-composer-input][contenteditable][role=textbox]`.

Two rules keep typing intact:

1. The layer is `pointer-events: none`, so it never covers the editor.
2. The card is watched in the **capture** phase and nothing is `preventDefault`ed until the
   hold threshold is reached — a click, a caret move or a selection behaves exactly as
   before. Movement beyond 10 px disarms the gesture.

The layer needs an explicit height because the anchor it lives in is zero-height; the
component measures the card with a `ResizeObserver` instead of guessing.

## Speech recognition

The `speech` remote is **not** part of the default remote assembly — the shipped voice-input
plugin mounts it itself with `ctx.remote.$mount(TYPERT_REMOTE)`. A third-party plugin can
therefore simply inject the namespace:

```js
ctx.inject(['remote.speech', 'slots'], (scope) => { /* scope.remote.speech.transcribe(...) */ });
```

If that bundle is disabled the callback never runs and this plugin registers nothing —
degradation without errors. The alternative, fully self-contained route is to POST the same
`/api/speech/transcribe` envelope directly; the transport is ordinary Typert Remote RPC over
the `/api` channel with same-origin cookie auth.

Host contract (`dsh-experimental-api-speech-to-text/lib/index.js`):

| Method | Notes |
|---|---|
| `transcribe({ audioBase64, providerId?, language? }, signal)` | Audio must be canonical base64 of a 16 kHz mono PCM16 WAV with an exact 44-byte header |
| `catalog()` / `follow(signal)` | Provider list, selection, readiness, `maxAudioBytes` (4 MiB) and `maxDurationSeconds` (120) |
| `configure` / `prepare` / `cancelPreparation` | Preferences and model preparation |

This plugin omits `providerId` and `language` so the Host applies its own configuration,
which sidesteps provider language whitelists entirely.

## Deliberate non-goals

- No streaming transcript: the Host API is one-shot over a complete recording.
- No auto-send: the transcript lands in the draft, where it stays editable.
- No DOM writes outside the plugin's own subtree, and no reading of other plugins' DOM —
  the only host node touched is the card the plugin is already mounted inside.
