import { createRequire } from 'node:module';
import esm from 'sentencex';
import { expect, it } from 'vitest';
import type { SplitSentences } from '../../../src/core/segmenter/sentences';

const cjs: SplitSentences = createRequire(import.meta.url)('sentencex');
const paragraph = (count: number) => 'This is a sentence of ordinary prose. '.repeat(count).trimEnd();

// A relative CPU-work budget rather than a wall-clock deadline: samples on a
// busy host should not depend on how much time other test workers get to run.
function medianCpu(split: SplitSentences, sentences: number) {
  const text = paragraph(sentences);
  const samples = Array.from({ length: 3 }, () => {
    const start = process.cpuUsage();
    const pieces = split('en', text);
    const { user, system } = process.cpuUsage(start);
    expect(pieces).toHaveLength(sentences);
    return user + system;
  });
  return samples.sort((a, b) => a - b)[1];
}

it.each([['ESM', esm], ['CJS', cjs]] as const)('#248 %s splitting work grows near linearly within one long Block', (_name, split) => {
  split('en', paragraph(200));
  const small = medianCpu(split, 500);
  const large = medianCpu(split, 2000);
  // 4x the input. The original full-prefix scans grew roughly 16x. Give
  // linear work ample headroom for warmup, small samples and occasional GC.
  expect(large).toBeLessThan(8 * small + 5_000);
});
