/**
 * Hold-to-talk — long-press anywhere on the composer card to dictate.
 *
 * Client half of @local/dsh-hold-to-talk. It mounts one entry into
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
	id: '@local/dsh-hold-to-talk',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'dsh-hold-to-talk';
		const SLOT = 'conversation.input.overlay';
		const ENTRY = 'hold-to-talk';

		/** How long the pointer must stay still before the composer becomes a microphone. */
		const HOLD_MS = 350;
		/** Movement beyond this disarms the gesture: it was a click, a caret move or a selection. */
		const ARM_TOLERANCE_PX = 10;
		/** Upward travel that arms the "release to cancel" state. */
		const CANCEL_DISTANCE_PX = 72;
		/** Recordings shorter than this are dropped instead of transcribed. */
		const MIN_SECONDS = 0.35;
		/** Kept below the Host default (120 s) so the Host never rejects on duration. */
		const MAX_SECONDS = 110;
		/** Kept below the Host default (4 MiB) so the Host never rejects on size. */
		const MAX_BYTES = 4 * 1024 * 1024 - 4096;
		/** How long a one-line notice stays on screen. */
		const NOTICE_MS = 2800;

		/** Handles captured in `apply`, so a slot entry that receives no injected props still works. */
		const runtime = { speech: null, limits: null };

		const zh = {
			hint: '按住鼠标 语音输入文字',
			listening: '正在聆听',
			release: '松开完成',
			cancelHint: 'Esc 取消 · 上滑取消',
			cancelReady: '松开取消',
			cancelReadyHint: '已上滑，松手即取消',
			transcribing: '识别中…',
			cancelled: '已取消',
			empty: '没有识别到内容',
			conflict: '草稿已改动，转写结果保留在右下角',
			pending: '插入转写',
			pendingHint: '点击插入到当前光标',
			notReady: '语音模型还没准备好：请到「设置 → 插件 → 语音输入」点一次「下载并准备」',
			failed: '语音识别失败：{message}',
			unavailable: '当前环境无法录音',
			permission: '麦克风不可用，请在系统设置中允许后重试',
			tooLarge: '录音超出服务上限，请说短一点',
		};
		const en = {
			hint: 'Hold the mouse to dictate',
			listening: 'Listening',
			release: 'release to finish',
			cancelHint: 'Esc or swipe up to cancel',
			cancelReady: 'Release to discard',
			cancelReadyHint: 'swiped up — releasing now discards the recording',
			transcribing: 'Transcribing…',
			cancelled: 'Cancelled',
			empty: 'No speech recognized',
			conflict: 'Draft changed; the transcript is kept at the lower right',
			pending: 'Insert transcript',
			pendingHint: 'Click to insert at the current caret',
			notReady: 'The speech models are not prepared yet: open Settings → Plugins → Voice input and run "Download and prepare" once',
			failed: 'Speech recognition failed: {message}',
			unavailable: 'This environment cannot record audio',
			permission: 'Microphone unavailable; allow access in system settings and retry',
			tooLarge: 'The recording exceeds the service limit',
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
					analyser.fftSize = 512;
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
				/** Rough 0..1 loudness for the meter. */
				level() {
					if (analyser === null || released) return 0;
					const frame = new Uint8Array(analyser.fftSize);
					analyser.getByteTimeDomainData(frame);
					let sum = 0;
					for (let index = 0; index < frame.length; index += 1) {
						const value = (frame[index] - 128) / 128;
						sum += value * value;
					}
					return Math.min(1, Math.sqrt(sum / frame.length) * 4);
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

		const EASE = 'cubic-bezier(.22,.61,.36,1)';

		const KEYFRAMES = [
			'@keyframes dsh-htt-panel-in{from{opacity:0;transform:scale(.99)}to{opacity:1;transform:none}}',
			'@media (prefers-reduced-motion:reduce){.dsh-htt-hint,.dsh-htt-bar,.dsh-htt-pending{transition:none!important}.dsh-htt-panel{animation:none!important}}',
		].join('');

		const layerStyle = (height) => ({
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			height,
			pointerEvents: 'none',
		});

		/** The hint and the pending chip share one seat: the lower-right of the editor area. */
		const cornerStyle = (rowHeight) => ({
			position: 'absolute',
			right: '14px',
			bottom: `${rowHeight + 6}px`,
			display: 'flex',
			alignItems: 'center',
			gap: '6px',
			maxWidth: '76%',
			fontSize: '13px',
			lineHeight: '18px',
			letterSpacing: '0.01em',
			whiteSpace: 'nowrap',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			userSelect: 'none',
		});

		const hintStyle = (visible, rowHeight) => ({
			...cornerStyle(rowHeight),
			color: 'var(--dsw-alias-label-secondary)',
			opacity: visible ? 0.72 : 0,
			filter: visible ? 'blur(0px)' : 'blur(3px)',
			transform: visible ? 'translateY(0)' : 'translateY(3px)',
			transition: `opacity 620ms ${EASE}, filter 620ms ${EASE}, transform 620ms ${EASE}`,
		});

		const pendingStyle = (rowHeight) => ({
			...cornerStyle(rowHeight),
			padding: '2px 9px',
			border: '1px solid var(--dsw-alias-border-l2)',
			borderRadius: '7px',
			background: 'var(--dsw-alias-bg-layer-2)',
			color: 'var(--dsw-alias-label-primary)',
			cursor: 'pointer',
			pointerEvents: 'auto',
			animation: 'dsh-htt-panel-in 160ms ease-out',
		});

		const panelStyle = (cancelled) => ({
			position: 'absolute',
			inset: 0,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: '12px',
			boxSizing: 'border-box',
			padding: '0 16px',
			border: `1px solid ${cancelled ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-border-l1)'}`,
			borderRadius: '10px',
			background: 'var(--dsw-alias-bg-layer-2)',
			color: cancelled ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
			pointerEvents: 'auto',
			animation: 'dsh-htt-panel-in 160ms ease-out',
		});

		const barsStyle = {
			display: 'flex',
			alignItems: 'center',
			gap: '3px',
			height: '26px',
			flex: '0 0 auto',
		};

		const barStyle = (cancelled) => ({
			display: 'block',
			width: '3px',
			minHeight: '3px',
			borderRadius: '2px',
			background: cancelled ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-brand-primary)',
			transition: 'height 90ms linear',
		});

		const labelStyle = {
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'flex-start',
			gap: '1px',
			minWidth: 0,
		};

		const noticeStyle = (rowHeight) => ({
			...cornerStyle(rowHeight),
			padding: '2px 9px',
			borderRadius: '7px',
			background: 'var(--dsw-alias-bg-layer-2)',
			color: 'var(--dsw-alias-label-secondary)',
		});

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

		//#endregion

		//#region component

		/** Prefer the entry's injected `transcribe`; fall back to the Remote captured at activation. */
		function resolveTranscribe(props) {
			if (typeof props.transcribe === 'function') return props.transcribe;
			if (runtime.speech === null) return undefined;
			return (request, signal) => runtime.speech.transcribe(request, signal);
		}

		const IDLE = { phase: 'idle', notice: '', cancelled: false, pending: '' };
		const BAR_WEIGHTS = [0.45, 0.8, 1, 0.68, 0.5];

		function HoldToTalk(props) {
			const root = React.useRef(null);
			const bars = React.useRef(null);
			const [hovered, setHovered] = React.useState(false);
			const [view, setView] = React.useState(IDLE);
			const [box, setBox] = React.useState({ height: 0, rowHeight: 0 });
			const latest = React.useRef(null);
			latest.current = { props, view, setHovered, setView };

			/** One-line notices clear themselves, without dropping a retained transcript. */
			React.useEffect(() => {
				if (view.phase !== 'notice') return undefined;
				const timer = window.setTimeout(
					() => setView((current) => ({ ...current, phase: 'idle', notice: '' })),
					NOTICE_MS,
				);
				return () => window.clearTimeout(timer);
			}, [view]);

			React.useEffect(() => {
				const node = root.current;
				if (node === null) return undefined;
				const card = node.closest('[data-composer-card]');
				if (card === null) {
					console.warn('dsh-hold-to-talk: [data-composer-card] not found; the composer layout changed');
					return undefined;
				}

				/**
				 * The card is `[overlayAnchor, (accessory), (attachments), DraftEditor, row]`,
				 * so its last element child is the tool row; the hint sits just above it.
				 */
				const measure = () => {
					const rect = card.getBoundingClientRect();
					const tail = card.lastElementChild;
					setBox({
						height: rect.height,
						rowHeight: tail === null ? 0 : tail.getBoundingClientRect().height,
					});
				};
				measure();
				const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
				if (observer !== null) observer.observe(card);
				window.addEventListener('resize', measure);

				const state = {
					timer: 0,
					limit: 0,
					run: 0,
					active: false,
					busy: false,
					cancelled: false,
					capture: null,
					starting: null,
					span: null,
					abort: null,
					x: 0,
					y: 0,
				};

				const say = (key, params) => translate(latest.current.props, key, params);
				const show = (patch) => latest.current.setView((current) => ({ ...current, ...patch }));

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

				const cancel = (silent) => {
					clearTimer();
					clearLimit();
					detach();
					const capture = state.capture;
					state.capture = null;
					state.starting = null;
					state.active = false;
					state.busy = false;
					state.cancelled = false;
					state.span = null;
					state.run += 1;
					if (state.abort !== null) state.abort.abort();
					state.abort = null;
					if (capture !== null) capture.dispose();
					if (silent) show({ phase: 'idle', notice: '', cancelled: false });
					else show({ phase: 'notice', notice: say('cancelled'), cancelled: false });
				};

				async function begin() {
					const actions = latest.current.props.inputActions;
					if (actions === undefined || actions === null) return;
					const run = ++state.run;
					state.active = true;
					state.busy = true;
					state.cancelled = false;
					state.span = actions.captureInsertion();
					state.abort = new AbortController();
					const capture = createCapture();
					state.capture = capture;
					show({ phase: 'recording', notice: '', cancelled: false });

					// The Host caps recording length; stop on our own so a forgotten press cannot
					// grow the chunk buffer without bound and then be rejected on arrival.
					const limitSeconds = Math.min(MAX_SECONDS, runtime.limits?.maxDurationSeconds ?? MAX_SECONDS);
					state.limit = window.setTimeout(() => {
						state.limit = 0;
						if (state.active) void finish();
					}, limitSeconds * 1000);

					const pump = () => {
						if (state.capture !== capture) return;
						const meter = bars.current;
						if (meter !== null) {
							const level = state.cancelled ? 0 : capture.level();
							meter.style.setProperty('--dsh-htt-level', String(level));
						}
						window.requestAnimationFrame(pump);
					};
					window.requestAnimationFrame(pump);

					const starting = capture.start();
					state.starting = starting;
					try {
						await starting;
					} catch (error) {
						if (run !== state.run) return;
						capture.dispose();
						state.capture = null;
						state.starting = null;
						state.active = false;
						state.busy = false;
						show({ phase: 'notice', notice: failure(error) });
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
							show({ phase: 'notice', notice: say('tooLarge'), cancelled: false });
							return;
						}
						const transcribe = resolveTranscribe(latest.current.props);
						if (typeof transcribe !== 'function') {
							state.busy = false;
							show({ phase: 'notice', notice: say('unavailable'), cancelled: false });
							return;
						}
						// No providerId/language: the Host resolves both from its own
						// configuration (this profile selects sensevoice-local, language auto),
						// so the request can never fail a provider language whitelist.
						const result = await transcribe({ audioBase64: toBase64(audio.buffer) }, abort.signal);
						if (run !== state.run) return;
						state.busy = false;
						if (result === undefined || result.ok !== true) {
							show({ phase: 'notice', notice: failureNotice(result?.error?.message ?? '') });
							return;
						}
						const transcript = result.value?.text ?? '';
						if (transcript === '') {
							show({ phase: 'notice', notice: say('empty') });
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
						state.busy = false;
						if (run === state.run) show({ phase: 'notice', notice: failure(error), cancelled: false });
					} finally {
						capture.dispose();
					}
				}

				/** Insert a transcript that was retained after a draft conflict. */
				const insertPending = () => {
					const actions = latest.current.props.inputActions;
					const pending = latest.current.view.pending;
					if (actions === undefined || pending === '') return;
					if (actions.insertText(pending, actions.captureInsertion()) === true) {
						show({ phase: 'idle', notice: '', pending: '' });
						return;
					}
					show({ phase: 'notice', notice: say('conflict') });
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
						if (!state.cancelled && state.y - event.clientY > CANCEL_DISTANCE_PX) {
							state.cancelled = true;
							show({ cancelled: true });
						}
						return;
					}
					if (state.timer === 0) return;
					const travelled = Math.hypot(event.clientX - state.x, event.clientY - state.y);
					if (travelled > ARM_TOLERANCE_PX) {
						clearTimer();
						detach();
					}
				}

				function onUp() {
					if (state.timer !== 0) {
						clearTimer();
						detach();
						return;
					}
					if (!state.active) return;
					if (state.cancelled) {
						cancel(false);
						return;
					}
					void finish();
				}

				function onCancel() {
					if (state.active) cancel(false);
					else {
						clearTimer();
						detach();
					}
				}

				const onEnter = () => latest.current.setHovered(true);
				const onLeave = () => {
					latest.current.setHovered(false);
					// Only an armed press or a running capture is abandoned here; a finished
					// recording that is merely transcribing must be allowed to land.
					if (state.active) cancel(true);
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
			const showHint = hovered && view.phase === 'idle' && pending === '';
			const cancelled = recording && view.cancelled;

			return h(
				'div',
				{ ref: root, className: 'dsh-htt-layer', style: layerStyle(box.height) },
				h('style', null, KEYFRAMES),
				h(
					'div',
					{ className: 'dsh-htt-hint', style: hintStyle(showHint, box.rowHeight), 'aria-hidden': true },
					h(MicGlyph, { size: 14 }),
					h('span', null, translate(props, 'hint')),
				),
				pending !== '' &&
					!busy &&
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-htt-pending',
							style: pendingStyle(box.rowHeight),
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
				busy &&
					h(
						'div',
						{ className: 'dsh-htt-panel', style: panelStyle(cancelled), role: 'status', 'aria-live': 'polite' },
						recording &&
							h(
								'div',
								{ ref: bars, className: 'dsh-htt-bars', style: barsStyle, 'aria-hidden': true },
								BAR_WEIGHTS.map((weight, index) =>
									h('span', {
										key: index,
										className: 'dsh-htt-bar',
										style: {
											...barStyle(cancelled),
											height: `calc(4px + ${Math.round(weight * 22)}px * var(--dsh-htt-level, 0))`,
										},
									}),
								),
							),
						h(
							'span',
							{ style: labelStyle },
							h(
								'span',
								{ style: { fontSize: '13px', lineHeight: '19px', fontWeight: 500 } },
								recording
									? cancelled
										? translate(props, 'cancelReady')
										: `${translate(props, 'listening')} · ${translate(props, 'release')}`
									: translate(props, 'transcribing'),
							),
							recording &&
								h(
									'span',
									{ style: { fontSize: '12px', lineHeight: '17px', opacity: 0.75 } },
									cancelled ? translate(props, 'cancelReadyHint') : translate(props, 'cancelHint'),
								),
						),
					),
				view.phase === 'notice' &&
					h(
						'div',
						{ className: 'dsh-htt-notice', style: noticeStyle(box.rowHeight), role: 'status' },
						view.notice,
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
