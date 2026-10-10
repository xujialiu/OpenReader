import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { badge, PUBLIC_LINK, testedBuild, token, TOKEN_LIFE } from '../../scripts/testflight-badge.mjs';

/**
 * #150: the README's TestFlight badge names the build the TestFlight Beta's
 * public link installs, and nobody types it. scripts/testflight-badge.mjs asks
 * App Store Connect, `.github/workflows/pages.yml` publishes its answer as
 * testflight.json beside the site, and the badge reads that file through
 * shields.io.
 *
 * The badge was 1.0.0 (5) for as long as a person kept it, a build that never
 * entered external testing, while the link installed 6 and then 7. What is
 * held here is the part a wrong answer would come from: which build is picked.
 */

const ROOT = join(__dirname, '..', '..');

/** One build as App Store Connect lists it, with the two resources it points to. */
function build(number: string, state: string, version = '1.0.0') {
  return {
    data: {
      type: 'builds',
      id: `build-${number}`,
      attributes: { version: number },
      relationships: {
        preReleaseVersion: { data: { type: 'preReleaseVersions', id: `version-${version}` } },
        buildBetaDetail: { data: { type: 'buildBetaDetails', id: `build-${number}` } },
      },
    },
    included: [
      { type: 'preReleaseVersions', id: `version-${version}`, attributes: { version } },
      { type: 'buildBetaDetails', id: `build-${number}`, attributes: { externalBuildState: state } },
    ],
  };
}

/** The answer to a read of a group's builds. */
function listing(...builds: ReturnType<typeof build>[]) {
  return { data: builds.map((each) => each.data), included: builds.flatMap((each) => each.included) };
}

describe('#150: the build the TestFlight Beta installs', () => {
  it('is the highest Build Number in testing, written as records write a build', () => {
    // What App Store Connect answered on 2026-10-10, in an order it does not promise.
    expect(testedBuild(listing(build('6', 'IN_BETA_TESTING'), build('7', 'IN_BETA_TESTING')))).toBe('1.0.0 (7)');
  });

  it('is not a newer build that testers cannot install yet', () => {
    const waiting = ['WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', 'BETA_APPROVED', 'READY_FOR_BETA_TESTING', 'READY_FOR_BETA_SUBMISSION', 'BETA_REJECTED', 'EXPIRED'];
    const newer = waiting.map((state, index) => build(String(8 + index), state));
    expect(testedBuild(listing(...newer, build('7', 'IN_BETA_TESTING')))).toBe('1.0.0 (7)');
  });

  it('compares Build Numbers as numbers, so 10 follows 9', () => {
    expect(testedBuild(listing(build('10', 'IN_BETA_TESTING'), build('9', 'IN_BETA_TESTING')))).toBe('1.0.0 (10)');
  });

  it("carries the build's own Version", () => {
    expect(testedBuild(listing(build('7', 'IN_BETA_TESTING'), build('10', 'IN_BETA_TESTING', '1.0.1')))).toBe('1.0.1 (10)');
  });

  it('is nothing when no build is in testing', () => {
    expect(testedBuild(listing(build('8', 'WAITING_FOR_BETA_REVIEW')))).toBeNull();
    expect(testedBuild({ data: [] })).toBeNull();
    expect(testedBuild({})).toBeNull();
  });
});

describe('#150: the badge', () => {
  it('names the build in the blue the README has always drawn it in', () => {
    expect(badge('1.0.0 (7)')).toEqual({ schemaVersion: 1, label: 'TestFlight', message: '1.0.0 (7)', color: '0D96F6' });
  });

  it('reads none, in grey, when the link installs nothing', () => {
    expect(badge(null)).toEqual({ schemaVersion: 1, label: 'TestFlight', message: 'none', color: 'lightgrey' });
  });
});

describe('#150: the token a read is made with', () => {
  // A key of the kind App Store Connect issues: P-256, PKCS#8. Made here, and good for nothing.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const path = '/v1/builds?filter[app]=1&limit=200';
  const now = Date.UTC(2026, 9, 10, 6, 0, 0);
  const signed = token({ keyId: 'KEYID12345', issuerId: 'issuer-id', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), path, now });
  const [header, payload, signature] = signed.split('.');
  const decoded = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

  it('is a JWT the key signed, in the form App Store Connect verifies', () => {
    expect(decoded(header)).toEqual({ alg: 'ES256', kid: 'KEYID12345', typ: 'JWT' });
    const valid = verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
    expect(valid).toBe(true);
  });

  it('lasts five minutes, inside the twenty Apple allows', () => {
    const { iat, exp, iss, aud } = decoded(payload);
    expect({ iat, iss, aud }).toEqual({ iat: now / 1000, iss: 'issuer-id', aud: 'appstoreconnect-v1' });
    expect(exp - iat).toBe(TOKEN_LIFE);
    expect(TOKEN_LIFE).toBeLessThanOrEqual(20 * 60);
  });

  it('allows the one read it was signed for, query included', () => {
    expect(decoded(payload).scope).toEqual([`GET ${path}`]);
  });
});

describe('#150: the README reads the file the workflow publishes', () => {
  const PUBLISHED = 'https://xujialiu.github.io/OpenReader/testflight.json';
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');

  it('is published there by the workflow, from what the script prints', () => {
    expect(workflow).toContain(PUBLISHED);
    expect(workflow).toContain('node scripts/testflight-badge.mjs');
    expect(workflow).toContain('site/testflight.json');
  });

  it('asks about the link the README gives', () => {
    expect(readme).toContain(PUBLIC_LINK);
  });
});
