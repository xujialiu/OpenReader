import { describe, expect, it } from 'vitest';
import { SynthesisError } from '../../../src/core/providers/errors';

describe('SynthesisError', () => {
  it('marks transient failures as retriable', () => {
    expect(new SynthesisError('network').retriable).toBe(true);
    expect(new SynthesisError('rate-limit').retriable).toBe(true);
    expect(new SynthesisError('local-server-down').retriable).toBe(true);
  });

  it('marks configuration and data failures as not retriable', () => {
    expect(new SynthesisError('no-key').retriable).toBe(false);
    expect(new SynthesisError('decode-failed').retriable).toBe(false);
  });

  it('uses the kind as the message when none is given', () => {
    expect(new SynthesisError('no-key').message).toBe('no-key');
    expect(new SynthesisError('no-key', 'set an API key').message).toBe('set an API key');
  });
});
