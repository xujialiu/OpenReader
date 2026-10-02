#!/usr/bin/env node
// Port of src/app/accent.ts's pure arithmetic (luminance/contrast/mix/accentOn),
// to compute the expected reading/onMark/following shades for any word colour.
'use strict';
function channels(color) {
  const c = color.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
}
function toHex(t) { return '#' + t.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function luminance(color) {
  const [r, g, b] = channels(color).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [l, d] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l + 0.05) / (d + 0.05);
}
function mix(color, toward, share) {
  return toHex(channels(color).map((v) => Math.round(v + (toward - v) * share)));
}
const ACCENT_SURFACES = { light: ['#ffffff', '#f4f4f6'], dark: ['#111114', '#1c1c21'] };
const MARK_SURFACES = { light: ['#dcdce2', '#ffffff'], dark: ['#3e3e47', '#2c2c32'] };
function accentOn(color, scheme, surfaces) {
  const toward = scheme === 'light' ? 0 : 255;
  const reads = (share) => surfaces.every((s) => contrast(mix(color, toward, share), s) >= 4.5);
  if (reads(0)) return mix(color, toward, 0);
  let short = 0, enough = 1;
  for (let i = 0; i < 24; i += 1) {
    const middle = (short + enough) / 2;
    if (reads(middle)) enough = middle; else short = middle;
  }
  return mix(color, toward, enough);
}
function readingAccent(wordColor, scheme) {
  return {
    reading: accentOn(wordColor, scheme, ACCENT_SURFACES[scheme]),
    onMark: accentOn(wordColor, scheme, MARK_SURFACES[scheme]),
  };
}
const [word, scheme] = process.argv.slice(2);
const a = readingAccent(word, scheme);
console.log(JSON.stringify({ word, scheme, ...a }));
