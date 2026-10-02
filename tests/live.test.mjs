/** Exercise dictation through the registered slot, native audio boundary and Host API. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
globalThis.Element = class {};
globalThis.Node = class {};

function mount({ selected = false, live = true, location = 'host-local', workletAvailable = true, occurrences = [] } = {}) {
	let component, worklet, tree, now = 0, cursor = 0, mounted = false;
	let draft = selected ? '前旧后' : '前后', rev = 0;
	const hooks = [], effects = [], listeners = new Map(), timers = new Map(), calls = [];
	const card = {
		closest: () => card, matches: () => false, lastElementChild: null,
		getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, height: 84 }),
		style: { setProperty() {} }, addEventListener: listen, removeEventListener: unlisten,
	};
	function listen(type, fn) { listeners.set(type, [...listeners.get(type) ?? [], fn]); }
	function unlisten(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter(x => x !== fn)); }
	const fire = (type, event = {}) => { for (const fn of listeners.get(type) ?? []) fn(event); };
	const inputActions = {
		captureInsertion: () => ({ start: selected ? 1 : draft.length, end: selected ? 2 : draft.length, draftRev: rev }),
		insertText(text, span) {
			if (span.draftRev !== rev) return false;
			draft = draft.slice(0, span.start) + text + draft.slice(span.end);
			rev++; render(); return true;
		},
	};
	const React = {
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		useRef(value) { const i = cursor++; return hooks[i] ??= { current: i === 0 ? card : value }; },
		useState(value) {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = typeof value === 'function' ? value() : value;
			return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; if (mounted) render(); }];
		},
		useEffect(fn) { if (!mounted) effects.push(fn); },
	};
	class Recorder {
		state = 'inactive'; events = new Map();
		addEventListener(type, fn) { this.events.set(type, [...this.events.get(type) ?? [], fn]); }
		start() { this.state = 'recording'; }
		stop() {
			this.state = 'inactive';
			for (const fn of this.events.get('dataavailable') ?? []) fn({ data: new Blob(['audio']) });
			for (const fn of this.events.get('stop') ?? []) fn();
		}
	}
	class Audio {
		sampleRate = 16000;
		audioWorklet = workletAvailable ? { addModule: async () => {} } : null;
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
		createAnalyser() { return { fftSize: 256, getFloatTimeDomainData: a => a.fill(.1) }; }
		decodeAudioData = async () => ({ duration: 4 });
		createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
		close = async () => {};
		resume = async () => {};
	}
	class Offline {
		constructor(_channels, frames) { this.frames = frames; }
		createBufferSource() { return { connect() {}, start() {} }; }
		startRendering = async () => ({ duration: this.frames / 16000, getChannelData: () => new Float32Array(this.frames) });
	}
	class Worklet {
		port = { onmessage: null, close() {} }; constructor() { worklet = this; }
		connect() {} disconnect() {}
	}
	const window = {
		__ModuleLoader__: { load(module) { module.factory(() => React).apply({
			locale: { register() {} }, effect: fn => fn(), inject: (_deps, fn) => fn({
				effect: fn => fn(), remote: { speech: { catalog: async () => ({ ok: true, value: {
					selection: { providerId: 'local' }, providers: [{ id: 'local', location }],
				} }) } },
				slots: { inject: (_slot, fn) => fn(), register(meta, fn) { if (meta.name === 'conversation.input.overlay') component = fn; } },
			}),
		}); } },
		localStorage: { getItem: () => JSON.stringify({ live }), setItem() {}, removeItem() {} },
		btoa: value => Buffer.from(value, 'binary').toString('base64'),
		setTimeout(fn, ms) { const id = Symbol(); timers.set(id, { fn, at: now + ms }); return id; },
		clearTimeout: id => timers.delete(id), requestAnimationFrame: () => 0, cancelAnimationFrame() {},
		addEventListener: listen, removeEventListener: unlisten,
	};
	new Function('window', 'document', 'navigator', 'AudioContext', 'OfflineAudioContext', 'MediaRecorder', 'AudioWorkletNode', source)(
		window, { hidden: false, addEventListener: listen, removeEventListener: unlisten },
		{ language: 'zh-CN', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
		Audio, Offline, Recorder, Worklet,
	);
	function render() {
		cursor = 0;
		tree = component({ inputActions, useInput: select => select({ draft, draftRev: rev, occurrences }),
			transcribe(request, signal) { return new Promise((resolve, reject) => calls.push({ request, signal, resolve, reject })); },
		});
	}
	render(); mounted = true;
	const cleanups = effects.map(fn => fn()).filter(fn => typeof fn === 'function');
	const key = { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} };
	return {
		calls, get draft() { return draft; },
		async start() { await flush(); fire('keydown', key); await flush(); },
		async samples(seconds = 2) { worklet?.port.onmessage?.({ data: new Float32Array(16000 * seconds).fill(.1) }); await flush(); },
		async advance(ms = 1500) {
			now += ms;
			const due = [...timers].filter(([, t]) => t.at <= now);
			for (const [id, t] of due) { if (timers.delete(id)) t.fn(); }
			await flush();
		},
		async result(index, text) { calls[index].resolve({ ok: true, value: { text } }); await flush(); },
		async failure(index) { calls[index].resolve({ ok: false, error: { message: 'temporary failure' } }); await flush(); },
		async retry() {
			function find(node) {
				if (!node || typeof node !== 'object') return null;
				if (node.props?.className === 'dsh-htt-action') return node;
				for (const child of (Array.isArray(node) ? node : node.children ?? [])) { const hit = find(child); if (hit) return hit; }
				return null;
			}
			find(tree).props.onClick(); await flush();
		},
		async finish() { fire('keyup', key); await flush(); },
		async cancel() { fire('keydown', { ...key, key: 'Escape' }); await flush(); },
		edit(text) { draft = text; rev++; render(); },
		dispose() { for (const fn of cleanups) fn(); },
	};
}

// The first slice: real Host recognition appears while the key is still held.
const live = mount();
await live.start(); await live.samples(); await live.advance();
assert.equal(live.calls.length, 1, 'holding sends a valid audio snapshot before release');
const wav = Buffer.from(live.calls[0].request.audioBase64, 'base64');
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.readUInt32LE(24), 16000);
await live.result(0, '你好');
assert.equal(live.draft, '前后你好', 'the recognized words appear in the draft during recording');
await live.samples(); await live.advance();
await live.result(1, '你好世界');
assert.equal(live.draft, '前后你好世界', 'later words revise the owned range instead of duplicating it');
await live.finish();
await live.result(2, '你好，世界。');
assert.equal(live.draft, '前后你好，世界。', 'release finalizes punctuation without adding a duplicate transcript');
live.dispose();

const cancel = mount({ selected: true });
await cancel.start(); await cancel.samples(); await cancel.advance();
await cancel.result(0, '临时识别');
assert.equal(cancel.draft, '前临时识别后');
await cancel.samples(); await cancel.advance();
await cancel.cancel();
assert.equal(cancel.draft, '前旧后', 'cancelling restores the original selection and surrounding draft');
await cancel.result(1, '迟到结果');
assert.equal(cancel.draft, '前旧后', 'a cancelled request cannot reinsert text');
cancel.dispose();

const conflict = mount();
await conflict.start(); await conflict.samples(); await conflict.advance();
await conflict.result(0, '语音');
conflict.edit('我手工编辑了语音');
await conflict.samples(); await conflict.advance();
await conflict.result(1, '语音修订');
await conflict.finish(); await conflict.result(2, '最终语音');
assert.equal(conflict.draft, '我手工编辑了语音', 'manual editing is never overwritten by live or final recognition');
conflict.dispose();

const serial = mount();
await serial.start(); await serial.samples(); await serial.advance();
await serial.samples(); await serial.advance(3000);
assert.equal(serial.calls.length, 1, 'slow inference cannot build a queue of obsolete snapshots');
await serial.finish();
assert.equal(serial.calls.length, 1, 'final recognition waits for the active Host request');
await serial.result(0, '旧预览');
assert.equal(serial.calls.length, 2);
await serial.result(1, '最终内容');
assert.equal(serial.draft, '前后最终内容');
serial.dispose();

// Cancelling and immediately starting another recording must not await the old request.
const restart = mount();
await restart.start(); await restart.samples(); await restart.advance();
await restart.cancel();
await restart.start(); await restart.finish();
assert.equal(restart.calls.length, 2, 'a new recording finalizes independently of a cancelled preview');
await restart.result(1, '新录音'); await restart.result(0, '旧录音');
assert.equal(restart.draft, '前后新录音');
restart.dispose();

const retry = mount();
await retry.start(); await retry.samples(); await retry.advance(); await retry.result(0, '预览');
await retry.finish(); await retry.failure(1); await retry.retry(); await retry.result(2, '完整识别');
assert.equal(retry.draft, '前后完整识别', 'retry replaces provisional words rather than duplicating them');
retry.dispose();

const previewFailure = mount();
await previewFailure.start(); await previewFailure.samples(); await previewFailure.advance(); await previewFailure.failure(0);
await previewFailure.finish(); await previewFailure.result(1, '完整识别');
assert.equal(previewFailure.draft, '前后完整识别', 'preview errors still allow whole-recording recognition');
previewFailure.dispose();

for (const options of [{ live: false }, { location: 'cloud' }, { workletAvailable: false }, { occurrences: [{}] }]) {
	const fallback = mount(options);
	await fallback.start(); await fallback.samples(); await fallback.advance();
	assert.equal(fallback.calls.length, 0, 'unsupported or disabled live mode retains release-to-transcribe behavior');
	await fallback.finish(); await fallback.result(0, '松开识别');
	assert.equal(fallback.draft, '前后松开识别'); fallback.dispose();
}
console.log('live: ok');
