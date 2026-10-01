/**
 * Hold-to-talk — long-press anywhere on the composer card to dictate.
 *
 * Client half of @jryang1997/dsh-composer-dictation. It mounts one entry into
 * `conversation.input.overlay` (a list slot rendered inside the resident composer
 * card), walks up from its own node to `[data-composer-card]`, and watches pointer
 * events on that card in the capture phase.
 *
 * A press that stays still past HOLD_MS turns the whole card into a recording
 * surface; releasing transcribes through the `speech` Remote and inserts the text
 * with the slot's own `inputActions`. A press that moves or releases earlier is
 * left completely alone, so typing, caret placement and text selection are
 * untouched.
 *
 * Nothing outside this component's subtree is written, and the layer stays
 * `pointer-events: none` until a recording is actually running.
 */
window.__ModuleLoader__.load({
	id: '@jryang1997/dsh-composer-dictation',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'dsh-composer-dictation';
		const SLOT = 'conversation.input.overlay';
		const ENTRY = 'composer-dictation';

		/** How long the pointer must stay still before the composer becomes a microphone. */
		const HOLD_MS = 300;
		/** Movement beyond this disarms the gesture: it was a click, a caret move or a selection. */
		const ARM_TOLERANCE_PX = 10;
		/** Upward travel that arms "release to discard". Leaving the card arms it too. */
		const CANCEL_ARM_PX = 48;
		/**
		 * The disarm threshold, deliberately 10 px *below* the arm threshold. A single
		 * threshold makes a pointer resting on the line flicker the whole bubble between
		 * its normal and discard faces; the band is what turns that into a stable state.
		 */
		const CANCEL_RELEASE_PX = 38;
		/** Upward release speed (px/s) that settles reverse-vs-commit before position does. */
		const CANCEL_FLICK_PX_PER_S = 150;
		/** How much pointer history the release velocity is measured over. */
		const VELOCITY_WINDOW_MS = 90;
		/** Recordings shorter than this are dropped instead of transcribed. */
		const MIN_SECONDS = 0.35;
		/** Kept below the Host default (120 s) so the Host never rejects on duration. */
		const MAX_SECONDS = 110;
		/** Kept below the Host default (4 MiB) so the Host never rejects on size. */
		const MAX_BYTES = 4 * 1024 * 1024 - 4096;
		/** How long a transient surface takes to leave, and how long the press ring retracts. */
		const EXIT_MS = 180;
		const RING_EXIT_MS = 140;
		/** How long a one-line notice stays on screen, and how long its exit runs. */
		const NOTICE_MS = 2800;
		const NOTICE_EXIT_MS = 180;
		/** The meter keeps running after release so the bars fall instead of vanishing. */
		const METER_SETTLE_MS = 240;
		/**
		 * The level meter is the shipped voice-input waveform: a shift register of recent
		 * RMS samples redrawn at 20 fps. The register *is* the smoothing — each new sample
		 * pushes the older ones one bar along, so the trace scrolls instead of flickering.
		 */
		const WAVE_BARS = 28;
		const WAVE_INTERVAL_MS = 50;
		const WAVE_SAMPLE_GAIN = 5;
		const WAVE_MAX_HEIGHT = 17;
		/** Zeros are shifted through faster once recording stops, so the trace drains. */
		const WAVE_DRAIN_PER_TICK = 4;
		/** The press ring. Radius 15.5 draws a 36 px circle; the arc is a dash offset. */
		const RING_RADIUS = 15.5;
		const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

		/** Handles captured in `apply`, so a slot entry that receives no injected props still works. */
		const runtime = { speech: null, limits: null };

		const zh = {
			hint: '按住鼠标语音输入文字 · 上滑取消',
			release: '松开完成',
			cancelHint: 'Esc 取消 · 上滑或移出输入框取消',
			cancelReady: '松开丢弃',
			cancelReadyHint: '松手即丢弃，移回输入框可继续',
			transcribing: '识别中',
			cancelled: '已取消',
			empty: '没有识别到内容，可以说长一点再试',
			conflict: '草稿已改动，转写结果保留在右下角',
			pending: '插入转写',
			pendingHint: '点击插入到当前光标',
			notReady: '语音模型还没准备好：请到「设置 → 插件 → 语音输入」点一次「下载并准备」',
			failed: '转写失败：{message}',
			unavailable: '当前环境无法录音',
			permission: '麦克风不可用，请在系统设置中允许后重试',
			tooLarge: '录音超出语音服务上限，请说短一点',
		};
		const en = {
			hint: 'Hold to dictate · swipe up to cancel',
			release: 'Release to finish',
			cancelHint: 'Esc, or swipe up / leave the box to cancel',
			cancelReady: 'Release to discard',
			cancelReadyHint: 'releasing now discards it — move back to keep it',
			transcribing: 'Transcribing',
			cancelled: 'Cancelled',
			empty: 'Nothing was recognized — try speaking a little longer',
			conflict: 'Draft changed; the transcript is kept at the lower right',
			pending: 'Insert transcript',
			pendingHint: 'Click to insert at the current caret',
			notReady: 'The speech models are not prepared yet: open Settings → Plugins → Voice input and run "Download and prepare" once',
			failed: 'Could not transcribe the recording: {message}',
			unavailable: 'This environment cannot record audio',
			permission: 'Microphone unavailable; allow access in system settings and retry',
			tooLarge: 'That recording is longer than the speech service accepts',
		};

		/**
		 * Last-resort dictionary for the case where a slot entry is handed no translator at
		 * all. DSH always resolves through `ctx.locale` first — its fallback chain ends at
		 * English — so this should never be reached; it exists so that a registration change
		 * can never leave raw keys on screen.
		 */
		const fallbackDictionary = String(navigator.language ?? '').toLowerCase().startsWith('zh') ? zh : en;

		/**
		 * Resolve a label through the slot's own translator, falling back to the local
		 * dictionary so a missing `t` can never surface a raw key in the UI.
		 */
		const translate = (props, key, params) => {
			if (typeof props.t === 'function') {
				const value = props.t(key, params);
				if (typeof value === 'string' && value !== key) return value;
			}
			const template = fallbackDictionary[key] ?? key;
			if (params === undefined) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) =>
				params[name] === undefined ? match : String(params[name]));
		};

		//#region audio

		/** Wrap 16 kHz mono float samples in the exact 44-byte PCM16 WAV header the Host validates. */
		function encodeWave(samples) {
			const length = samples.length;
			const buffer = new ArrayBuffer(44 + length * 2);
			const view = new DataView(buffer);
			const ascii = (offset, value) => {
				for (let index = 0; index < value.length; index += 1) {
					view.setUint8(offset + index, value.charCodeAt(index));
				}
			};
			ascii(0, 'RIFF');
			view.setUint32(4, 36 + length * 2, true);
			ascii(8, 'WAVE');
			ascii(12, 'fmt ');
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, 16000, true);
			view.setUint32(28, 32000, true);
			view.setUint16(32, 2, true);
			view.setUint16(34, 16, true);
			ascii(36, 'data');
			view.setUint32(40, length * 2, true);
			for (let index = 0; index < length; index += 1) {
				const sample = Math.max(-1, Math.min(1, samples[index]));
				view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			}
			return buffer;
		}

		/** Canonical base64 of the whole buffer, chunked so the argument list stays small. */
		function toBase64(buffer) {
			const bytes = new Uint8Array(buffer);
			let binary = '';
			for (let offset = 0; offset < bytes.length; offset += 0x8000) {
				binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
			}
			return window.btoa(binary);
		}

		/** Decode whatever MediaRecorder produced and re-render it as 16 kHz mono PCM16 WAV. */
		async function toSixteenKilohertz(blob) {
			const bytes = await blob.arrayBuffer();
			const decoder = new AudioContext();
			try {
				const decoded = await decoder.decodeAudioData(bytes);
				const seconds = Math.min(decoded.duration, MAX_SECONDS);
				const frames = Math.max(1, Math.round(seconds * 16000));
				const offline = new OfflineAudioContext(1, frames, 16000);
				const source = offline.createBufferSource();
				source.buffer = decoded;
				source.connect(offline.destination);
				source.start(0);
				const rendered = await offline.startRendering();
				return { buffer: encodeWave(rendered.getChannelData(0)), seconds: rendered.duration };
			} finally {
				await decoder.close().catch(() => undefined);
			}
		}

		/** One microphone capture: permission, chunks, live level, and the encoded result. */
		function createCapture() {
			const chunks = [];
			let stream = null;
			let recorder = null;
			let context = null;
			let analyser = null;
			let failure = null;
			let released = false;

			const release = () => {
				if (released) return;
				released = true;
				try {
					if (recorder !== null && recorder.state !== 'inactive') recorder.stop();
				} catch (error) {
					/* already torn down */
				}
				if (stream !== null) for (const track of stream.getTracks()) track.stop();
				stream = null;
				recorder = null;
				analyser = null;
				if (context !== null) {
					context.close().catch(() => undefined);
					context = null;
				}
			};

			return {
				async start() {
					if (typeof MediaRecorder === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
						throw new Error('media-recorder-unavailable');
					}
					stream = await navigator.mediaDevices.getUserMedia({
						audio: {
							channelCount: 1,
							echoCancellation: true,
							noiseSuppression: true,
							autoGainControl: true,
						},
						video: false,
					});
					if (released) {
						for (const track of stream.getTracks()) track.stop();
						return;
					}
					context = new AudioContext();
					analyser = context.createAnalyser();
					analyser.fftSize = 256;
					context.createMediaStreamSource(stream).connect(analyser);
					recorder = new MediaRecorder(stream);
					recorder.addEventListener('dataavailable', (event) => {
						if (event.data !== undefined && event.data.size > 0) chunks.push(event.data);
					});
					// A device lost mid-capture may never emit `stop`; record the reason and let
					// `stop()` bail out instead of awaiting an event that will not arrive.
					recorder.addEventListener('error', (event) => {
						failure = event?.error instanceof Error ? event.error : new Error('recorder-failed');
					});
					recorder.start(200);
				},
				/**
				 * RMS amplitude of the current frame — the same measure the shipped voice input
				 * uses, and deliberately *unclamped*: the waveform applies its own gain when it
				 * draws, so clamping here would flatten loud speech into a solid block.
				 */
				level() {
					if (analyser === null || released) return 0;
					const frame = new Float32Array(analyser.fftSize);
					analyser.getFloatTimeDomainData(frame);
					let sum = 0;
					for (let index = 0; index < frame.length; index += 1) {
						sum += frame[index] * frame[index];
					}
					return Math.sqrt(sum / frame.length);
				},
				async stop() {
					if (recorder !== null && recorder.state !== 'inactive') {
						await new Promise((resolve) => {
							// Bounded: a wedged recorder must never hang the composer UI, and the
							// microphone has to be released either way.
							const timer = window.setTimeout(resolve, 4000);
							const settle = () => {
								window.clearTimeout(timer);
								resolve();
							};
							recorder.addEventListener('stop', settle, { once: true });
							recorder.addEventListener('error', settle, { once: true });
							try {
								recorder.stop();
							} catch (error) {
								settle();
							}
						});
					}
					const blob = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' });
					const reason = failure;
					release();
					if (reason !== null) throw reason;
					if (blob.size === 0) return { buffer: encodeWave(new Float32Array(0)), seconds: 0 };
					return await toSixteenKilohertz(blob);
				},
				dispose: release,
			};
		}

		//#endregion

		//#region styles

		/**
		 * Every curve, duration and material here is borrowed from the host app rather than
		 * invented, so the plugin reads as part of DSH instead of as a guest:
		 *
		 * - `cubic-bezier(.16,1,.3,1)` is the curve DSH's own menus and preset seats enter on.
		 * - `cubic-bezier(.4,0,.2,1)` is its `--ds-ease-in-out`.
		 * - 140–200 ms sits inside its `--ds-transition-duration` band.
		 * - The translucent surface is the `MenuSurface` recipe the host uses for every
		 *   floating layer: `--dsw-menu-surface-fill` over `--dsw-menu-backdrop-filter`.
		 * - `--dsw-radius-panel` is the composer card's own 28 px, and the app runs with
		 *   `corner-shape: superellipse(1.5)` globally, so matching the radius matches the
		 *   squircle too.
		 *
		 * Two rules hold throughout. Motion is `transform`/`opacity`/`translate`/`scale` only,
		 * never a layout property. And every state change is a *transition* — entry rides
		 * `@starting-style` and exit a `data-leaving` attribute — never a keyframe, so
		 * anything the user reverses mid-flight resumes from where it actually is.
		 */
		const STYLES = `
.dsh-htt-layer{
  --dsh-htt-out:cubic-bezier(.16,1,.3,1);
  --dsh-htt-in-out:cubic-bezier(.4,0,.2,1);
  --dsh-htt-t-press:140ms;
  --dsh-htt-t-base:200ms;
  --dsh-htt-t-exit:${EXIT_MS}ms;
  --dsh-htt-hold:${HOLD_MS}ms;
}

/* ---- press ring: the 300 ms before the bubble exists ------------------- */
.dsh-htt-ring{
  position:absolute; width:36px; height:36px; margin:-18px 0 0 -18px;
  color:var(--dsw-alias-label-secondary); pointer-events:none;
  transition:opacity var(--dsh-htt-t-press) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-ring{opacity:0}}
/*
 * The ring waits 110 ms before appearing. Clicking into the text field is the most
 * common thing anyone does in this composer, and a ring that flashes on every caret
 * move would be noise; a press that is still going after 110 ms is a hold.
 */
.dsh-htt-ring{transition-delay:110ms}
.dsh-htt-ring[data-leaving]{opacity:0;transition-delay:0ms;transition-duration:120ms}
.dsh-htt-ring-track{opacity:.16}
/*
 * The arc is the hold progress. Because it is a transition, disarming simply
 * retargets the dash offset back to full and the ring drains from wherever it
 * had actually reached — no restart, no jump.
 */
.dsh-htt-ring-arc{
  transform:rotate(-90deg); transform-origin:50% 50%;
  stroke-dasharray:${RING_LENGTH.toFixed(2)}; stroke-dashoffset:0;
  transition:stroke-dashoffset var(--dsh-htt-hold) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-ring-arc{stroke-dashoffset:${RING_LENGTH.toFixed(2)}}}
.dsh-htt-ring[data-leaving] .dsh-htt-ring-arc{
  stroke-dashoffset:${RING_LENGTH.toFixed(2)};
  transition:stroke-dashoffset 140ms var(--dsh-htt-in-out);
}

/* ---- hover hint: parked in the tool row, never over the draft ---------- */
.dsh-htt-hint{
  position:absolute; display:flex; align-items:center; gap:6px; height:18px;
  font-size:13px; line-height:18px; letter-spacing:.01em;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  user-select:none; pointer-events:none;
  opacity:0; translate:0 3px;
  transition:opacity var(--dsh-htt-t-press) var(--dsh-htt-out),
             translate var(--dsh-htt-t-press) var(--dsh-htt-out);
}
.dsh-htt-hint[data-on]{
  opacity:1; translate:0 0; transition-duration:var(--dsh-htt-t-base);
}

/* ---- retained transcript ---------------------------------------------- */
.dsh-htt-pending{
  position:absolute; display:flex; align-items:center; gap:6px;
  box-sizing:border-box; height:26px; padding:0 9px;
  border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l2);
  box-shadow:var(--dsw-elevation-stroke);
  color:var(--dsw-alias-label-primary);
  font-size:13px; line-height:18px; letter-spacing:.01em;
  white-space:nowrap; cursor:pointer; user-select:none;
  transition:opacity var(--dsh-htt-t-base) var(--dsh-htt-out),
             translate var(--dsh-htt-t-base) var(--dsh-htt-out),
             scale var(--dsh-htt-t-press) var(--dsh-htt-out);
}
.dsh-htt-pending:active{scale:.96}
@starting-style{.dsh-htt-pending{opacity:0; translate:0 4px}}
.dsh-htt-pending[data-leaving]{
  opacity:0; translate:0 3px; scale:.97;
  /* An invisible chip must stop being clickable, or a double-click inserts twice. */
  pointer-events:none;
  transition-duration:var(--dsh-htt-t-exit);
  transition-timing-function:var(--dsh-htt-in-out);
}

/* ---- the recording bubble: a capsule that grows out of the composer ----- */
/*
 * Recording does not take the composer over. Apple's rule is "dim to focus, separate to
 * keep flow": a panel that runs *alongside* what you are doing uses translucency and
 * offset without a scrim, so the flow is never broken. So the bubble floats above the
 * card and the card itself is left alone — your draft stays readable and typeable for
 * the whole recording. That also retires the old failure mode where a full-bleed panel
 * turned its own exit into a 180 ms invisible shield over the editor.
 *
 * The bubble never accepts pointer events, so there is nothing here that can swallow a
 * click; the only thing the card shows is a hairline when a release would discard.
 */
.dsh-htt-bubble{
  position:absolute; bottom:calc(100% + 10px); left:0; right:0;
  display:flex; justify-content:center;
  transform-origin:bottom center;
  pointer-events:none;
  transition:opacity var(--dsh-htt-t-base) var(--dsh-htt-out),
             scale var(--dsh-htt-t-base) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-bubble{opacity:0; scale:.9}}
.dsh-htt-bubble[data-leaving]{
  opacity:0; scale:.94;
  transition-duration:var(--dsh-htt-t-exit);
  transition-timing-function:var(--dsh-htt-in-out);
}
.dsh-htt-pill{
  position:relative; box-sizing:border-box;
  display:flex; align-items:center; gap:10px;
  height:40px; padding:0 15px;
  border-radius:999px;
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent);
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
  /* The bubble lifts as you drag: the gesture's direction is drawn, not just detected. */
  translate:0 calc(var(--dsh-htt-cancel,0) * -6px);
  transition:translate 120ms var(--dsh-htt-out);
}
/* The host's own translucent-layer recipe, copied from MenuSurface.module.css. */
.dsh-htt-material{
  position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2));
  backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));
  -webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));
}
/*
 * The discard wash. One opacity number drives the whole red state — the pill's ring, its
 * tint and the card's hairline — so it is continuous and reversible, never a hard cut.
 */
.dsh-htt-alarm{
  position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  border:1px solid var(--dsw-alias-state-error-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
  opacity:var(--dsh-htt-cancel,0);
  transition:opacity 100ms linear;
}
/* The card's own outline, so the discard state is visible at the draft too. */
.dsh-htt-edge{
  position:absolute; inset:0; border-radius:var(--dsw-radius-panel);
  border:1px solid var(--dsw-alias-state-error-primary);
  pointer-events:none;
  opacity:var(--dsh-htt-cancel,0);
  transition:opacity 100ms linear;
}
.dsh-htt-body{
  position:relative; z-index:1;
  display:flex; align-items:center; gap:10px;
}

/* ---- state mark: a mic-is-live dot that becomes the discard cross ------ */
.dsh-htt-mark{position:relative; flex:0 0 auto; width:16px; height:16px; display:grid; place-items:center}
.dsh-htt-dot{
  position:absolute; inset:0; display:grid; place-items:center;
  opacity:calc(1 - var(--dsh-htt-cancel,0) * 1.6);
  transition:opacity 100ms linear;
}
.dsh-htt-dot-core{
  width:7px; height:7px; border-radius:50%;
  background:var(--dsw-alias-state-business-primary);
}
/*
 * While recording the waveform is the activity, so the dot only marks that the mic is
 * live and stays still. It earns an animation only once transcribing drains the
 * waveform, because then it is the only thing left that can say "still working".
 */
.dsh-htt-mark[data-state=transcribing] .dsh-htt-dot-core{
  background:var(--dsw-alias-label-tertiary);
  animation:dsh-htt-breathe 1.4s ease-in-out infinite alternate;
}
@keyframes dsh-htt-breathe{from{opacity:.35}to{opacity:1}}
.dsh-htt-cross{
  position:absolute; inset:0; display:grid; place-items:center;
  color:var(--dsw-alias-state-error-primary);
  opacity:calc(var(--dsh-htt-cancel,0) * var(--dsh-htt-cancel,0));
  scale:calc(.8 + var(--dsh-htt-cancel,0) * .2);
  transition:opacity 100ms linear, scale 100ms linear;
}

/* ---- level meter ------------------------------------------------------- */
.dsh-htt-slot{position:relative; flex:0 0 auto; width:112px; height:22px}
.dsh-htt-wave{
  position:absolute; inset:0; display:block;
  color:var(--dsw-alias-label-secondary);
  opacity:calc(1 - var(--dsh-htt-cancel,0) * .85);
  scale:calc(1 - var(--dsh-htt-cancel,0) * .16);
  transition:opacity 100ms linear, scale 100ms linear;
}

/* ---- one short label: text appears only where a mistake is possible ----- */
.dsh-htt-row{display:grid; align-items:center}
.dsh-htt-row > *{
  grid-area:1 / 1; white-space:nowrap;
  font-size:13px; line-height:18px; font-weight:500; letter-spacing:.01em;
  color:var(--dsw-alias-label-primary);
  opacity:0; translate:0 2px;
  transition:opacity 120ms var(--dsh-htt-out), translate 140ms var(--dsh-htt-out);
}
.dsh-htt-row > [data-on]{opacity:1; translate:0 0; transition-duration:var(--dsh-htt-t-base)}
.dsh-htt-row > [data-tone=error]{color:var(--dsw-alias-state-error-primary)}

/* ---- one-line notice --------------------------------------------------- */
.dsh-htt-notice{
  position:absolute; display:flex; align-items:center; gap:6px;
  box-sizing:border-box; height:26px; padding:0 10px;
  border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-stroke);
  font-size:13px; line-height:18px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; user-select:none;
  color:var(--dsw-alias-label-secondary);
  transition:opacity var(--dsh-htt-t-base) var(--dsh-htt-out),
             translate var(--dsh-htt-t-base) var(--dsh-htt-out);
}
.dsh-htt-notice[data-tone=error]{
  color:var(--dsw-alias-state-error-primary);
  --dsw-elevation-stroke-color:var(--dsw-alias-state-error-primary);
}
@starting-style{.dsh-htt-notice{opacity:0; translate:0 5px}}
.dsh-htt-notice[data-leaving]{
  opacity:0; translate:0 3px;
  transition-duration:var(--dsh-htt-t-exit);
  transition-timing-function:var(--dsh-htt-in-out);
}

@media (prefers-reduced-motion:reduce){
  /* Gentler, not none: opacity and colour stay, movement goes. */
  .dsh-htt-hint,.dsh-htt-pending,.dsh-htt-notice,.dsh-htt-row > *{
    translate:none!important; scale:none!important;
    transition:opacity 140ms linear!important;
  }
  .dsh-htt-bubble{scale:none!important; transition:opacity 140ms linear}
  .dsh-htt-pill{translate:none!important}
  .dsh-htt-wave,.dsh-htt-cross{scale:none!important; transition:opacity 140ms linear}
  .dsh-htt-mark[data-state=transcribing] .dsh-htt-dot-core{animation:none; opacity:.7}
  .dsh-htt-ring,.dsh-htt-ring-arc{transition-duration:1ms!important}
  @starting-style{.dsh-htt-bubble{scale:none; opacity:0}}
}
@media (prefers-reduced-transparency:reduce){
  .dsh-htt-material{
    background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));
    backdrop-filter:none; -webkit-backdrop-filter:none;
  }
}
@media (prefers-contrast:more){
  .dsh-htt-material{
    background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));
    backdrop-filter:none; -webkit-backdrop-filter:none;
  }
  .dsh-htt-pill{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3)}
}
`;

		const layerStyle = (height) => ({
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			height,
			pointerEvents: 'none',
		});

		/**
		 * The notice and the retained-transcript chip share a seat: just above the tool row,
		 * right-aligned. Both are opaque chips, so covering part of the draft is a deliberate
		 * interruption rather than a legibility problem.
		 *
		 * The *hint* is bare text and is deliberately not here — it is parked in the tool
		 * row's empty middle so it can never land on the user's own writing.
		 */
		const cornerStyle = (rowHeight) => ({
			position: 'absolute',
			right: '14px',
			bottom: `${rowHeight + 6}px`,
			maxWidth: '76%',
		});

		/**
		 * `hintRight` and `hintMax` come from `measure()`: the hint's right edge is aimed at
		 * the gap in front of the tool row's trailing group, and `hintMax` is that gap. When
		 * the row is too narrow for the whole line it truncates rather than overlapping a
		 * control, and below 48 px of room it is not rendered at all.
		 */
		const hintStyle = (box) => ({
			right: `${box.hintRight}px`,
			bottom: `${Math.max(4, (box.rowHeight - 18) / 2)}px`,
			maxWidth: `${box.hintMax}px`,
		});

		const pendingStyle = (box) => ({ ...cornerStyle(box.rowHeight), pointerEvents: 'auto' });

		const noticeStyle = (box) => cornerStyle(box.rowHeight);

		/** Small microphone glyph, drawn inline so the plugin carries no assets. */
		function MicGlyph({ size = 14 }) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: '0 0 auto' } },
				h('path', {
					d: 'M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5Z',
					fill: 'currentColor',
				}),
				h('path', {
					d: 'M3.75 7.5a.75.75 0 0 1 1.5 0v.5a2.75 2.75 0 0 0 5.5 0v-.5a.75.75 0 0 1 1.5 0v.5a4.25 4.25 0 0 1-3.5 4.19v1.06h1.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5h1.5v-1.06A4.25 4.25 0 0 1 3.75 8Z',
					fill: 'currentColor',
				}),
			);
		}

		/** Circle-and-cross, shown once releasing would discard the recording. */
		function DiscardGlyph({ size = 13 }) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: '0 0 auto' } },
				h('path', {
					d: 'M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					fill: 'none',
				}),
			);
		}

		/** A small mark that tells the three notice tones apart at a glance. */
		function NoticeGlyph({ tone }) {
			const common = {
				width: 13,
				height: 13,
				viewBox: '0 0 16 16',
				'aria-hidden': true,
				style: { flex: '0 0 auto' },
			};
			if (tone === 'error') {
				return h(
					'svg',
					common,
					h('path', {
						d: 'M8 2.2 14.4 13.4H1.6Z',
						fill: 'none',
						stroke: 'currentColor',
						strokeWidth: 1.4,
						strokeLinejoin: 'round',
					}),
					h('path', {
						d: 'M8 6.1v3.1M8 11.2v.1',
						stroke: 'currentColor',
						strokeWidth: 1.4,
						strokeLinecap: 'round',
					}),
				);
			}
			if (tone === 'muted') {
				return h(
					'svg',
					common,
					h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
					h('path', { d: 'M4.1 11.9 11.9 4.1', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
				);
			}
			return h(
				'svg',
				common,
				h('path', {
					d: 'M3.4 8.4 6.5 11.5 12.6 5.2',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
			);
		}

		//#endregion

		//#region component

		/** Prefer the entry's injected `transcribe`; fall back to the Remote captured at activation. */
		function resolveTranscribe(props) {
			if (typeof props.transcribe === 'function') return props.transcribe;
			if (runtime.speech === null) return undefined;
			return (request, signal) => runtime.speech.transcribe(request, signal);
		}

		const IDLE = {
			phase: 'idle', notice: '', tone: 'info', leaving: false, cancelled: false, pending: '',
			pendingLeaving: false, bubbleLeaving: false, arm: null, armLeaving: false,
		};
		/** The phases that put the recording bubble on screen. */
		const BUSY_PHASES = new Set(['recording', 'transcribing']);
		/** Below this much room in the tool row the hint is dropped rather than overlapped. */
		const HINT_MIN_PX = 48;

		function HoldToTalk(props) {
			const root = React.useRef(null);
			const wave = React.useRef(null);
			const [hovered, setHovered] = React.useState(false);
			const [view, setView] = React.useState(IDLE);
			const [box, setBox] = React.useState({ height: 0, rowHeight: 0, hintRight: 14, hintMax: 0 });
			const latest = React.useRef(null);
			latest.current = { props, view, setHovered, setView };
			// Notices live and die on timers owned by the setup effect below, so that the exit
			// animation can run before the element unmounts. A React effect cannot do this:
			// its dependency on `view` would restart the countdown the moment it re-renders.

			React.useEffect(() => {
				const node = root.current;
				if (node === null) return undefined;
				const card = node.closest('[data-composer-card]');
				if (card === null) {
					console.warn('dsh-composer-dictation: [data-composer-card] not found; the composer layout changed');
					return undefined;
				}

				/**
				 * Real boxes for a row's children.
				 *
				 * DSH renders slot wrappers as `div[data-slot]` with `display: contents`, and a
				 * `display: contents` element has an all-zero rect. When every direct child is
				 * one of those, the measurements have to come from one level deeper, where the
				 * actual groups live.
				 */
				const collectBoxes = (row) => {
					const boxes = (nodes) => Array.from(nodes)
						.map((child) => child.getBoundingClientRect())
						.filter((child) => child.width > 0);
					const direct = boxes(row.children);
					return direct.length > 0 ? direct : boxes(row.querySelectorAll(':scope > * > *'));
				};

				/**
				 * The card is `[overlayAnchor, (accessory), (attachments), DraftEditor, row]`, so
				 * its last element child is the tool row.
				 *
				 * The hint is aimed at that row's empty middle: the row is
				 * `justify-content: space-between`, so its trailing group is the first child
				 * whose box starts in the right half, and the gap in front of that group is the
				 * one place a hint can sit without covering a control *or* the user's own
				 * writing. When no such gap exists the hint is dropped rather than overlapped.
				 */
				const measure = () => {
					const rect = card.getBoundingClientRect();
					const row = card.lastElementChild;
					let rowHeight = 0;
					let hintRight = 14;
					let hintMax = 0;
					if (row !== null) {
						const rowRect = row.getBoundingClientRect();
						rowHeight = rowRect.height;
						const boxes = collectBoxes(row);
						const trailing = boxes.find((child) => child.left > rowRect.left + rowRect.width / 2);
						if (trailing !== undefined) {
							hintRight = Math.max(12, rect.right - trailing.left + 12);
							const leading = boxes.filter((child) => child.right <= trailing.left - 12).pop();
							const floor = leading === undefined ? rect.left + 12 : leading.right + 12;
							hintMax = Math.max(0, trailing.left - 12 - floor);
						}
					}
					setBox({ height: rect.height, rowHeight, hintRight, hintMax });
				};
				measure();
				const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
				if (observer !== null) observer.observe(card);
				window.addEventListener('resize', measure);

				const state = {
					timer: 0,
					limit: 0,
					noticeHold: 0,
					noticeExit: 0,
					bubbleExit: 0,
					pendingExit: 0,
					ringExit: 0,
					raf: 0,
					meter: 0,
					meterStop: 0,
					run: 0,
					active: false,
					busy: false,
					cancelled: false,
					level: 0,
					capture: null,
					starting: null,
					span: null,
					abort: null,
					x: 0,
					y: 0,
					samples: [],
					waveAt: -Infinity,
					waveLines: null,
					waveLevels: null,
					waveDraining: false,
				};

				const say = (key, params) => translate(latest.current.props, key, params);

				const clearTimeoutOf = (key) => {
					if (state[key] !== 0) {
						window.clearTimeout(state[key]);
						state[key] = 0;
					}
				};

				const clearNotice = () => {
					clearTimeoutOf('noticeHold');
					clearTimeoutOf('noticeExit');
				};

				const clearBubbleExit = () => clearTimeoutOf('bubbleExit');
				const clearPendingExit = () => clearTimeoutOf('pendingExit');

				/** Merge a patch without touching the notice or the bubble lifetime. */
				const patch = (values) => latest.current.setView((current) => ({ ...current, ...values }));

				/**
				 * Publish a phase change. Two surfaces get a two-stage lifetime so their exit
				 * can actually play before they unmount:
				 *
				 * - a notice holds for NOTICE_MS, dissolves for NOTICE_EXIT_MS, then clears;
				 * - the bubble survives one EXIT_MS after the last busy phase, so releasing the
				 *   button ends with the surface withdrawing rather than blinking out.
				 *
				 * Both are plain `data-leaving` flags driving CSS transitions, so a recording
				 * started during an exit simply retargets and the bubble comes back.
				 */
				const show = (patchValues) => {
					if (patchValues.phase !== undefined) {
						if (patchValues.phase !== 'notice') clearNotice();
						clearBubbleExit();
						const leaving = BUSY_PHASES.has(latest.current.view.phase)
							&& !BUSY_PHASES.has(patchValues.phase);
						latest.current.setView((current) => ({
							...current,
							leaving: false,
							bubbleLeaving: leaving,
							...patchValues,
						}));
						if (leaving) {
							state.bubbleExit = window.setTimeout(() => {
								state.bubbleExit = 0;
								patch({ bubbleLeaving: false });
							}, EXIT_MS);
						}
					} else {
						latest.current.setView((current) => ({ ...current, leaving: false, ...patchValues }));
					}
					if (patchValues.phase !== 'notice') return;
					clearNotice();
					state.noticeHold = window.setTimeout(() => {
						state.noticeHold = 0;
						patch({ leaving: true });
						state.noticeExit = window.setTimeout(() => {
							state.noticeExit = 0;
							patch({ phase: 'idle', notice: '', leaving: false });
						}, NOTICE_EXIT_MS);
					}, NOTICE_MS);
				};

				/**
				 * Dismiss the retained transcript. It gets the same exit as everything else, so
				 * a successful insert ends by folding away instead of disappearing.
				 */
				const dropPending = () => {
					clearPendingExit();
					if (latest.current.view.pending === '') return;
					patch({ pendingLeaving: true });
					state.pendingExit = window.setTimeout(() => {
						state.pendingExit = 0;
						patch({ pending: '', pendingLeaving: false });
					}, EXIT_MS);
				};

				/** Retract the press ring, then unmount it once the fade has run. */
				const dropRing = () => {
					clearTimeoutOf('ringExit');
					if (latest.current.view.arm === null) return;
					patch({ armLeaving: true });
					state.ringExit = window.setTimeout(() => {
						state.ringExit = 0;
						patch({ arm: null, armLeaving: false });
					}, RING_EXIT_MS);
				};

				const failure = (error) => {
					const name = error instanceof Error ? error.name : '';
					if (name === 'NotAllowedError' || name === 'SecurityError') return say('permission');
					if (name === 'NotFoundError' || name === 'NotReadableError') return say('unavailable');
					return failureNotice(error instanceof Error ? error.message : String(error));
				};

				/** Turn a Host-side recognition error into a line the user can act on. */
				const failureNotice = (message) => {
					if (/prepare/i.test(message)) return say('notReady');
					return say('failed', { message });
				};

				const clearTimer = () => {
					if (state.timer !== 0) {
						window.clearTimeout(state.timer);
						state.timer = 0;
					}
				};

				const clearLimit = () => {
					if (state.limit !== 0) {
						window.clearTimeout(state.limit);
						state.limit = 0;
					}
				};

				const detach = () => {
					window.removeEventListener('pointermove', onMove, true);
					window.removeEventListener('pointerup', onUp, true);
					window.removeEventListener('pointercancel', onCancel, true);
				};

				/**
				 * Drag-to-discard is tracked as one continuous quantity.
				 *
				 * `--dsh-htt-cancel` (0..1) drives the red wash, the discard glyph and the
				 * meter's retreat, so the whole state is a single number the user is steering
				 * 1:1 rather than a boolean that flips. The boolean is still needed for the
				 * label, and it is hysteretic — armed at 48 px, disarmed at 38 px — because a
				 * pointer resting exactly on one threshold would otherwise flicker the bubble
				 * between its two faces.
				 */
				const applyCancel = (level) => {
					state.level = level;
					// Written on the layer so the bubble, the card's hairline and the meter all
					// read the same number without a re-render per pointermove.
					const element = root.current;
					if (element !== null) element.style.setProperty('--dsh-htt-cancel', level.toFixed(3));
				};

				const setCancelArmed = (armed) => {
					if (state.cancelled === armed) return;
					state.cancelled = armed;
					patch({ cancelled: armed });
				};

				const track = (event) => {
					const samples = state.samples;
					samples.push({ t: event.timeStamp, y: event.clientY });
					// Prune by time, not by count: the sample rate varies with the mouse, and a
					// fixed count would average a fast flick over a long, slow window.
					const cutoff = event.timeStamp - VELOCITY_WINDOW_MS * 2;
					while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
				};

				/** Pointer velocity in px/s over the last VELOCITY_WINDOW_MS; positive is down. */
				const velocity = () => {
					const samples = state.samples;
					if (samples.length < 2) return 0;
					const last = samples[samples.length - 1];
					let first = samples[0];
					for (const sample of samples) {
						if (last.t - sample.t <= VELOCITY_WINDOW_MS) {
							first = sample;
							break;
						}
					}
					const elapsed = last.t - first.t;
					return elapsed <= 0 ? 0 : ((last.y - first.y) / elapsed) * 1000;
				};

				/**
				 * Leaving the card counts as arming: the card is short, so an upward drag
				 * reaches its edge before it reaches the distance threshold, and a silent
				 * cancel there is exactly the wrong feedback. Everything here is reversible.
				 */
				const updateCancel = (event) => {
					const outside = !(event.target instanceof Node) || !card.contains(event.target);
					const upward = state.y - event.clientY;
					const threshold = state.cancelled ? CANCEL_RELEASE_PX : CANCEL_ARM_PX;
					setCancelArmed(outside || upward >= threshold);
					applyCancel(outside ? 1 : Math.max(0, Math.min(1, upward / CANCEL_ARM_PX)));
				};

				const resetGesture = () => {
					state.cancelled = false;
					state.level = 0;
					state.samples = [];
					const element = root.current;
					if (element !== null) element.style.setProperty('--dsh-htt-cancel', '0');
				};

				const cancel = (silent) => {
					clearTimer();
					clearLimit();
					detach();
					dropRing();
					const capture = state.capture;
					state.capture = null;
					state.starting = null;
					state.active = false;
					state.busy = false;
					state.span = null;
					state.run += 1;
					resetGesture();
					// Every other path stops the meter; without this one a cancel leaves the
					// rAF loop re-arming itself forever, since its token never changes.
					stopMeter(true);
					if (state.abort !== null) state.abort.abort();
					state.abort = null;
					if (capture !== null) capture.dispose();
					if (silent) show({ phase: 'idle', notice: '', cancelled: false });
					else show({ phase: 'notice', notice: say('cancelled'), tone: 'muted', cancelled: false });
				};

				/**
				 * The level meter, taken from the shipped voice-input waveform: a shift register
				 * of recent RMS samples redrawn at 20 fps.
				 *
				 * The register *is* the smoothing. Each tick pushes the previous value one bar
				 * along, so the trace scrolls and every bar carries history — which is what
				 * makes it read as a voice rather than as a bouncing equaliser. Nothing here
				 * touches layout: only two SVG attributes per line.
				 */
				const startMeter = (capture) => {
					// A previous drain may still be pending; its timer must not stop this run.
					clearTimeoutOf('meterStop');
					state.waveDraining = false;
					const token = ++state.meter;
					const tick = (now) => {
						if (state.meter !== token) return;
						state.raf = window.requestAnimationFrame(tick);
						if (now - state.waveAt < WAVE_INTERVAL_MS) return;
						state.waveAt = now;
						const svg = wave.current;
						if (svg === null) return;
						if (state.waveLines === null) {
							// Newest sample arrives at the right and history scrolls left, as upstream.
							state.waveLines = Array.from(svg.querySelectorAll('line')).reverse();
							state.waveLevels = state.waveLines.map(() => 0);
						}
						const lines = state.waveLines;
						const levels = state.waveLevels;
						const shifts = state.waveDraining ? WAVE_DRAIN_PER_TICK : 1;
						let next = state.waveDraining ? 0 : capture.level();
						for (let step = 0; step < shifts; step += 1) {
							for (let index = 0; index < levels.length; index += 1) {
								const previous = levels[index];
								levels[index] = next;
								next = previous;
							}
						}
						for (let index = 0; index < lines.length; index += 1) {
							const height = 1 + Math.min(1, levels[index] * WAVE_SAMPLE_GAIN) * WAVE_MAX_HEIGHT;
							lines[index].setAttribute('y1', String(20 - height));
							lines[index].setAttribute('y2', String(20 + height));
						}
					};
					state.raf = window.requestAnimationFrame(tick);
				};

				/**
				 * Stop metering. The trace is drained first so the bars fall away instead of
				 * vanishing with the bubble — the one piece of the recording that should linger.
				 */
				const stopMeter = (drain) => {
					clearTimeoutOf('meterStop');
					if (!drain) {
						state.meter += 1;
						return;
					}
					state.waveDraining = true;
					state.meterStop = window.setTimeout(() => {
						state.meterStop = 0;
						state.meter += 1;
					}, METER_SETTLE_MS);
				};

				async function begin() {
					const actions = latest.current.props.inputActions;
					if (actions === undefined || actions === null) return;
					const run = ++state.run;
					// A hold that starts while a previous transcription is still in flight
					// abandons that request: the run check discards its result anyway, and
					// left running it would spend the provider call twice.
					if (state.abort !== null) state.abort.abort();
					state.active = true;
					state.busy = true;
					state.span = actions.captureInsertion();
					state.abort = new AbortController();
					resetGesture();
					const capture = createCapture();
					state.capture = capture;
					state.waveLines = null;
					state.waveLevels = null;
					state.waveDraining = false;
					state.waveAt = -Infinity;
					show({ phase: 'recording', notice: '', cancelled: false });
					// The ring has done its job; the bubble takes the story from here.
					dropRing();

					// The Host caps recording length; stop on our own so a forgotten press cannot
					// grow the chunk buffer without bound and then be rejected on arrival.
					const limitSeconds = Math.min(MAX_SECONDS, runtime.limits?.maxDurationSeconds ?? MAX_SECONDS);
					state.limit = window.setTimeout(() => {
						state.limit = 0;
						if (state.active) void finish();
					}, limitSeconds * 1000);

					startMeter(capture);

					const starting = capture.start();
					state.starting = starting;
					try {
						await starting;
					} catch (error) {
						if (run !== state.run) return;
						stopMeter(false);
						capture.dispose();
						state.capture = null;
						state.starting = null;
						state.active = false;
						state.busy = false;
						show({ phase: 'notice', notice: failure(error), tone: 'error' });
					}
				}

				async function finish() {
					const capture = state.capture;
					const abort = state.abort;
					const span = state.span;
					const starting = state.starting;
					const run = state.run;
					state.active = false;
					state.capture = null;
					state.starting = null;
					state.span = null;
					clearTimer();
					clearLimit();
					detach();
					// The trace drains rather than stopping dead, and the red wash retracts.
					stopMeter(true);
					resetGesture();
					if (capture === null || abort === null) {
						state.busy = false;
						show({ phase: 'idle', notice: '', cancelled: false });
						return;
					}
					show({ phase: 'transcribing', notice: '', cancelled: false });
					try {
						await starting;
						if (run !== state.run) return;
						const audio = await capture.stop();
						if (run !== state.run) return;
						if (audio.seconds < MIN_SECONDS) {
							state.busy = false;
							show({ phase: 'idle', notice: '', cancelled: false });
							return;
						}
						const limitBytes = Math.min(MAX_BYTES, runtime.limits?.maxAudioBytes ?? MAX_BYTES);
						if (audio.buffer.byteLength > limitBytes) {
							state.busy = false;
							show({ phase: 'notice', notice: say('tooLarge'), tone: 'error', cancelled: false });
							return;
						}
						const transcribe = resolveTranscribe(latest.current.props);
						if (typeof transcribe !== 'function') {
							state.busy = false;
							show({ phase: 'notice', notice: say('unavailable'), tone: 'error', cancelled: false });
							return;
						}
						// No providerId/language: the Host resolves both from its own
						// configuration (this profile selects sensevoice-local, language auto),
						// so the request can never fail a provider language whitelist.
						const result = await transcribe({ audioBase64: toBase64(audio.buffer) }, abort.signal);
						if (run !== state.run) return;
						state.busy = false;
						if (result === undefined || result.ok !== true) {
							show({ phase: 'notice', notice: failureNotice(result?.error?.message ?? ''), tone: 'error' });
							return;
						}
						const transcript = result.value?.text ?? '';
						if (transcript === '') {
							show({ phase: 'notice', notice: say('empty'), tone: 'info' });
							return;
						}
						const actions = latest.current.props.inputActions;
						if (actions === undefined || actions.insertText(transcript, span) !== true) {
							// Keep the text: the draft moved on, so the user decides when to insert it.
							show({ phase: 'idle', notice: '', pending: transcript });
							return;
						}
						show({ phase: 'idle', notice: '', cancelled: false });
					} catch (error) {
						// A stale run's failure must stay invisible: the current run owns `busy`,
						// and clearing it here would break Esc for that run.
						if (run !== state.run) return;
						state.busy = false;
						show({ phase: 'notice', notice: failure(error), tone: 'error', cancelled: false });
					} finally {
						capture.dispose();
					}
				}

				/**
				 * Insert a transcript that was retained after a draft conflict.
				 *
				 * The `pendingLeaving` guard is not redundant with the empty check: the chip is
				 * still mounted, and `pending` is only cleared once its exit finishes, so a
				 * second click inside that window would insert the same text twice.
				 */
				const insertPending = () => {
					const actions = latest.current.props.inputActions;
					const pending = latest.current.view.pending;
					if (actions === undefined || pending === '' || latest.current.view.pendingLeaving) return;
					if (actions.insertText(pending, actions.captureInsertion()) === true) {
						// The text just landed, so the chip folds away instead of blinking out.
						show({ phase: 'idle', notice: '' });
						dropPending();
						return;
					}
					show({ phase: 'notice', notice: say('conflict'), tone: 'info' });
				};

				function onPointerDown(event) {
					if (event.button !== 0) return;
					if (state.active || state.timer !== 0) return;
					// The retained-transcript chip is a real control; it must not arm the gesture.
					if (event.target instanceof Element && event.target.closest('.dsh-htt-pending') !== null) return;
					if (latest.current.props.inputActions === undefined) return;
					state.x = event.clientX;
					state.y = event.clientY;
					state.cancelled = false;
					state.level = 0;
					state.samples = [{ t: event.timeStamp, y: event.clientY }];
					/*
					 * Acknowledge the press on the frame it happens. The ring starts drawing at
					 * the point of contact over HOLD_MS, so those 300 ms stop being a dead zone
					 * — but it is deliberately faint, because the same gesture also begins a
					 * caret move or a text selection and must not disturb either.
					 */
					const rect = card.getBoundingClientRect();
					clearTimeoutOf('ringExit');
					patch({
						arm: { x: event.clientX - rect.left, y: event.clientY - rect.top },
						armLeaving: false,
						cancelled: false,
					});
					state.timer = window.setTimeout(() => {
						state.timer = 0;
						void begin();
					}, HOLD_MS);
					window.addEventListener('pointermove', onMove, true);
					window.addEventListener('pointerup', onUp, true);
					window.addEventListener('pointercancel', onCancel, true);
				}

				function onMove(event) {
					if (state.active) {
						// Drag-to-discard tracks the pointer 1:1 and stays reversible: the
						// level it writes is what the bubble actually renders.
						track(event);
						updateCancel(event);
						return;
					}
					if (state.timer === 0) return;
					const travelled = Math.hypot(event.clientX - state.x, event.clientY - state.y);
					if (travelled > ARM_TOLERANCE_PX) {
						clearTimer();
						detach();
						// A click, a caret move or a selection: the arc drains from wherever
						// it had reached instead of restarting or snapping away.
						dropRing();
					}
				}

				function onUp(event) {
					if (state.timer !== 0) {
						clearTimer();
						detach();
						dropRing();
						return;
					}
					if (!state.active) return;
					track(event);
					/*
					 * Velocity decides reverse-versus-commit before position does. A pointer that
					 * swung past the line and is already travelling back down means "keep it";
					 * one that is still climbing means "discard", even if it never quite reached
					 * the threshold.
					 */
					const speed = velocity();
					const discard = state.cancelled
						? speed < CANCEL_FLICK_PX_PER_S
						: speed <= -CANCEL_FLICK_PX_PER_S && state.level > 0.75;
					if (discard) cancel(false);
					else void finish();
				}

				function onCancel() {
					if (state.active) cancel(false);
					else {
						clearTimer();
						detach();
						dropRing();
					}
				}

				const onEnter = () => {
					latest.current.setHovered(true);
					// Coming back onto the card forgives a discard that was only armed.
					if (state.active) {
						setCancelArmed(false);
						applyCancel(0);
					}
				};
				const onLeave = () => {
					latest.current.setHovered(false);
					// Arm rather than cancel: the user sees the red bubble and can still come
					// back. A recording that is merely transcribing must also be allowed to
					// land, which is why this only fires while a capture runs.
					if (state.active) {
						setCancelArmed(true);
						applyCancel(1);
					}
				};

				const onKeyDown = (event) => {
					if (event.key !== 'Escape') return;
					if (!state.busy && state.timer === 0) return;
					event.preventDefault();
					event.stopPropagation();
					cancel(false);
				};

				const onVisibility = () => {
					if (document.hidden && (state.active || state.timer !== 0)) cancel(true);
				};

				/** Losing the window mid-capture abandons the recording, as the shipped plugin does. */
				const onBlur = () => {
					if (state.active) cancel(true);
				};

				card.addEventListener('pointerdown', onPointerDown, true);
				card.addEventListener('pointerenter', onEnter);
				card.addEventListener('pointerleave', onLeave);
				document.addEventListener('keydown', onKeyDown, true);
				document.addEventListener('visibilitychange', onVisibility);
				window.addEventListener('blur', onBlur);

				return () => {
					card.removeEventListener('pointerdown', onPointerDown, true);
					card.removeEventListener('pointerenter', onEnter);
					card.removeEventListener('pointerleave', onLeave);
					document.removeEventListener('keydown', onKeyDown, true);
					document.removeEventListener('visibilitychange', onVisibility);
					window.removeEventListener('blur', onBlur);
					window.removeEventListener('resize', measure);
					if (observer !== null) observer.disconnect();
					clearTimer();
					clearLimit();
					clearNotice();
					clearBubbleExit();
					clearPendingExit();
					clearTimeoutOf('ringExit');
					clearTimeoutOf('meterStop');
					stopMeter(false);
					if (state.raf !== 0) {
						window.cancelAnimationFrame(state.raf);
						state.raf = 0;
					}
					detach();
					state.run += 1;
					if (state.abort !== null) state.abort.abort();
					if (state.capture !== null) state.capture.dispose();
				};
			}, []);

			// Derived render state. `pending` survives notices so a rejected transcript is
			// never lost; the chip is the only affordance that can still insert it.
			const pending = view.pending;
			const recording = view.phase === 'recording';
			const busy = recording || view.phase === 'transcribing';
			const cancelled = recording && view.cancelled;
			// The hint is shown only when the tool row genuinely has room for it.
			const showHint = hovered && view.phase === 'idle' && pending === '' && box.hintMax >= HINT_MIN_PX;
			const showPending = !busy && (pending !== '' || view.pendingLeaving);
			const showBubble = busy || view.bubbleLeaving;

			/**
			 * Every variant of the label lives in the same grid cell, so the pill is always as
			 * wide as the widest one and swapping copy never reflows it. Visibility is a
			 * transition on `data-on`, so a quick back-and-forth over the discard threshold
			 * retargets instead of replaying.
			 */
			const labelRow = (variants) =>
				h(
					'span',
					{ className: 'dsh-htt-row' },
					variants.map((variant) =>
						h(
							'span',
							{
								key: variant.key,
								'data-on': variant.on ? '' : undefined,
								'data-tone': variant.tone,
							},
							variant.text,
						),
					),
				);

			return h(
				'div',
				{ ref: root, className: 'dsh-htt-layer', style: layerStyle(box.height) },
				h('style', null, STYLES),
				view.arm !== null &&
					h(
						'span',
						{
							className: 'dsh-htt-ring',
							'data-leaving': view.armLeaving ? '' : undefined,
							style: { left: `${view.arm.x}px`, top: `${view.arm.y}px` },
							'aria-hidden': true,
						},
						h(
							'svg',
							{ width: 36, height: 36, viewBox: '0 0 36 36' },
							h('circle', {
								className: 'dsh-htt-ring-track',
								cx: 18, cy: 18, r: RING_RADIUS,
								fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
							}),
							h('circle', {
								className: 'dsh-htt-ring-arc',
								cx: 18, cy: 18, r: RING_RADIUS,
								fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
							}),
						),
					),
				h(
					'div',
					{
						className: 'dsh-htt-hint',
						'data-on': showHint ? '' : undefined,
						style: hintStyle(box),
						'aria-hidden': true,
					},
					h(MicGlyph, { size: 14 }),
					h('span', null, translate(props, 'hint')),
				),
				showPending &&
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-htt-pending',
							'data-leaving': view.pendingLeaving ? '' : undefined,
							style: pendingStyle(box),
							title: translate(props, 'pendingHint'),
							'aria-label': translate(props, 'pendingHint'),
							onPointerDown: (event) => event.stopPropagation(),
							// Keep the caret where it was: the insert reads the editor's own selection.
							onMouseDown: (event) => event.preventDefault(),
							onClick: () => insertPending(),
						},
						h(MicGlyph, { size: 13 }),
						h('span', null, translate(props, 'pending')),
					),
				// The card's own outline, so a pending discard is visible where you are looking.
				h('span', { className: 'dsh-htt-edge', 'aria-hidden': true }),
				showBubble &&
					h(
						'div',
						{ className: 'dsh-htt-bubble', 'data-leaving': view.bubbleLeaving ? '' : undefined },
						h(
							'div',
							{
								className: 'dsh-htt-pill',
								role: 'status',
								'aria-live': 'polite',
								'aria-label': recording
									? cancelled
										? `${translate(props, 'cancelReady')} · ${translate(props, 'cancelReadyHint')}`
										: `${translate(props, 'release')} · ${translate(props, 'cancelHint')}`
									: translate(props, 'transcribing'),
							},
							h('span', { className: 'dsh-htt-material', 'aria-hidden': true }),
							h('span', { className: 'dsh-htt-alarm', 'aria-hidden': true }),
							h(
								'div',
								{ className: 'dsh-htt-body' },
								h(
									'span',
									{
										className: 'dsh-htt-mark',
										'data-state': recording ? 'recording' : 'transcribing',
										'aria-hidden': true,
									},
									h('span', { className: 'dsh-htt-dot' }, h('span', { className: 'dsh-htt-dot-core' })),
									h('span', { className: 'dsh-htt-cross' }, h(DiscardGlyph, { size: 10 })),
								),
								h(
									'span',
									{ className: 'dsh-htt-slot', 'aria-hidden': true },
									h(
										'svg',
										{
											ref: wave,
											className: 'dsh-htt-wave',
											viewBox: `0 0 ${WAVE_BARS * 8} 40`,
											preserveAspectRatio: 'none',
										},
										Array.from({ length: WAVE_BARS }, (_, index) =>
											h('line', {
												key: index,
												x1: index * 8 + 4,
												x2: index * 8 + 4,
												y1: 19,
												y2: 21,
												stroke: 'currentColor',
												strokeWidth: 3,
												strokeLinecap: 'round',
												opacity: 0.25 + index / (WAVE_BARS * 1.5),
											}),
										),
									),
								),
								labelRow([
									{ key: 'transcribe', on: !recording, text: translate(props, 'transcribing') },
									{ key: 'release', on: recording && !cancelled, text: translate(props, 'release') },
									{
										key: 'cancel',
										on: cancelled,
										text: translate(props, 'cancelReady'),
										tone: 'error',
									},
								]),
							),
						),
					),
				view.phase === 'notice' &&
					h(
						'div',
						{
							className: 'dsh-htt-notice',
							'data-tone': view.tone,
							'data-leaving': view.leaving ? '' : undefined,
							style: noticeStyle(box),
							role: 'status',
						},
						h(NoticeGlyph, { tone: view.tone }),
						h('span', null, view.notice),
					),
			);
		}

		//#endregion

		const inject = ['slots', 'locale', 'remote'];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }));
			// `remote.speech` is mounted by the experimental voice-input plugin; if that
			// bundle is off the namespace is absent and this callback never runs, so the
			// composer simply keeps its normal behaviour.
			ctx.inject(['remote.speech', 'slots'], (scope) => {
				runtime.speech = scope.remote.speech;
				// Pick up the Host's real recording limits once. A failure or an unexpected
				// envelope only leaves the conservative local defaults in place.
				void (async () => {
					try {
						const catalog = await scope.remote.speech.catalog();
						if (catalog !== undefined && catalog.ok === true) runtime.limits = catalog.value ?? null;
					} catch (error) {
						/* keep the defaults */
					}
				})();
				scope.effect(() =>
					scope.slots.inject(SLOT, () =>
						scope.slots.register(
							{
								name: SLOT,
								id: ENTRY,
								order: 50,
								locale: NS,
								inject: () => ({
									transcribe: (request, signal) => scope.remote.speech.transcribe(request, signal),
								}),
							},
							HoldToTalk,
						),
					),
				);
			});
		}

		return { inject, apply };
	},
});
