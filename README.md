# dsh-hold-to-talk

**English** · [中文](#中文)

Long-press anywhere on the composer card in [DeepSeek Harness](https://github.com/deepseek-ai) to dictate.
Release to transcribe and drop the text into the draft — nothing is sent automatically.

```
┌──────────────────────────────────────────────┐
│  按住鼠标 语音输入文字            ← fades in  │   ← hover the input box
│                                              │
│  ⌄  ＋  权限  计划            [ model ] [ ➤ ] │
└──────────────────────────────────────────────┘

        hold ≈0.35 s  ↓

┌──────────────────────────────────────────────┐
│         ▁▃▅▇▅▃▁   正在聆听 · 松开完成         │   ← release to transcribe
│                   Esc 取消 · 上滑取消         │
└──────────────────────────────────────────────┘
```

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

DSH plugins are installed from a package directory, so clone first:

```bash
git clone https://github.com/jryang1997/dsh-hold-to-talk.git
```

Then pick one route.

**A. Through the agent (recommended, works in the Desktop app)**

Ask the agent in any session:

> Install the bundle at `<absolute path to the clone>` with `plugin_manager`
> (`action: install_bundle`).

It runs `install_bundle` for the current profile and reports `application: applied`
when the change is live.

**B. Through the CLI**

```bash
dsh plugin --profile <profile> add <absolute path to the clone>
```

> The Desktop application owns its `desktop` profile exclusively, so use route A there.

**C. Verify**

Reload the page (`Ctrl+R`), hover the message box and look for the hint in the lower-right
corner. If it does not appear, open the browser console and check that the host half
activated.

## Usage

| Gesture | Result |
|---|---|
| Hover the input box | The hint fades in over ~0.6 s |
| Press and hold ≈0.35 s without moving | The whole card becomes a recording surface |
| Release | Transcript is inserted at the caret — **not** sent |
| Press `Esc` while recording or transcribing | Cancel |
| Hold, then swipe up ≥72 px, then release | Cancel (the panel turns red first) |
| A plain click, a drag, or selecting text | Nothing happens — the gesture never arms |

If the draft changed while recognition was running, the transcript is **kept** in a small
lower-right chip; click it to insert at the current caret.

## Tuning

Everything lives at the top of `client.js`; there is no build step, so edit and reload.

| Constant | Default | Meaning |
|---|---|---|
| `HOLD_MS` | `350` | How long the press must stay still |
| `ARM_TOLERANCE_PX` | `10` | Movement that disarms the gesture |
| `CANCEL_DISTANCE_PX` | `72` | Upward travel that arms "release to cancel" |
| `MIN_SECONDS` | `0.35` | Recordings shorter than this are dropped |
| `NOTICE_MS` | `2800` | How long a one-line notice stays |

## How it works

| Concern | Mechanism |
|---|---|
| Where it renders | One entry in the `conversation.input.overlay` slot — a floating layer inside the composer card |
| Gesture surface | `node.closest('[data-composer-card]')` from its own node, listening in the capture phase |
| Never disturbing typing | The layer is `pointer-events: none`; nothing is `preventDefault`ed before the hold threshold |
| Recording | `getUserMedia` + `MediaRecorder` → `OfflineAudioContext` resample to 16 kHz mono → 44-byte PCM16 WAV |
| Recognition | `ctx.remote.speech.transcribe({ audioBase64 })`; provider and language come from the Host config |
| Draft insertion | The slot's own `inputActions.captureInsertion()` / `insertText(text, span)`, guarded by `draftRev` |
| Styling | Only `--dsw-alias-*` theme tokens, so light and dark both work |
| Text | Registered through `ctx.locale` (`zh`, `en`) |

## Known limitations

- **Pointer-only.** The long press is the only entry point; there is no keyboard equivalent
  yet, so the feature is not reachable by keyboard alone. A focusable trigger is the obvious
  next addition.
- **Mouse-first.** Touch input is untested: on a touch screen a long press also drives text
  selection, so the thresholds would probably need tuning there.
- It leans on two internal DSH interfaces — the `conversation.input.overlay` slot and the
  `speech` remote — which can change between Harness releases.

## Distribution and discovery

DeepSeek Harness has **no plugin marketplace and no submission process**: the official
repository states that it cannot accept external pull requests at the moment, and the
mechanism it points third-party plugins at is the GitHub topic
[`dsh-plugin`](https://github.com/topics/dsh-plugin). This repository carries that topic, which
is how it is meant to be found.

`install_bundle` also accepts an npm package name, so if this plugin is ever published, a user
could install it by name instead of cloning. Publishing to npm would require renaming the
package from `@local/...` to a scope the publisher owns.

## Uninstall

```text
plugin_manager → action: remove_bundle → target: @local/dsh-hold-to-talk
```

The plugin is installed as a link to the clone, so deleting the clone directory after
removing the bundle is safe.

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

**按住鼠标说话** —— 在 DeepSeek Harness 的输入框里长按鼠标即可语音输入，松开后转写并插入草稿，
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

DSH 插件从包目录安装，先克隆：

```bash
git clone https://github.com/jryang1997/dsh-hold-to-talk.git
```

然后二选一。

**方式 A：让 Agent 装（推荐，桌面版用这个）**

在任意会话里对 Agent 说：

> 用 `plugin_manager`（`action: install_bundle`）安装 `<克隆下来的绝对路径>` 这个 bundle。

它会为当前 profile 执行安装，并返回 `application: applied` 表示已生效。

**方式 B：命令行**

```bash
dsh plugin --profile <profile> add <克隆下来的绝对路径>
```

> 桌面版应用独占它的 `desktop` profile，所以在桌面版里请用方式 A。

**方式 C：验证**

刷新页面（`Ctrl+R`），鼠标移到消息输入框上，右下角会出现提示行。
如果没有出现，打开浏览器控制台确认 Host 半是否激活。

## 使用

| 手势 | 结果 |
|---|---|
| 鼠标移入输入框 | 提示行约 0.6 秒慢慢浮现 |
| 按住不动约 0.35 秒 | 整张输入框变成录音面板 |
| 松开 | 转写文字插入光标处，**不发送** |
| 录音中或识别中按 `Esc` | 取消 |
| 按住后上滑 ≥72 px 再松开 | 取消（面板会先变红提示） |
| 单击、拖拽、拖选文字 | 什么都不发生 —— 手势根本不会激活 |

如果识别期间草稿被改动过，转写结果会**保留**在右下角的小胶囊里，点一下即可插入到当前光标。

## 调参

全部在 `client.js` 顶部；没有构建步骤，改完刷新即可。

| 常量 | 默认 | 含义 |
|---|---|---|
| `HOLD_MS` | `350` | 按住多久才算语音输入 |
| `ARM_TOLERANCE_PX` | `10` | 超过这个位移就不激活 |
| `CANCEL_DISTANCE_PX` | `72` | 上滑多少像素进入"松手取消" |
| `MIN_SECONDS` | `0.35` | 短于此长度的录音直接丢弃 |
| `NOTICE_MS` | `2800` | 一行提示停留多久 |

## 实现原理

| 环节 | 机制 |
|---|---|
| 渲染位置 | `conversation.input.overlay` 座位的一个条目 —— 输入框卡片内的浮层 |
| 手势面 | 从自身节点 `closest('[data-composer-card]')` 拿到卡片，捕获阶段监听 |
| 不干扰打字 | 浮层默认 `pointer-events: none`；达到长按阈值前不做任何 `preventDefault` |
| 录音 | `getUserMedia` + `MediaRecorder` → `OfflineAudioContext` 重采样到 16 kHz 单声道 → 44 字节 PCM16 WAV |
| 识别 | `ctx.remote.speech.transcribe({ audioBase64 })`，provider 与语言由 Host 配置决定 |
| 写草稿 | 座位自带的 `inputActions.captureInsertion()` / `insertText(text, span)`，带 `draftRev` 校验 |
| 样式 | 只用 `--dsw-alias-*` 主题令牌，明暗主题都正常 |
| 文案 | 通过 `ctx.locale` 注册（`zh`、`en`） |

## 已知限制

- **只能用指针。** 长按是唯一入口，目前没有键盘等价操作，纯键盘用户无法触达。加一个可聚焦的
  触发按钮是下一步最该做的事。
- **以鼠标为主。** 触摸屏未验证：触摸长按同时会驱动文本选择，阈值大概需要另调。
- 依赖 DSH 的两个内部接口 —— `conversation.input.overlay` 座位与 `speech` 远程命名空间 ——
  它们可能随 Harness 版本变化。

## 分发与发现

DeepSeek Harness **没有插件市场，也没有投稿流程**：官方仓库明确表示目前不接受外部 PR，
它为第三方插件指出的发现机制是 GitHub topic
[`dsh-plugin`](https://github.com/topics/dsh-plugin)。本仓库打上了这个 topic，这就是它被找到的方式。

`install_bundle` 也接受 npm 包名，所以如果将来发布到 npm，用户就能直接用包名安装、不必克隆。
发布 npm 需要把包名从 `@local/...` 改成发布者自己拥有的 scope。

## 卸载

```text
plugin_manager → action: remove_bundle → target: @local/dsh-hold-to-talk
```

插件是以链接方式安装的，卸载后删掉克隆目录即可。

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
