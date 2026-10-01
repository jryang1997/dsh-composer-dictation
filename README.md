# dsh-composer-dictation

[![check](https://github.com/jryang1997/dsh-composer-dictation/actions/workflows/check.yml/badge.svg)](https://github.com/jryang1997/dsh-composer-dictation/actions/workflows/check.yml)
[![release](https://img.shields.io/github/v/release/jryang1997/dsh-composer-dictation)](https://github.com/jryang1997/dsh-composer-dictation/releases)
[![license](https://img.shields.io/github/license/jryang1997/dsh-composer-dictation)](LICENSE)
[![topic](https://img.shields.io/badge/topic-dsh--plugin-4d6bfe)](https://github.com/topics/dsh-plugin)

**English** · [中文](#中文)

Long-press anywhere on the composer card in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) to dictate.
Release to transcribe and drop the text into the draft — nothing is sent automatically.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  ⌄  ＋  权限  计划    🎤 按住鼠标语音输入文字  [◉] [➤] │
│                       ↑ the hint tucks into the tool  │
│                         row — never over your draft   │
└──────────────────────────────────────────────────────┘

        press and hold ≈0.3 s ↓  (a ring draws at the pointer)

                  ╭──────────────────────────────╮
                  │  ●  ▁▂▅▇▅▃▂▁▂▄▆▄▂▁   松开完成  │   ← the bubble floats
                  ╰──────────────────────────────╯     above the card
┌──────────────────────────────────────────────────────┐
│  your draft is still here — readable, typeable       │
│  ⌄  ＋  权限  计划                          [◉] [➤] │
└──────────────────────────────────────────────────────┘
```

Recording does **not** take the composer over. The bubble is a floating capsule above the
card, and the card is left completely alone, so you can keep reading and editing what you
were writing while you dictate.

---

## Requirements — read this first

This plugin **does not ship a speech recogniser**. It reuses the one DeepSeek Harness already
has, so both of these must hold before it can do anything:

1. **The official voice-input bundle is enabled.**
   It ships with DeepSeek Harness as `@deepseek-ai/dsh-experimental-voice-input-bundle`
   (Plugins → *Voice input* / 语音输入). It is what mounts the `speech` remote that this
   plugin calls. If you disable it, this plugin silently registers nothing and the composer
   keeps its normal behaviour.

2. **The recognition models are prepared.**
   The official bundle transcribes **locally** with SenseVoice. On first use the Host
   downloads the model files (≈ 240 MB) into `~/.dsh/speech-to-text/sensevoice/models`
   (`model.int8.onnx`, `tokens.txt`, `silero_vad.onnx`).
   Open the voice-input bundle page and run **Download and prepare** once; or simply click
   the built-in microphone button once and follow the setup prompt.

> The official bundle has no streaming support, so a transcript appears only after you
> release. Audio is transient: it never becomes a session event or an attachment, and only
> the text you later submit is recorded.

**Tested against** DeepSeek Harness `0.1.7-rc.2` (the version shipped with the desktop app at
the time of writing). The plugin uses two internal interfaces — the `conversation.input.overlay`
slot and the `speech` remote — and is written to degrade instead of throwing when either is
missing.

## Install

**A. Install straight from GitHub — no clone needed**

The plugin manager accepts a git URL as an install target, so the whole install is one
command. From the CLI:

```bash
dsh plugin --profile <profile> add github:jryang1997/dsh-composer-dictation
```

or ask the agent in any session:

> Install the bundle `github:jryang1997/dsh-composer-dictation` with `plugin_manager`
> (`action: install_bundle`).

A git install is pinned to the commit it was installed from. To pin it to a release instead
— so you know exactly what you are running, and can move deliberately — name the tag:

```bash
dsh plugin --profile <profile> add github:jryang1997/dsh-composer-dictation#v1.2.0
```

See [Releases](https://github.com/jryang1997/dsh-composer-dictation/releases) for what
changed in each one, and [`CHANGELOG.md`](CHANGELOG.md) for the detail.

**B. Install from a clone**

Cloning first also works, and is the route to take when you want to modify the plugin
locally:

```bash
git clone https://github.com/jryang1997/dsh-composer-dictation.git
```

Then install the directory: ask the agent to run `plugin_manager`
(`action: install_bundle`) with the clone's absolute path as `target`, or run

```bash
dsh plugin --profile <profile> add <absolute path to the clone>
```

> The Desktop application owns its `desktop` profile exclusively, so there ask the agent
> rather than using the CLI.

**Verify**

Reload the page (`Ctrl+R`), hover the message box and look for the hint in the lower-right
corner. If it does not appear, open the browser console and check that the host half
activated.

## Usage

| Gesture | Result |
|---|---|
| Hover the input box | A hint appears in the tool row, between the mode chips and the model selector |
| Press and hold ≈0.3 s without moving | A ring draws at the pointer, then a capsule floats up above the card: a live dot, the level waveform, and one short word |
| Release | Transcript is inserted at the caret — **not** sent |
| Press `Esc` while recording or transcribing | Cancel |
| Hold, then drag up ≥48 px **or move the pointer off the box** | The capsule and the card's outline wash red and the word changes to "release to discard"; release there to drop it, come back to keep it |
| **Hold `Ctrl`+`Shift`+`Space`**, then release | The same gesture with no mouse: hold the chord to record, let go to transcribe |
| Click the **microphone button** in the tool row | A toggle rather than a hold: press to start, press again to finish. This is the seat a keyboard or screen-reader user can actually find |
| A plain click, a drag, or selecting text | Nothing happens — the arc retracts and the gesture never arms |

### Keyboard

`Ctrl`+`Shift`+`Space` is the whole gesture without a pointer: hold it down to record, let go
to transcribe, `Esc` while still holding to discard. It works wherever you are in the app, so
you do not have to focus the input box first, and it goes through exactly the same state
machine as the mouse — the capsule, the waveform, the discard wash and the retained-transcript
chip all behave identically.

The chord is deliberately awkward to hit by accident, and it never claims a keystroke unless
it actually starts a recording.

And there is a **button**: a 28 px microphone in the composer's tool row, to the left of the
model selector. It is a real control — Tab reaches it, Enter activates it, and
`aria-keyshortcuts` on it is how a keyboard user discovers the chord exists. Its model is a
**toggle** rather than a hold (press to start, press again to finish), because keeping a key
pressed with a button is an awkward thing to ask, and because that is what the shipped
microphone does.

### Settings

Settings → Plugins → **Dictation** opens the bundle's own page. Four things live there, and
deliberately only four:

| Setting | Why it is yours to change |
|---|---|
| **Hold duration** (150–800 ms, default 300) | Hands differ more here than at any other threshold |
| **Motion**: full / calm | Calm keeps the cross-fades and drops movement and scale — the same softening as `prefers-reduced-motion`, but chosen rather than signalled |
| **Hover hint** on / off | Some want the reminder, some find it noise |
| **Keyboard shortcut**: off, `Ctrl`+`Shift`+`Space`, `Ctrl`+`Shift`+`D`, `Ctrl`+`Shift`+`M`, `Ctrl`+`Alt`+`Space` | Shortcut conflicts are personal, which is exactly why this one is a choice |

**Deliberately not there**: colours, materials, radii, the drag-to-discard distances, and the
waveform's physics. Those are the design — a settings page that exposes them has not decided
anything. The speech provider and language are absent for a different reason: this plugin
sends neither, so the Host's own Voice input settings govern, and a second copy here could
only disagree with them.

There is no theme setting because the plugin has no theme of its own: it carries no colour
and reads every value from the Host's tokens, so it follows light and dark automatically.

Settings are stored **in this browser**, not in your DSH profile. That is a deliberate trade —
it keeps the plugin free of any `@deepseek-ai/dsh-*` dependency (a wrong peer range makes DSH
skip the whole bundle, silently) — and these are per-machine preferences rather than
configuration that should travel. The cost is that they do not follow you to another machine.

### When something goes wrong

A failure is not a toast. It stays on screen until you deal with it, because it is the only
kind of message that is waiting for you, and it announces itself assertively rather than
politely.

| Failure | What the card offers |
|---|---|
| The Host could not transcribe — a network hiccup, a provider error, a model that fell over | **Retry**, which re-sends the recording you already made. You should not have to say the same sentence twice |
| Anything the same recording would fail again on — too long, no recorder, models not prepared, microphone refused | Dismiss only, plus a line telling you what to change |

`Dismiss` (or `Esc`) clears it. A recording that was simply too short is not a failure and
still dissolves on its own.

If the draft changed while recognition was running, the transcript is **kept** in a small
lower-right chip; click it to insert at the current caret.

## Tuning

Everything lives at the top of `client.js`; there is no build step, so edit and reload.

| Constant | Default | Meaning |
|---|---|---|
| `HOLD_MS` | `300` | How long the press must stay still |
| `ARM_TOLERANCE_PX` | `10` | Movement that disarms the gesture |
| `CANCEL_ARM_PX` | `48` | Upward travel that arms "release to discard" (leaving the box arms it too) |
| `CANCEL_RELEASE_PX` | `38` | Where it disarms again — the 10 px band is what stops the capsule flickering |
| `CANCEL_FLICK_PX_PER_S` | `150` | Release speed that overrides position when deciding discard vs. keep |
| `MIN_SECONDS` | `0.35` | Recordings shorter than this are dropped |
| `NOTICE_MS` | `2800` | How long a one-line notice stays |
| `EXIT_MS` | `180` | How long any surface takes to leave |
| `METER_SETTLE_MS` | `240` | How long the level trace keeps draining after you release |

Easing, durations and materials are not tuned by hand here — they are read from the host
app's own tokens. See [Motion](#motion).

## Motion

The plugin deliberately owns no motion vocabulary of its own; it borrows DeepSeek
Harness's, so it reads as part of the app rather than as a guest.

| Decision | Where it comes from |
|---|---|
| Entrance curve `cubic-bezier(.16,1,.3,1)` | the curve DSH's own menu and preset entrances use |
| Exit curve `cubic-bezier(.4,0,.2,1)` | `--ds-ease-in-out` |
| 140–200 ms durations | inside the app's `--ds-transition-duration` band |
| The card's outline in the discard state | `--dsw-radius-panel`, the composer card's own 28 px — which the app also renders as a squircle via `corner-shape: superellipse(1.5)` |
| The capsule's surface | `--dsw-specific-menu` over `--dsw-menu-backdrop-filter`: the recipe `MenuSurface.module.css` uses for every floating layer |
| The capsule's shadow | `--dsw-elevation-prominent`, the host's shadow for a surface that floats above content |
| Level meter | the shipped voice input's waveform: 28 RMS samples in a shift register, redrawn at 20 fps |

Four rules hold everywhere, and `tests/render.test.mjs` enforces them:

1. **Recording runs alongside you, it does not take over.** Apple's rule is *dim to focus,
   separate to keep flow*: a panel that is parallel to what you are doing uses translucency
   and offset **without** a scrim. The capsule floats above the card; the card is untouched,
   so your draft stays readable and typeable for the whole recording.
2. **Entry and exit are transitions, never keyframes.** Entry rides `@starting-style`,
   exit a `data-leaving` attribute. Anything the user reverses mid-flight — a hold that
   turns into a drag, a bubble reopening during its own exit — retargets from where it
   actually is instead of restarting.
3. **Only `transform`, `opacity`, `translate` and `scale` are animated.** The meter used
   to animate `height`, which cost a layout per bar per frame.
4. **The gesture is a continuous quantity, not a boolean.** How far you have dragged
   toward "discard" is one number (`--dsh-htt-cancel`) that drives the red wash, the
   ✕ glyph, the card's hairline and the meter's retreat together, so the state is
   steerable rather than switched.

Text is treated as a last resort: the capsule shows a word only while a release would
actually discard the recording. While everything is fine, the live dot and the waveform
say it without any words at all.

## How it works

| Concern | Mechanism |
|---|---|
| Where it renders | One entry in the `conversation.input.overlay` slot — a floating layer inside the composer card |
| Gesture surface | `node.closest('[data-composer-card]')` from its own node, listening in the capture phase |
| Hint placement | Measured from the tool row: the hint is aimed at the gap in front of the row's trailing group, so it can never cover the draft or a control |
| Never disturbing typing | The layer is `pointer-events: none`; nothing is `preventDefault`ed before the hold threshold |
| Recording | `getUserMedia` + `MediaRecorder` → `OfflineAudioContext` resample to 16 kHz mono → 44-byte PCM16 WAV |
| Recognition | `ctx.remote.speech.transcribe({ audioBase64 })`; provider and language come from the Host config |
| Draft insertion | The slot's own `inputActions.captureInsertion()` / `insertText(text, span)`, guarded by `draftRev` |
| Styling | Only `--dsw-alias-*` theme tokens plus the host's own surface/material/radius tokens, so light, dark and `prefers-reduced-transparency` all work |
| Text | Registered through `ctx.locale` (`zh`, `en`) |

Interface-by-interface notes, verified against the shipped packages, live in
[docs/design.md](docs/design.md).

## Known limitations

- **The tool-row button is hidden while the shipped voice input is expanded.** It lives in
  `conversation.input.left`, and the composer hides that whole group when the official
  microphone's activity expands — so during an official recording, the chord is the only way in.
- **Mouse-first.** Touch input is untested: on a touch screen a long press also drives text
  selection, so the thresholds would probably need tuning there.
- **The hint needs room.** It lives in the tool row's empty middle, so on a very narrow
  composer — where the mode chips and the model selector leave no gap — it is dropped
  rather than allowed to overlap a control.
- It leans on two internal DSH interfaces — the `conversation.input.overlay` slot and the
  `speech` remote — which can change between Harness releases.

## Development

No dependencies and no build step. `npm run check` parses both halves, validates the bundle
manifest, checks the locale dictionaries for key and placeholder parity, and renders the
client component across every gesture state — including the motion rules from
[Motion](#motion), which would otherwise regress silently. The same checks run in CI.

## Distribution and discovery

DeepSeek Harness has **no official plugin marketplace and no submission process**: the
official repository states that it cannot accept external pull requests at the moment, and
the mechanism it points third-party plugins at is the GitHub topic
[`dsh-plugin`](https://github.com/topics/dsh-plugin). This repository carries that topic,
which is how it is meant to be found.

Community directories index that topic automatically — notably
[dsh-market](https://github.com/2BingLing/dsh-market) ([dsh.market](https://dsh.market)),
whose daily crawler collects repositories tagged `dsh-plugin`, so no submission is needed
there either.

`install_bundle` also accepts an npm package name, but this plugin is **not published to npm**.
Installing from the git URL above is the supported route, needs no registry account, and is the
one this repository is tested against.

## Updating

A git install is pinned to the commit it was installed from, so a new release needs one
reinstall — there is no auto-update:

```text
plugin_manager → action: remove_bundle → target: @jryang1997/dsh-composer-dictation
plugin_manager → action: install_bundle → target: github:jryang1997/dsh-composer-dictation#v1.2.0
```

Removing first matters: re-installing over an existing row can report `ambiguous-install`,
because the dependency spec itself has not changed.

Reload the page afterwards. The client half is a browser module, and it keeps the copy it
already loaded until the page is refreshed.

## Changelog

Every release is documented in [`CHANGELOG.md`](CHANGELOG.md), in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form, and tagged so an install can
be pinned to it. The short version:

| Version | What it was about |
|---|---|
| [1.4.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.4.0) | A focusable microphone button in the tool row — the keyboard entry finally becomes findable |
| [1.3.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.3.0) | A settings page, and the configuration module it forced into existence |
| [1.2.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.2.0) | A keyboard equivalent for the gesture, retry in place when the Host hiccups, and failures that wait for an answer instead of flashing past |
| [1.1.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.1.0) | Recording stopped taking the composer over: a floating capsule, an acknowledged press, real exits, and a motion vocabulary borrowed from the host |
| [1.0.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.0.0) | The hold-to-talk gesture itself, and everything it needs to be safe to use |

## Uninstall

```text
plugin_manager → action: remove_bundle → target: @jryang1997/dsh-composer-dictation
```

A directory install (route B) links to the clone, so deleting the clone after removing the
bundle is safe. A git install (route A) lives inside the profile and needs no cleanup.

## Privacy and disclaimer

- Audio is captured locally, handed to the Host's speech service over the local API, and
  discarded. It never becomes a session event or an attachment.
- **If the Host is configured with a cloud speech provider, that audio leaves the machine.**
  This plugin sends no `providerId`, so whichever provider the Host has selected is used; the
  default configuration transcribes locally with SenseVoice. Check *Settings → Plugins → Voice
  input* before dictating anything sensitive.
- The plugin makes no network request of its own and stores nothing.
- Unofficial community plugin. Not affiliated with, endorsed by, or supported by DeepSeek;
  "DeepSeek Harness" is named only to describe compatibility. The code here is original and
  carries no code from the Harness packages.

## License

[MIT](LICENSE)

---
---

# 中文

**按住鼠标说话** —— 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的输入框里长按鼠标即可语音输入，松开后转写并插入草稿，
**不会自动发送**。

## 前置依赖（先读这一节）

本插件**不自带语音识别引擎**，它复用 DeepSeek Harness 已有的那套。所以下面两条必须成立：

1. **官方的语音输入 bundle 处于启用状态。**
   它是随 DSH 一起发布的 `@deepseek-ai/dsh-experimental-voice-input-bundle`（设置 → 插件 →
   「语音输入」/ Voice input）。本插件调用的 `speech` 远程命名空间正是由它挂载的。
   一旦禁用它，本插件会静默不注册任何东西，输入框行为完全恢复原样。

2. **识别模型已经准备好。**
   官方 bundle 使用 SenseVoice **在本机**转写。首次使用需要下载模型文件（约 240 MB）到
   `~/.dsh/speech-to-text/sensevoice/models`（`model.int8.onnx`、`tokens.txt`、`silero_vad.onnx`）。
   打开语音输入 bundle 的详情页点一次「下载并准备」，或者直接点一次内置麦克风按钮并按引导操作。

> 官方 bundle 不支持流式转写，所以文字只会在你松开之后出现。音频是临时的：不会成为 Session
> 事件或附件，只有你之后正式提交的文字才会被记录。

## 安装

**方式 A：直接从 GitHub 安装，无需克隆**

插件管理器接受 git 地址作为安装目标，整条命令就能装完。命令行：

```bash
dsh plugin --profile <profile> add github:jryang1997/dsh-composer-dictation
```

或在任意会话里对 Agent 说：

> 用 `plugin_manager`（`action: install_bundle`）安装 `github:jryang1997/dsh-composer-dictation` 这个 bundle。

**方式 B：从克隆安装**

先克隆再装目录也可以，想改本地代码时用这条路：

```bash
git clone https://github.com/jryang1997/dsh-composer-dictation.git
```

然后安装目录：让 Agent 执行 `plugin_manager`（`action: install_bundle`，`target` 填克隆目录的
绝对路径），或运行：

```bash
dsh plugin --profile <profile> add <克隆下来的绝对路径>
```

> 桌面版应用独占它的 `desktop` profile，所以在桌面版里请对 Agent 说，而不是用命令行。

**验证**

刷新页面（`Ctrl+R`），鼠标移到消息输入框上，右下角会出现提示行。
如果没有出现，打开浏览器控制台确认 Host 半是否激活。

## 使用

| 手势 | 结果 |
|---|---|
| 鼠标移入输入框 | 工具行中间（模式按钮与模型选择器之间）出现一行提示 |
| 按住不动约 0.3 秒 | 指针处先画出一个进度环，随后输入框上方浮起一颗胶囊：一个实心状态点、实时波形、四个字 |
| 松开 | 转写文字插入光标处，**不发送** |
| 录音中或识别中按 `Esc` | 取消 |
| 按住后上滑 ≥48 px，**或把鼠标移出输入框** | 胶囊与输入框外框一起泛红、文字变成「松开丢弃」；在那里松手即丢弃，移回来则保留 |
| 单击、拖拽、拖选文字 | 什么都不发生 —— 进度环自己退回，手势不会激活 |
| **按住 `Ctrl`+`Shift`+`空格`**，然后松开 | 同一套手势，只是不用鼠标：按住和弦开始录音，松开即转写 |
| 点工具行里的**麦克风按钮** | 开关而非按住：按一下开始，再按一下结束。这是键盘与读屏用户真正找得到的入口 |

### 键盘

`Ctrl`+`Shift`+`空格` 就是没有指针的整套手势：按住录音，松开转写，按住时按 `Esc` 丢弃。
它在你处于应用任何位置时都有效，不必先聚焦输入框；而且走的是**完全同一套状态机** ——
胶囊、波形、丢弃红晕、保留转写的胶囊，行为完全一致。

和弦刻意做得不容易误触，并且**只在真正开始录音时才拦截按键**。

另外还有一个**按钮**：工具行里、模型选择器左侧的一枚 28 px 麦克风。它是真正的控件 —— Tab 能到、
回车能按，而它身上的 `aria-keyshortcuts` 正是键盘用户发现快捷键存在的地方。它的模型是**开关**
而不是按住（按一下开始、再按一下结束），因为用按钮去"按住不放"很别扭，而且官方麦克风就是这么做的。

### 设置

「设置 → 插件 → 语音输入」会打开本 bundle 自己的页面。里面只有四项，而且是刻意只有四项：

| 设置项 | 为什么它该由你决定 |
|---|---|
| **按住时长**（150–800 ms，默认 300） | 在所有阈值里，这一项最因人而异 |
| **动效**：完整 / 精简 | 「精简」保留淡入淡出、去掉位移与缩放 —— 和 `prefers-reduced-motion` 是同一种软化，只是一个由你选、一个由系统给 |
| **悬停提示**：开 / 关 | 有人要这个提醒，有人觉得是噪声 |
| **键盘快捷键**：关闭、`Ctrl`+`Shift`+`空格`、`Ctrl`+`Shift`+`D`、`Ctrl`+`Shift`+`M`、`Ctrl`+`Alt`+`空格` | 快捷键冲突是私人的，这正是它值得做成选项的原因 |

**刻意不放进去的**：颜色、材质、圆角、上滑丢弃的距离、波形的物理参数。**这些是设计** ——
一个把这些都摊开的设置页，等于什么都没决定。而语音服务与语言缺席是另一个原因：本插件两个
都不发送，由 Host 自己的语音输入设置说了算，这里再放一份只会和它打架。

这里没有主题设置，因为**本插件没有自己的主题**：它一个颜色都不自带，所有值都读宿主令牌，
所以明暗主题自动跟随。

设置存在**这个浏览器里**，不在你的 DSH profile 里。这是个刻意的取舍 —— 它让插件不依赖任何
`@deepseek-ai/dsh-*` 包（peer range 写错会让 DSH 静默跳过整个 bundle），而这些本来就是
每台机器的偏好，不是该跟着 profile 走的配置。代价是换台机器不携带。

### 出错的时候

失败不是一条一闪而过的提示。它会停在屏幕上直到你处理，因为只有这类消息是在等你回应，
而且它用的是**主动播报**而不是礼貌播报。

| 失败 | 卡片提供什么 |
|---|---|
| Host 转写失败 —— 网络抖动、provider 报错、模型挂了 | **重试**，把你**已经录好的那段**重新发一次。不该让你把同一句话说第二遍 |
| 同一段录音再试也还是会失败 —— 太长、无录音能力、模型没准备、麦克风被拒 | 只有「关闭」，外加一行告诉你去改什么 |

「关闭」或 `Esc` 清掉它。录得太短不算失败，仍会自己消散。

**录音不会接管输入框。** 胶囊浮在卡片上方，卡片本身完全不动，所以你说的整段时间里草稿一直是
可读、可编辑的。

如果识别期间草稿被改动过，转写结果会**保留**在右下角的小胶囊里，点一下即可插入到当前光标。

## 调参

全部在 `client.js` 顶部；没有构建步骤，改完刷新即可。

| 常量 | 默认 | 含义 |
|---|---|---|
| `HOLD_MS` | `300` | 按住多久才算语音输入 |
| `ARM_TOLERANCE_PX` | `10` | 超过这个位移就不激活 |
| `CANCEL_ARM_PX` | `48` | 上滑多少像素进入「松手丢弃」（移出输入框同样会进入） |
| `CANCEL_RELEASE_PX` | `38` | 退回多少才解除 —— 这 10 px 的滞回带就是胶囊不再闪红闪蓝的原因 |
| `CANCEL_FLICK_PX_PER_S` | `150` | 松手速度，优先于位置决定「丢弃还是保留」 |
| `MIN_SECONDS` | `0.35` | 短于此长度的录音直接丢弃 |
| `NOTICE_MS` | `2800` | 一行提示停留多久 |
| `EXIT_MS` | `180` | 任何一个临时表面退场所需时间 |
| `METER_SETTLE_MS` | `240` | 松手后电平轨迹继续消退多久 |

缓动、时长与材质都不在这里手调 —— 它们直接取自宿主应用自己的令牌，见下节。

## 动效

插件刻意不发明自己的动效语汇，而是借用 DeepSeek Harness 的，这样它读起来像应用的一部分，
而不是一个外来户。

| 决定 | 出处 |
|---|---|
| 入场曲线 `cubic-bezier(.16,1,.3,1)` | DSH 自己的菜单与预设座位入场用的曲线 |
| 退场曲线 `cubic-bezier(.4,0,.2,1)` | `--ds-ease-in-out` |
| 140–200 ms 时长 | 落在应用的 `--ds-transition-duration` 区间内 |
| 丢弃态下输入框的那道外框 | `--dsw-radius-panel`，也就是输入框卡片自己的 28 px —— 而应用还通过 `corner-shape: superellipse(1.5)` 把它渲染成超椭圆 |
| 胶囊材质 | `--dsw-specific-menu` 叠 `--dsw-menu-backdrop-filter`，即 `MenuSurface.module.css` 给所有浮动层用的那套配方 |
| 胶囊投影 | `--dsw-elevation-prominent`，宿主给「浮在内容之上」的表面的阴影档 |
| 电平表 | 官方语音输入的波形：28 个 RMS 采样移位寄存器，20 fps 重绘 |

四条规则贯穿始终，并由 `tests/render.test.mjs` 守着：

1. **录音是并行的，不是接管。** 苹果的原则是「聚焦用压暗，并行用分区」：跟手头的事**并行**的
   面板靠半透明与位移来分层，**不压暗背景**。所以胶囊浮在卡片上方、卡片分毫不动，你说的整段
   时间里草稿都可读可写。
2. **入场与退场都是 transition，绝不用 keyframes。** 入场走 `@starting-style`，退场走
   `data-leaving` 属性。凡是用户可能中途反转的动作 —— 按住后改成拖拽、胶囊正在退场时又
   开始新录音 —— 都从它当前实际所在的位置接着走，而不是重播。
3. **只动 `transform` / `opacity` / `translate` / `scale`。** 电平条原先动的是 `height`，
   等于每帧为每根条付一次 layout。
4. **手势是一个连续量，不是布尔值。** 你朝「丢弃」拖了多远是一个数
   （`--dsh-htt-cancel`），红晕、✕ 图标、输入框外框、电平条的退让由它一起驱动，所以状态是被你
   操纵的，而不是被切换的。

文字在这里是最后的选项：胶囊只在「松手会真的丢东西」时才显示一个词。一切正常的时候，
状态点和波形不用任何文字就把话说完了。

## 实现原理

| 环节 | 机制 |
|---|---|
| 渲染位置 | `conversation.input.overlay` 座位的一个条目 —— 输入框卡片内的浮层 |
| 手势面 | 从自身节点 `closest('[data-composer-card]')` 拿到卡片，捕获阶段监听 |
| 提示行位置 | 从工具行量出来：提示行对齐到工具行尾部控件组前面的空档，因此永远不会压住草稿或某个控件 |
| 不干扰打字 | 浮层默认 `pointer-events: none`；达到长按阈值前不做任何 `preventDefault` |
| 录音 | `getUserMedia` + `MediaRecorder` → `OfflineAudioContext` 重采样到 16 kHz 单声道 → 44 字节 PCM16 WAV |
| 识别 | `ctx.remote.speech.transcribe({ audioBase64 })`，provider 与语言由 Host 配置决定 |
| 写草稿 | 座位自带的 `inputActions.captureInsertion()` / `insertText(text, span)`，带 `draftRev` 校验 |
| 样式 | 只用 `--dsw-alias-*` 主题令牌，外加宿主自己的表面 / 材质 / 圆角令牌，因此明暗主题与 `prefers-reduced-transparency` 都正常 |
| 文案 | 通过 `ctx.locale` 注册（`zh`、`en`） |

逐接口的源码笔记（对照发行包核实过）在 [docs/design.md](docs/design.md)。

## 已知限制

- **官方语音展开时，工具行的按钮会被隐藏。** 它住在 `conversation.input.left`，而输入框在官方
  麦克风的 activity 展开时会把这一整组隐藏 —— 所以官方录音期间，和弦是唯一入口。
- **以鼠标为主。** 触摸屏未验证：触摸长按同时会驱动文本选择，阈值大概需要另调。
- **提示行需要空间。** 它待在工具行中间的空档里，所以输入框特别窄时（模式按钮与模型选择器
  之间挤不出空档）它会被直接省掉，而不是允许它压住控件。
- 依赖 DSH 的两个内部接口 —— `conversation.input.overlay` 座位与 `speech` 远程命名空间 ——
  它们可能随 Harness 版本变化。

## 开发

零依赖、无构建步骤。`npm run check` 会解析两个半边、校验 bundle manifest、检查两份文案的
键与占位符是否一致，并把客户端组件在**每一种手势状态**下渲染一遍 —— 其中包含[动效](#动效)
那四条规则，否则它们会悄无声息地退化。CI 里跑的就是这几项。

## 分发与发现

DeepSeek Harness **没有官方插件市场，也没有投稿流程**：官方仓库明确表示目前不接受外部 PR，
它为第三方插件指出的发现机制是 GitHub topic
[`dsh-plugin`](https://github.com/topics/dsh-plugin)。本仓库打上了这个 topic，这就是它被找到的方式。

社区目录会自动索引这个 topic —— 比如
[dsh-market](https://github.com/2BingLing/dsh-market)（[dsh.market](https://dsh.market)），
它的每日爬虫会收集打了 `dsh-plugin` 的仓库，在那里同样无需投稿。

`install_bundle` 也接受 npm 包名，所以发布到 npm 之后，用户可以直接用包名安装、不必走 git：

```text
plugin_manager → action: install_bundle → target: @jryang1997/dsh-composer-dictation
```

## 更新

git 安装是钉在安装时那个提交上的，没有自动更新，出新版本要重装一次：

```text
plugin_manager → action: remove_bundle → target: @jryang1997/dsh-composer-dictation
plugin_manager → action: install_bundle → target: github:jryang1997/dsh-composer-dictation#v1.2.0
```

**必须先 remove**：直接在原行上重装会报 `ambiguous-install`，因为依赖声明本身没有变化。

装完记得刷新页面。客户端半是浏览器模块，不刷新会继续用已经加载的那份。

## 变更日志

每个版本都记在 [`CHANGELOG.md`](CHANGELOG.md) 里（[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式），
并且打了 tag，所以安装可以钉在某个版本上。一句话版：

| 版本 | 这一版在解决什么 |
|---|---|
| [1.4.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.4.0) | 工具行里一个可聚焦的麦克风按钮 —— 键盘入口终于变得找得到 |
| [1.3.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.3.0) | 设置页，以及它逼出来的那个配置模块 |
| [1.2.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.2.0) | 手势有了键盘等价操作；Host 出错时可以就地重试；失败会停下来等你处理，而不是一闪而过 |
| [1.1.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.1.0) | 录音不再接管输入框：悬浮胶囊、按下即有反馈、真正的退场，以及一套借自宿主的动效语汇 |
| [1.0.0](https://github.com/jryang1997/dsh-composer-dictation/releases/tag/v1.0.0) | 长按说话这个手势本身，以及让它安全可用所需的全部东西 |

## 卸载

```text
plugin_manager → action: remove_bundle → target: @jryang1997/dsh-composer-dictation
```

方式 B（目录安装）是以链接方式装的，卸载后删掉克隆目录即可；方式 A（git 安装）装在
profile 内部，无需清理。

## 隐私与声明

- 音频在本机采集，经本地 API 交给 Host 的语音服务，用完即弃；不会成为 Session 事件或附件。
- **如果 Host 配置的是云端语音服务，音频会离开这台机器。** 本插件不指定 `providerId`，
  用的是 Host 已选定的那个 provider —— 默认配置是本机 SenseVoice 本地转写。
  在口述敏感内容前，请先确认「设置 → 插件 → 语音输入」里的选择。
- 插件自身不发起任何网络请求，也不存储任何内容。
- 非官方社区插件，与 DeepSeek 无隶属、背书或支持关系；提及「DeepSeek Harness」仅为说明兼容性。
  本仓库代码为原创，不含 Harness 各包中的代码。

## 许可

[MIT](LICENSE)
