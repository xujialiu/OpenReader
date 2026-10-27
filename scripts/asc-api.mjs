#!/usr/bin/env node
/**
 * One App Store Connect API request from the Mac, with the Team key the
 * release guide uses (docs/app-store-connect.md, "TestFlight and API access"):
 *
 *     node --env-file="$HOME/.secrets/openreader/app-store-connect-api.env" scripts/asc-api.mjs '/v1/builds?filter[app]=6817809106&limit=3'
 *     node --env-file="$HOME/.secrets/openreader/app-store-connect-api.env" scripts/asc-api.mjs PATCH /v1/betaBuildLocalizations/ID '{"data":{…}}'
 *
 * A bare path is a GET. It prints the HTTP status on the first line and the
 * answer's JSON after it, so a pipe reads the status with `readline()` and
 * parses the rest. A read's token is scoped to its path and query; a write's
 * carries no scope (`token` in testflight-badge.mjs). It never prints the key
 * or a token.
 */

import { readFileSync } from 'node:fs';

import { token } from './testflight-badge.mjs';

const args = process.argv.slice(2);
const [method, path, body] = args[0]?.startsWith('/') ? ['GET', ...args] : args;
if (!method || !path?.startsWith('/')) {
  console.error('Usage: asc-api.mjs [METHOD] /v1/path?query [json-body]');
  process.exit(2);
}

const keyId = process.env.ASC_KEY_ID;
const issuerId = process.env.ASC_ISSUER_ID;
const privateKey = process.env.ASC_PRIVATE_KEY || (process.env.ASC_KEY_FILE ? readFileSync(process.env.ASC_KEY_FILE, 'utf8') : '');
if (!keyId || !issuerId || !privateKey) {
  console.error('Set ASC_KEY_ID, ASC_ISSUER_ID, and ASC_PRIVATE_KEY or ASC_KEY_FILE.');
  process.exit(2);
}

// The Mac's connection to Apple drops now and then (a connect timeout after
// 10 s); a request that never reached Apple is sent again, at most twice.
// Every request here reads, or writes a whole value, so a repeat is harmless.
let response;
for (let attempt = 1; !response; attempt += 1) {
  try {
    response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token({ keyId, issuerId, privateKey, path, method })}`, 'Content-Type': 'application/json' },
      body,
    });
  } catch (error) {
    if (attempt === 3) {
      console.error(`${method} ${path.split('?')[0]} did not reach App Store Connect: ${error.cause?.code ?? error.message}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
console.log(response.status);
const text = await response.text();
console.log(text ? JSON.stringify(JSON.parse(text), null, 1) : '{}');
