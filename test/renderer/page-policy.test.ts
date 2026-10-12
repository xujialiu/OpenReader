import { createRequire } from 'node:module';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

/**
 * ADR 0077: a Document's own script does not run in the reader's page.
 *
 * The page keeps `allow-scripts` on every section's frame, because the reader's
 * own listeners in a section do not run without it (measured 2026-10-12: with
 * `allowScriptedContent: false` a tap on a word posted nothing). What stops a
 * Document's script is the page's Content Security Policy, which a section
 * epub.js writes into an `about:srcdoc` frame inherits: only a script carrying
 * the page's nonce runs, and only the page's own three scripts carry it.
 *
 * That the policy is inherited and the reader's listeners still run is a fact
 * about WebKit, measured in a WKWebView (notes/NOTES_2026-10-12.md) and not
 * something this file can show. What it pins is the page the patched library
 * writes: the policy is there, first, and every script of the page's own carries
 * a nonce no Document can know in advance.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const require = createRequire(import.meta.url);
const { useInjectWebViewVariables } = require('@epubjs-react-native/core/lib/commonjs/hooks/useInjectWebviewVariables.js') as {
  useInjectWebViewVariables(): { injectWebViewVariables(options: Record<string, unknown>): string };
};

/** The page as `Reader.js` asks for it for a base64 Document, with what OpenReader passes. */
function writePage(): string {
  let inject: ((options: Record<string, unknown>) => string) | null = null;
  function Probe() {
    inject = useInjectWebViewVariables().injectWebViewVariables;
    return null;
  }
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(createElement(Probe));
  });
  const page = inject!({
    jszip: 'file:///documents/jszip.min.js',
    epubjs: 'file:///documents/epub.min.js',
    type: 'base64',
    book: 'UEsDBA==',
    theme: {},
    locations: undefined,
    enableSelection: false,
    allowScriptedContent: true,
    allowPopups: false,
    manager: 'continuous',
    flow: 'scrolled-continuous',
  });
  act(() => renderer?.unmount());
  return page;
}

const POLICY = /<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-([a-z0-9]+)'">/g;

describe("the reader's page lets only its own scripts run (ADR 0077)", () => {
  it('has one policy, in its head, before any script', () => {
    const page = writePage();
    const policies = [...page.matchAll(POLICY)];
    expect(policies).toHaveLength(1);
    const at = policies[0].index;
    expect(at).toBeGreaterThan(page.indexOf('<head>'));
    expect(at).toBeLessThan(page.indexOf('</head>'));
    expect(at).toBeLessThan(page.indexOf('<script'));
  });

  it('puts the policy nonce on each of its three scripts, and on nothing else', () => {
    const page = writePage();
    const nonce = [...page.matchAll(POLICY)][0][1];
    const scripts = page.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toEqual([
      `<script nonce="${nonce}" src="file:///documents/jszip.min.js">`,
      `<script nonce="${nonce}" src="file:///documents/epub.min.js">`,
      `<script nonce="${nonce}">`,
    ]);
    expect(page).not.toContain('OPENREADER_NONCE');
  });

  it('draws a new nonce for every page, too long to guess', () => {
    const nonces = Array.from({ length: 20 }, () => [...writePage().matchAll(POLICY)][0][1]);
    expect(new Set(nonces).size).toBe(nonces.length);
    for (const nonce of nonces) expect(nonce.length).toBe(32);
  });
});
