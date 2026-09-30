/**
 * Dictionary consistency check.
 *
 * DSH resolves a missing key by falling back through the locale chain and finally
 * returning the key itself, so a key present in only one dictionary shows up as a raw
 * identifier in the UI. Every dictionary must therefore carry exactly the same keys,
 * with the same placeholders.
 *
 * Run with: node tests/locales.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

/** Pull one `const <name> = { ... };` object literal out of the client bundle. */
function dictionary(name) {
	const start = source.indexOf(`const ${name} = {`);
	if (start === -1) throw new Error(`locales: dictionary "${name}" not found in client.js`);
	const end = source.indexOf('\n\t\t};', start);
	if (end === -1) throw new Error(`locales: dictionary "${name}" is not terminated`);
	const literal = source.slice(source.indexOf('{', start), end + 4);
	// The literal is plain data authored in this repository; evaluating it keeps the test
	// honest about the shipped text instead of re-declaring a copy that could drift.
	return new Function(`return (${literal});`)();
}

const zh = dictionary('zh');
const en = dictionary('en');

const failures = [];
const check = (condition, message) => {
	if (!condition) failures.push(message);
};

const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

check(Object.keys(zh).length > 0, 'zh dictionary is empty');
check(
	JSON.stringify(Object.keys(zh).sort()) === JSON.stringify(Object.keys(en).sort()),
	`key sets differ: only-zh=[${Object.keys(zh).filter((key) => !(key in en))}] only-en=[${Object.keys(en).filter((key) => !(key in zh))}]`,
);

for (const [locale, dictionary] of [['zh', zh], ['en', en]]) {
	for (const [key, value] of Object.entries(dictionary)) {
		check(typeof value === 'string', `${locale}.${key} is not a string`);
		check(value !== '', `${locale}.${key} is empty, which stops DSH's fallback chain`);
	}
}

for (const key of Object.keys(zh)) {
	if (!(key in en)) continue;
	check(
		JSON.stringify(placeholders(zh[key])) === JSON.stringify(placeholders(en[key])),
		`${key}: placeholders differ (zh=${placeholders(zh[key])} en=${placeholders(en[key])})`,
	);
}

if (failures.length > 0) {
	console.error(`locales: ${failures.length} problem(s)`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log(`locales: ok (${Object.keys(zh).length} keys x 2 dictionaries, placeholders aligned)`);
