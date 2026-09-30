#!/usr/bin/env node
/**
 * Writes src/app/acknowledgements.json: every third-party component the iOS
 * app ships, its licence, and the licence's own text (#111), which Settings →
 * Acknowledgements shows.
 *
 * Regenerate after any change to dependencies, from the repository root, with
 * an ios/ from a prebuild of the same tree (the pods come from its Podfile.lock):
 *
 *     npx expo prebuild --platform ios
 *     npm run acknowledgements
 *
 * `npm run acknowledgements -- --fetch` also fetches any licence text that
 * vendored.mjs names and licenses/ does not have yet; without it a missing one
 * fails the run, so a regeneration never reaches the network by surprise.
 *
 * A component reaches the app three ways, so there are three sources:
 *
 * 1. JavaScript: the packages whose modules are in a production bundle. The
 *    bundle's source map names each module's file, and a file under
 *    node_modules/<name>/ belongs to <name>.
 * 2. Native: the pods in ios/Podfile.lock, each traced through its
 *    `:path:` or `:podspec:` to the package that holds it. Our own modules and
 *    what the build generates are ours, not third-party.
 * 3. Vendored: what a package carries inside itself, listed by hand in
 *    vendored.mjs, because nothing machine-readable names it.
 *
 * A package's text is its own licence file (LICENSE, LICENCE, COPYING, then
 * NOTICE). A package without one gets the stand-in MISSING_LICENSE_FILES names,
 * and a note saying so. A package with neither fails the run: an entry without
 * its text is the thing this file exists to prevent.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MISSING_LICENSE_FILES, VENDORED } from './vendored.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUTPUT = join(ROOT, 'src', 'app', 'acknowledgements.json');
const LICENSES = join(HERE, 'licenses');
const FETCH = process.argv.includes('--fetch');

const LICENSE_FILE = /^(licen[cs]e|copying)(\b|[._-])/i;
const NOTICE_FILE = /^notice(\b|[._-])/i;

function fail(message) {
  console.error(`acknowledgements: ${message}`);
  process.exit(1);
}

/** A licence text as it is shown: no trailing spaces, no runs of blank lines, no blank edges. */
function tidy(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** The package directory a path lies in: the last `node_modules/<name>` or `node_modules/@scope/<name>` in it. */
function packageRoot(path) {
  const at = path.lastIndexOf('node_modules/');
  if (at < 0) return null;
  const rest = path.slice(at + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
  return join(ROOT, path.slice(0, at).replace(/^\/+/, ''), 'node_modules', name);
}

/** `license` as npm writes it now, or as older packages still write it. */
function licenseOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === 'string') return license;
  if (license && typeof license.type === 'string') return license.type;
  if (Array.isArray(licenses)) return licenses.map((entry) => entry.type ?? entry).join(' OR ');
  return null;
}

function licenseFiles(directory) {
  const names = readdirSync(directory).filter((name) => statSync(join(directory, name)).isFile());
  const licences = names.filter((name) => LICENSE_FILE.test(name)).sort();
  const notices = names.filter((name) => NOTICE_FILE.test(name)).sort();
  return [...licences, ...notices].map((name) => readFileSync(join(directory, name), 'utf8'));
}

/** 1. The packages the production bundle's modules come from. */
function bundledPackages() {
  const scratch = mkdtempSync(join(tmpdir(), 'openreader-acknowledgements-'));
  try {
    const environment = { ...process.env };
    delete environment.EXPO_PUBLIC_OPENREADER_DEBUG_MODE; // the release bundle, as a submission carries it (ADR 0054)
    execFileSync('npx', ['expo', 'export:embed', '--platform', 'ios', '--dev', 'false', '--entry-file', 'index.ts',
      '--bundle-output', join(scratch, 'main.jsbundle'), '--sourcemap-output', join(scratch, 'main.map'),
      '--assets-dest', join(scratch, 'assets')], { cwd: ROOT, env: environment, stdio: ['ignore', 'ignore', 'inherit'] });
    const { sources } = JSON.parse(readFileSync(join(scratch, 'main.map'), 'utf8'));
    return new Set(sources.map(packageRoot).filter(Boolean));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** 2. The packages the pods come from. */
function podPackages(lockfile) {
  const external = lockfile.split('EXTERNAL SOURCES:')[1]?.split('SPEC CHECKSUMS:')[0];
  if (!external) fail('ios/Podfile.lock has no EXTERNAL SOURCES');
  const repos = lockfile.split('SPEC REPOS:')[1]?.split('EXTERNAL SOURCES:')[0]?.trim();
  if (repos) fail(`a pod comes from a spec repo, which this script cannot trace to a package:\n${repos}`);
  const paths = [...external.matchAll(/:(?:path|podspec): "?([^"\n]+)"?/g)].map((match) => match[1]);
  return new Set(paths.map((path) => packageRoot(relative(ROOT, join(ROOT, 'ios', path)))).filter(Boolean));
}

async function cached(file, url) {
  const path = join(LICENSES, file);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (!FETCH) fail(`licenses/${file} is missing; run with --fetch to take it from ${url}`);
  const response = await fetch(url);
  if (!response.ok) fail(`${url} answered ${response.status}`);
  const text = await response.text();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return text;
}

function npmPacked(spec) {
  const path = join(LICENSES, 'npm', `${spec.replace('/', '__')}.txt`);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (!FETCH) fail(`licenses/npm/${spec}.txt is missing; run with --fetch to take it from the npm registry`);
  const scratch = mkdtempSync(join(tmpdir(), 'openreader-npm-'));
  try {
    const packed = execFileSync('npm', ['pack', spec, '--pack-destination', scratch, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['-xzf', join(scratch, packed), '-C', scratch]);
    const texts = licenseFiles(join(scratch, 'package'));
    // A few old packages put their licence in the README's "License" section instead of a file.
    const text = texts.length ? texts.join('\n\n') : readmeLicense(join(scratch, 'package'));
    if (!text) fail(`${spec} ships no licence file and its README has no License section`);
    if (!texts.length) console.warn(`acknowledgements: ${spec}'s licence comes from its README`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return text;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The "License" section of a package's README, heading and all, up to the next heading of the same or a higher level. */
function readmeLicense(directory) {
  const readme = readdirSync(directory).find((name) => /^readme(\.md|\.markdown)?$/i.test(name));
  if (!readme) return null;
  const lines = readFileSync(join(directory, readme), 'utf8').split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s+licen[cs]e\b/i.test(line));
  if (start < 0) return null;
  const level = /^#+/.exec(lines[start])[0].length;
  const end = lines.findIndex((line, at) => at > start && /^#+\s/.test(line) && /^#+/.exec(line)[0].length <= level);
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || null;
}

/** The comment a source file opens with, `//` or `/* … *\/`, without its comment marks. */
function leadingComment(text) {
  const lines = text.split('\n');
  const kept = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlock) {
      const end = trimmed.indexOf('*/');
      kept.push((end >= 0 ? trimmed.slice(0, end) : trimmed).replace(/^\*+ ?/, ''));
      if (end >= 0) inBlock = false;
    } else if (trimmed.startsWith('/*')) {
      const body = trimmed.replace(/^\/\*+!? ?/, '');
      const end = body.indexOf('*/');
      kept.push(end >= 0 ? body.slice(0, end) : body);
      inBlock = end < 0;
    } else if (trimmed.startsWith('//')) {
      kept.push(trimmed.replace(/^\/\/+ ?/, ''));
    } else if (trimmed === '') {
      kept.push('');
    } else {
      break;
    }
  }
  return kept.join('\n');
}

function between(text, from, to, last) {
  const start = last ? text.lastIndexOf(from) : text.indexOf(from);
  if (start < 0) return null;
  const end = text.indexOf(to, start + from.length);
  if (end < 0) return null;
  return text.slice(start, end + to.length).split('\n').map((line) => line.replace(/^\s*(\*\*?|\/\/)\s?/, '')).join('\n');
}

async function vendoredText(part) {
  if (part.cache) return cached(part.cache, part.url);
  if (part.npm) return npmPacked(part.npm);
  if (part.spdx) {
    const standard = await cached(`spdx/${part.spdx}.txt`, `https://raw.githubusercontent.com/spdx/license-list-data/main/text/${part.spdx}.txt`);
    if (!standard.includes('<year> <copyright holders>')) fail(`licenses/spdx/${part.spdx}.txt has no copyright line to fill`);
    return standard.replace('<year> <copyright holders>', part.holder);
  }
  if (part.pods) {
    const path = join(ROOT, 'ios', 'Pods', part.pods);
    if (!existsSync(path)) fail(`ios/Pods/${part.pods} is missing; run pod install`);
    return readFileSync(path, 'utf8');
  }
  const path = join(ROOT, 'node_modules', part.source);
  if (!existsSync(path)) fail(`node_modules/${part.source} is missing: the package changed, so vendored.mjs needs another look`);
  const text = readFileSync(path, 'utf8');
  const found = part.leading ? leadingComment(text) : between(text, part.from, part.to, part.last);
  if (!found || !found.trim()) fail(`no notice found in node_modules/${part.source}: the file changed, so vendored.mjs needs another look`);
  return found;
}

function versionOf(entry, lockfile) {
  const { version } = entry;
  if (typeof version === 'string' || version === null) return version;
  if (version.podfile) {
    const match = new RegExp(`^  - ${version.podfile} \\(([^)]+)\\)`, 'm').exec(lockfile);
    if (!match) fail(`${version.podfile} is not in ios/Podfile.lock`);
    return match[1];
  }
  const [file, name] = version.define;
  const match = new RegExp(`#define ${name}\\s+"([^"]+)"`).exec(readFileSync(join(ROOT, 'node_modules', file), 'utf8'));
  if (!match) fail(`no ${name} in node_modules/${file}`);
  return match[1];
}

const sortKey = (name) => name.replace(/^[^\p{L}\p{N}]+/u, '');

/** Semantic-ish ordering for a list of versions: numeric parts compared as numbers. */
function compareVersions(a, b) {
  const x = a.split(/[.-]/), y = b.split(/[.-]/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? '', q = y[i] ?? '';
    const difference = /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) - Number(q) : p.localeCompare(q);
    if (difference) return difference;
  }
  return 0;
}

async function packageEntry(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const license = licenseOf(manifest);
  if (!license) fail(`${manifest.name} declares no licence`);
  let texts = licenseFiles(directory);
  let note;
  if (!texts.length) {
    const standIn = MISSING_LICENSE_FILES.find((rule) => rule.match.test(manifest.name));
    if (!standIn) fail(`${manifest.name} ships no licence file, and MISSING_LICENSE_FILES names no stand-in`);
    texts = standIn.from.package
      ? licenseFiles(join(ROOT, 'node_modules', standIn.from.package))
      : [await cached(standIn.from.cache, standIn.from.url)];
    note = standIn.note;
  }
  return { name: manifest.name, versions: [manifest.version], license, texts, note };
}

function merge(into, entry) {
  const found = into.get(entry.name);
  if (!found) {
    into.set(entry.name, { ...entry, versions: [...entry.versions], texts: [...entry.texts], notes: entry.note ? [entry.note] : [] });
    return;
  }
  for (const version of entry.versions) if (!found.versions.includes(version)) found.versions.push(version);
  for (const text of entry.texts) if (!found.texts.some((kept) => tidy(kept) === tidy(text))) found.texts.push(text);
  if (entry.license !== found.license && !found.license.split(' / ').includes(entry.license)) found.license = `${found.license} / ${entry.license}`;
  // A second copy carried inside another package: the note says which version is that copy.
  const note = entry.note && entry.carriedBy && entry.versions.length ? `${entry.versions.join(', ')}: ${entry.note}` : entry.note;
  if (note && !found.notes.includes(note)) found.notes.push(note);
}

async function main() {
  const lockPath = join(ROOT, 'ios', 'Podfile.lock');
  if (!existsSync(lockPath)) fail('ios/Podfile.lock is missing; run `npx expo prebuild --platform ios` first');
  const lockfile = readFileSync(lockPath, 'utf8');

  const bundled = bundledPackages();
  const pods = podPackages(lockfile);
  const directories = [...new Set([...bundled, ...pods])].sort();
  const components = new Map();
  for (const directory of directories) merge(components, await packageEntry(directory));
  const shipped = new Set(components.keys());

  let vendored = 0;
  for (const entry of VENDORED) {
    if (!shipped.has(entry.in)) continue;
    if (entry.linked && !readFileSync(join(ROOT, 'ios', entry.linked.file), 'utf8').includes(entry.linked.contains)) continue;
    const texts = [];
    for (const part of entry.text) texts.push(await vendoredText(part));
    const version = versionOf(entry, lockfile);
    merge(components, { name: entry.name, versions: version ? [version] : [], license: entry.license, texts, note: entry.note, carriedBy: entry.in });
    vendored++;
  }

  const list = [...components.values()]
    .map((entry) => ({
      name: entry.name,
      version: entry.versions.sort(compareVersions).join(', '),
      license: entry.license,
      ...(entry.carriedBy ? { carriedBy: entry.carriedBy } : {}),
      ...(entry.notes.length ? { note: entry.notes.join(' ') } : {}),
      text: entry.texts.map(tidy).join('\n\n———\n\n'),
    }))
    // Alphabetical by the name's first letter or digit, so `@babel/runtime` sorts under b and `{fmt}` under f.
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name));

  for (const entry of list) if (!entry.text) fail(`${entry.name} has an empty licence text`);
  writeFileSync(OUTPUT, `${JSON.stringify(list, null, 2)}\n`);
  const nativeOnly = [...pods].filter((directory) => !bundled.has(directory)).length;
  console.log(`acknowledgements: ${list.length} components (${bundled.size} JavaScript packages, ${nativeOnly} native-only packages, ${vendored} vendored) → ${relative(ROOT, OUTPUT)}`);
}

await main();
