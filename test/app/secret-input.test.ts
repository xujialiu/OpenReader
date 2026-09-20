import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useSecretInput } from '../../src/app/use-secret-input';
import { flushProviderEdits } from '../../src/app/provider-edits';
import type { ProviderSecret } from '../../src/app/use-provider-secrets';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('loads a saved credential without writing it, locks edits, and allows direct deletion', async () => {
  let saved = 'test-existing-credential';
  const secret: ProviderSecret = {
    presence: { state: 'held' },
    with: async (consume) => consume(saved),
    save: vi.fn(async (next) => { saved = next; return null; }),
    forget: vi.fn(async () => { saved = ''; return null; }),
  };
  let input!: ReturnType<typeof useSecretInput>;
  function Probe({ locked }: { locked: boolean }) { input = useSecretInput('compatible', 'API key', secret, locked); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe, { locked: true })); });
  try {
    expect(input.value).toBe(saved);
    expect(secret.save).not.toHaveBeenCalled();
    expect(input.editable).toBe(false);
    await act(async () => { input.change(''); });
    expect(secret.forget).not.toHaveBeenCalled();
    await act(async () => { tree.update(createElement(Probe, { locked: false })); });
    expect(input.editable).toBe(true);
    await act(async () => { input.change(''); await flushProviderEdits('compatible'); });
    expect(saved).toBe('');
    expect(secret.forget).toHaveBeenCalledOnce();
    await act(async () => { input.change('replacement'); await flushProviderEdits('compatible'); });
    expect(saved).toBe('replacement');
  } finally { await act(async () => { tree.unmount(); }); }
});

it('does not permit overwriting a credential that could not be read', async () => {
  const secret: ProviderSecret = {
    presence: { state: 'refused', message: 'locked' },
    with: async () => { throw new Error('locked'); },
    save: vi.fn(), forget: vi.fn(),
  };
  let input!: ReturnType<typeof useSecretInput>;
  function Probe() { input = useSecretInput('fish', 'API key', secret, false); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  try {
    expect(input.editable).toBe(false);
    expect(input.error).toContain('unavailable');
    await act(async () => { input.change('replacement'); });
    expect(secret.save).not.toHaveBeenCalled();
  } finally { await act(async () => { tree.unmount(); }); }
});
