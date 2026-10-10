#!/usr/bin/env node
/**
 * Prints the README's TestFlight badge (#150): which build the TestFlight
 * Beta's public link installs, as the JSON a shields.io endpoint badge reads.
 *
 *     {"schemaVersion":1,"label":"TestFlight","message":"1.0.0 (7)","color":"0D96F6"}
 *
 * Only App Store Connect knows that build. The page behind the public link
 * shows none, and an upload is not it: of the first six uploads, four never
 * entered the group the link belongs to. So this asks the App Store Connect
 * API, with the Team key "OpenReader README badge" (docs/release-to-app-store.md).
 *
 * `.github/workflows/pages.yml` runs it every hour and publishes the answer as
 * testflight.json beside the site. At the Mac it answers the same question for
 * a person, and is how the release guide's TestFlight facts are read:
 *
 *     node --env-file="$HOME/.secrets/openreader/app-store-connect-api.env" scripts/testflight-badge.mjs
 *
 * It reads `ASC_KEY_ID`, `ASC_ISSUER_ID`, and the private key from
 * `ASC_PRIVATE_KEY` (its text, in the workflow) or `ASC_KEY_FILE` (its path, at
 * the Mac). It prints the badge and nothing else: never the key or a token.
 */

import { Buffer } from 'node:buffer';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** OpenReader's Apple ID in App Store Connect. */
export const APP_ID = '6817809106';

/** The public link the README gives. The badge is about the group this link belongs to, and no other. */
export const PUBLIC_LINK = 'https://testflight.apple.com/join/vjC8QejW';

const API = 'https://api.appstoreconnect.apple.com';

/** The group behind the public link, if the link is on. */
const GROUP_PATH = `/v1/betaGroups?filter[app]=${APP_ID}&filter[publicLink]=${PUBLIC_LINK}&filter[publicLinkEnabled]=true&fields[betaGroups]=publicLink&limit=1`;

/** A group's builds that have not expired, each with its Version and its state in external testing. */
const buildsPath = (/** @type {string} */ group) =>
  `/v1/builds?filter[app]=${APP_ID}&filter[betaGroups]=${group}&filter[expired]=false&include=preReleaseVersion,buildBetaDetail&fields[builds]=version,preReleaseVersion,buildBetaDetail&fields[preReleaseVersions]=version&fields[buildBetaDetails]=externalBuildState&limit=200`;

/** How long a token lasts, in seconds. Apple refuses more than 20 minutes. */
export const TOKEN_LIFE = 300;

const base64url = (/** @type {string | Buffer} */ value) => Buffer.from(value).toString('base64url');

/**
 * The token App Store Connect asks for with a request: a JWT signed with the
 * key's private half (ES256).
 *
 * Its `scope` is the one request it is for. The key's Developer role can also
 * upload builds and change internal groups, and a token cannot be widened
 * after it is signed, so one that leaks reads this one path for five minutes
 * and does nothing else: any other path is refused with
 * `REQUEST_DOES_NOT_MATCH_SCOPE`. The scope has to carry a query when the
 * request does: a scope of `GET /v1/betaGroups` alone is refused (403) for
 * that path with a query (notes 2026-10-10).
 *
 * @param {{ keyId: string, issuerId: string, privateKey: string, path: string, now?: number }} request `privateKey` is the text of the `.p8`; `path` is the path and query to read; `now` is in milliseconds.
 * @returns {string}
 */
export function token({ keyId, issuerId, privateKey, path, now = Date.now() }) {
  const issued = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = { iss: issuerId, iat: issued, exp: issued + TOKEN_LIFE, aud: 'appstoreconnect-v1', scope: [`GET ${path}`] };
  const signed = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // A JWT's signature is the two numbers side by side, not the DER that `sign` writes by default.
  const signature = sign('sha256', Buffer.from(signed), { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  return `${signed}.${base64url(signature)}`;
}

/**
 * The build the public link installs, as records name a build: `1.0.0 (7)`.
 * It is the highest Build Number among the group's builds that testers can
 * install, which is the state `IN_BETA_TESTING` ("Testing" on App Store
 * Connect's own page). A build waiting for Beta App Review, or approved and
 * not yet started, is in the group and installs for nobody.
 *
 * @param {{ data?: any[], included?: any[] }} builds The answer to `buildsPath`.
 * @returns {string | null} `null` when the link installs nothing.
 */
export function testedBuild(builds) {
  const included = new Map((builds.included ?? []).map((resource) => [`${resource.type}/${resource.id}`, resource.attributes]));
  const related = (/** @type {any} */ build, /** @type {string} */ name) => {
    const to = build.relationships?.[name]?.data;
    return to ? included.get(`${to.type}/${to.id}`) : undefined;
  };
  const testing = (builds.data ?? [])
    .filter((build) => related(build, 'buildBetaDetail')?.externalBuildState === 'IN_BETA_TESTING')
    .filter((build) => related(build, 'preReleaseVersion')?.version && /^\d+$/.test(build.attributes?.version ?? ''))
    // A Build Number is never used twice and only goes up, across all Versions (CONTEXT.md).
    .sort((a, b) => Number(b.attributes.version) - Number(a.attributes.version));
  const newest = testing[0];
  return newest ? `${related(newest, 'preReleaseVersion').version} (${newest.attributes.version})` : null;
}

/**
 * What shields.io draws. The README's address adds the style and the logo, so
 * that a file it cannot read still draws as a TestFlight badge.
 *
 * @param {string | null} build
 */
export function badge(build) {
  return build
    ? { schemaVersion: 1, label: 'TestFlight', message: build, color: '0D96F6' }
    : { schemaVersion: 1, label: 'TestFlight', message: 'none', color: 'lightgrey' };
}

/**
 * @param {string} path
 * @param {{ keyId: string, issuerId: string, privateKey: string }} key
 */
async function read(path, key) {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token({ ...key, path })}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body.errors?.[0];
    throw new Error(`App Store Connect answered ${response.status} to GET ${path.split('?')[0]}: ${error?.detail ?? error?.title ?? 'no detail'}`);
  }
  return body;
}

async function main() {
  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  const privateKey = process.env.ASC_PRIVATE_KEY || (process.env.ASC_KEY_FILE ? readFileSync(process.env.ASC_KEY_FILE, 'utf8') : '');
  if (!keyId || !issuerId || !privateKey) throw new Error('Set ASC_KEY_ID, ASC_ISSUER_ID, and ASC_PRIVATE_KEY or ASC_KEY_FILE.');

  const key = { keyId, issuerId, privateKey };
  const group = (await read(GROUP_PATH, key)).data?.[0];
  // No group answers when the public link is off: then it installs nothing.
  const build = group ? testedBuild(await read(buildsPath(group.id), key)) : null;
  process.stdout.write(`${JSON.stringify(badge(build))}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
