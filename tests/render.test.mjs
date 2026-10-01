/**
 * Render smoke test.
 *
 * `node --check` proves client.js parses; it cannot prove the component mounts. This
 * loads the bundle exactly the way the DSH module loader does, captures the slot
 * component through a stubbed `apply`, and renders it across every state the gesture
 * can be in — so a renamed helper, a dropped import or a malformed style object fails
 * here instead of in the composer.
 *
 * It also enforces the three motion rules the stylesheet is built on, because they are
 * the kind of thing that quietly regresses: entry and exit are transitions (never
 * keyframes), no transition animates a layout property or uses `ease-in`, and exactly
 * one looping animation exists.
 *
 * No dependencies, no build step — the same constraints as the plugin itself.
 *
 * Run with: node tests/render.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

const failures = [];
const check = (condition, label) => {
	if (!condition) failures.push(label);
};

//#region the module loader handshake

let loaded = null;
const fakeWindow = {
	__ModuleLoader__: { load: (module) => { loaded = module; } },
	btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
	setTimeout: () => 0,
	clearTimeout: () => undefined,
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => undefined,
	addEventListener: () => undefined,
	removeEventListener: () => undefined,
};
new Function('window', 'navigator', 'AudioContext', 'OfflineAudioContext', source)(
	fakeWindow,
	{ language: 'zh-CN' },
	function AudioContext() {},
	function OfflineAudioContext() {},
);

check(loaded !== null, 'client.js registers itself with the module loader');
check(loaded?.id === '@jryang1997/dsh-composer-dictation', 'bundle id still matches package.json');

//#endregion

//#region a React just real enough to render once

const flatten = (nodes) => nodes.flatMap((node) => (Array.isArray(node) ? flatten(node) : [node]));
let preset = [];
let hookIndex = 0;
const React = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useRef: (value) => ({ current: value }),
	useState: (value) => {
		const given = preset[hookIndex];
		hookIndex += 1;
		return [given === undefined ? value : given, () => undefined];
	},
	// Effects need a real DOM; the render path is what this test covers.
	useEffect: () => undefined,
};

//#endregion

//#region capture the component through a stubbed apply

let component = null;
const scope = {
	effect: (fn) => { fn(); },
	remote: { speech: { catalog: async () => ({ ok: false }), transcribe: async () => ({ ok: false }) } },
	slots: {
		inject: (_name, fn) => fn(),
		register: (_meta, registered) => { component = registered; },
	},
};
const ctx = {
	effect: (fn) => { fn(); },
	locale: { register: () => undefined },
	inject: (_deps, fn) => fn(scope),
};

const bundle = loaded.factory((name) => {
	if (name === 'react') return React;
	throw new Error(`unexpected require(${JSON.stringify(name)})`);
});
check(typeof bundle.apply === 'function', 'the factory returns an apply function');
check(JSON.stringify(bundle.inject) === '["slots","locale","remote"]', 'the inject list is unchanged');
bundle.apply(ctx);
check(typeof component === 'function', 'the slot component registers');

//#endregion

//#region tree helpers

const classes = (node, found = []) => {
	if (node === null || node === undefined || typeof node !== 'object') return found;
	if (Array.isArray(node)) {
		for (const child of node) classes(child, found);
		return found;
	}
	if (typeof node.props.className === 'string') found.push(node.props.className);
	for (const child of node.children ?? []) classes(child, found);
	return found;
};
const attrs = (node, key, found = []) => {
	if (node === null || node === undefined || typeof node !== 'object') return found;
	if (Array.isArray(node)) {
		for (const child of node) attrs(child, key, found);
		return found;
	}
	if (node.props[key] !== undefined) found.push(node.props[key]);
	for (const child of node.children ?? []) attrs(child, key, found);
	return found;
};
/** The copy currently showing: every string inside a `data-on` label variant. */
const litText = (node, found = []) => {
	if (node === null || node === undefined || typeof node !== 'object') return found;
	if (Array.isArray(node)) {
		for (const child of node) litText(child, found);
		return found;
	}
	if (typeof node.props.className === 'string' && node.props.className.startsWith('dsh-htt-row')) {
		for (const variant of flatten(node.children ?? [])) {
			if (variant?.props?.['data-on'] === undefined) continue;
			for (const text of flatten(variant.children ?? [])) {
				if (typeof text === 'string') found.push(text);
			}
		}
		return found;
	}
	for (const child of node.children ?? []) litText(child, found);
	return found;
};
const styleText = (node) => {
	if (node === null || node === undefined || typeof node !== 'object') return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = styleText(child);
			if (found !== null) return found;
		}
		return null;
	}
	if (node.type === 'style') return flatten(node.children ?? []).join('');
	for (const child of node.children ?? []) {
		const found = styleText(child);
		if (found !== null) return found;
	}
	return null;
};
/** The declarations of one rule in the injected stylesheet. */
const rule = (css, selector) => {
	const at = css.indexOf(selector);
	if (at === -1) return '';
	const open = css.indexOf('{', at);
	return css.slice(open + 1, css.indexOf('}', open));
};

//#endregion

//#region render every state

const IDLE = {
	phase: 'idle', notice: '', tone: 'info', leaving: false, cancelled: false, pending: '',
	pendingLeaving: false, bubbleLeaving: false, arm: null, armLeaving: false,
};
const BOX = { height: 84, rowHeight: 42, hintRight: 220, hintMax: 180 };

const render = (hovered, view, box = BOX) => {
	preset = [hovered, view, box];
	hookIndex = 0;
	return component({ t: undefined });
};

// Idle, hovered: the hint exists and is parked in the tool row.
let tree = render(true, IDLE);
let names = classes(tree);
check(names.includes('dsh-htt-layer'), 'the layer renders');
check(names.includes('dsh-htt-hint'), 'the hint renders');
check(attrs(tree, 'data-on').length === 1, 'the hint is the only lit element while idle');
check(!names.includes('dsh-htt-bubble'), 'no recording bubble while idle');
check(!names.includes('dsh-htt-ring'), 'no press ring without a press');

// Idle with a narrow tool row: the hint must not switch on over the controls.
tree = render(true, IDLE, { ...BOX, hintMax: 20 });
check(attrs(tree, 'data-on').length === 0, 'the hint stays off when the tool row has no room');

// Recording: a floating capsule, and the composer itself is left alone.
tree = render(true, { ...IDLE, phase: 'recording' });
names = classes(tree);
check(names.includes('dsh-htt-bubble'), 'the bubble renders while recording');
check(names.includes('dsh-htt-pill'), 'the bubble is one capsule');
check(names.includes('dsh-htt-material'), 'the capsule carries the host material layer');
check(names.includes('dsh-htt-alarm'), 'the capsule carries the discard wash');
check(names.includes('dsh-htt-edge'), "the card's own hairline is drawn for the discard state");
check(names.includes('dsh-htt-wave'), 'the meter renders');
check(names.includes('dsh-htt-slot'), 'the meter sits in a fixed-width slot');
check(names.includes('dsh-htt-cross'), 'the discard cross is present, cross-faded not swapped');
check(names.includes('dsh-htt-dot-core'), 'the mic-is-live dot is present');
check(names.includes('dsh-htt-row'), 'the label row renders');
check(attrs(tree, 'data-on').length === 1, 'exactly one label variant is lit');
check(
	litText(tree).join('|') === '松开完成',
	`recording shows one short word (got ${JSON.stringify(litText(tree))})`,
);
// The whole point of the redesign: nothing here can intercept a click, because the
// bubble floats over the transcript and the old full-bleed panel used to shield the card.
check(!names.includes('dsh-htt-panel'), 'the old full-card panel is gone');
check(attrs(tree, 'strokeWidth').length === 28, `the waveform is 28 bars (got ${attrs(tree, 'strokeWidth').length})`);
check(attrs(tree, 'aria-live').length === 1, 'the capsule is the single live region');

// Recording, discard armed: the copy is the only place text is allowed to appear.
tree = render(true, { ...IDLE, phase: 'recording', cancelled: true });
check(
	litText(tree).join('|') === '松开丢弃',
	`discard shows the discard copy (got ${JSON.stringify(litText(tree))})`,
);
check(attrs(tree, 'data-tone').includes('error'), 'the discard copy is toned as destructive');
check(attrs(tree, 'data-state')[0] === 'recording', 'the state mark still reports recording');

// Transcribing: no hard cut — bubble, meter and label all persist.
tree = render(true, { ...IDLE, phase: 'transcribing' });
names = classes(tree);
check(names.includes('dsh-htt-bubble'), 'the bubble persists through transcribing');
check(names.includes('dsh-htt-wave'), 'the meter persists through transcribing');
check(attrs(tree, 'data-state')[0] === 'transcribing', 'the mark switches to its transcribing state');
check(litText(tree).join('|') === '识别中', `transcribing shows its copy (got ${JSON.stringify(litText(tree))})`);

// Bubble exit: still mounted, marked as leaving.
tree = render(true, { ...IDLE, bubbleLeaving: true });
check(classes(tree).includes('dsh-htt-bubble'), 'the bubble stays mounted during its exit');
check(attrs(tree, 'data-leaving').length === 1, 'the exiting bubble carries data-leaving');

// Notice, and its exit.
tree = render(false, { ...IDLE, phase: 'notice', notice: '已取消', tone: 'muted' });
check(classes(tree).includes('dsh-htt-notice'), 'the notice renders');
check(attrs(tree, 'data-tone')[0] === 'muted', 'the notice carries its tone');
tree = render(false, { ...IDLE, phase: 'notice', notice: '已取消', tone: 'muted', leaving: true });
check(attrs(tree, 'data-leaving').length === 1, 'the leaving notice carries data-leaving');

// Retained transcript, and its exit.
tree = render(false, { ...IDLE, pending: '你好' });
check(classes(tree).includes('dsh-htt-pending'), 'the retained-transcript chip renders');
tree = render(false, { ...IDLE, pendingLeaving: true });
check(classes(tree).includes('dsh-htt-pending'), 'the chip stays mounted during its exit');
check(attrs(tree, 'data-leaving').length === 1, 'the leaving chip carries data-leaving');

// The press ring, drawing and retracting.
tree = render(false, { ...IDLE, arm: { x: 120, y: 30 } });
names = classes(tree);
check(names.includes('dsh-htt-ring'), 'the press ring renders while arming');
check(names.includes('dsh-htt-ring-arc'), 'the press ring carries its progress arc');
check(attrs(tree, 'aria-hidden').length > 0, 'the decorative layers stay aria-hidden');
tree = render(false, { ...IDLE, arm: { x: 120, y: 30 }, armLeaving: true });
check(attrs(tree, 'data-leaving').length === 1, 'the retracting ring carries data-leaving');

//#endregion

//#region the injected stylesheet

const css = styleText(render(true, IDLE));
check(typeof css === 'string' && css.length > 1500, 'the component injects a stylesheet');

const count = (text, needle) => text.split(needle).length - 1;
check(count(css, '{') === count(css, '}'), `stylesheet braces balance (${count(css, '{')} blocks)`);
check(count(css, '(') === count(css, ')'), 'stylesheet parens balance');
check(css.includes('stroke-dasharray:97.39'), 'the ring arc carries its real circumference');

// Motion must stay on the host's own vocabulary rather than a parallel one.
check(css.includes('border-radius:var(--dsw-radius-panel)'), 'the panel borrows the composer card radius');
check(css.includes('--dsw-menu-backdrop-filter'), 'the panel borrows the host material recipe');
check(css.includes('--dsw-specific-menu'), 'the panel borrows the host surface fill');
check(css.includes('cubic-bezier(.16,1,.3,1)'), "the entrance uses DSH's own ease-out curve");

// Entry and exit must be transitions, so anything reversed mid-flight retargets.
check(css.includes('@starting-style'), 'entry rides @starting-style');
check(css.includes('[data-leaving]'), 'exit rides a data-leaving transition');
check(!/@keyframes[^{]*\{[^}]*bubble/.test(css), 'the bubble is not animated by keyframes');

// Nothing that floats over the transcript may take a click; and a surface that is still
// mounted while it fades must stop accepting input, because `opacity: 0` removes nothing
// from hit testing.
check(rule(css, '.dsh-htt-bubble').includes('pointer-events:none'),
	'the bubble never takes pointer events');
check(rule(css, '.dsh-htt-edge').includes('pointer-events:none'),
	"the card's discard hairline never takes pointer events");
check(rule(css, '.dsh-htt-pending[data-leaving]').includes('pointer-events:none'),
	'the exiting chip does not accept a second click');
check(/\.dsh-htt-ring\{[^}]*transition-delay:110ms/.test(css),
	'the press ring waits before appearing, so caret clicks do not flash it');

// The audit's hard rules, enforced rather than remembered.
check(!/transition:[^;]*\bease-in\b/.test(css), 'no transition uses ease-in');
check(!/transition:\s*all/.test(css), 'no transition targets `all`');
check(!/transition:[^;]*\b(width|height|top|left|margin|padding)\b/.test(css), 'no transition animates a layout property');
const loops = (css.match(/animation:(?!none)/g) ?? []).length;
check(loops === 1, `exactly one looping animation, the transcribing dot (found ${loops})`);
check(/\.dsh-htt-mark\[data-state=transcribing\][^{]*\{[^}]*animation/.test(css),
	'that one loop belongs to the transcribing mark, where nothing else is moving');

for (const query of ['prefers-reduced-motion', 'prefers-reduced-transparency', 'prefers-contrast']) {
	check(css.includes(query), `stylesheet honours ${query}`);
}
// Reduced motion keeps opacity and drops movement; it must not delete the feedback.
const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
check(!/transition:none/.test(reduced), 'reduced motion keeps a transition rather than removing it');
check(/opacity 140ms linear/.test(reduced), 'reduced motion still cross-fades');

//#endregion

if (failures.length > 0) {
	console.error(`render: ${failures.length} problem(s)`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log('render: ok (every gesture state mounts; motion rules hold)');
