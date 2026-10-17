import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { PurchaseScreen } from '../../src/app/purchase-screen';
import { purchaseValue, VERIFICATION_UNAVAILABLE } from '../../src/app/purchase';
import type { ScreenProps } from '../../src/app/routes';
import type { Access } from '../../src/purchase/access';

const mock = vi.hoisted(() => ({ access: { kind: 'unavailable' } as Access, goBack: vi.fn() }));
vi.mock('../../src/app/use-purchases', () => ({ usePurchases: () => ({ access: mock.access, price: '$4.99', unavailable: mock.access.kind === 'unavailable' }) }));
vi.mock('../../src/app/controls', async () => {
  const { createElement } = await import('react');
  return Object.fromEntries(['ActionRow', 'Footnote', 'SettingsGroup', 'SettingsPage'].map((name) => [name,
    ({ children, footer, ...props }: Record<string, unknown> & { children?: ReactNode; footer?: ReactNode }) => createElement(name, props, children, footer)]));
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let view: ReactTestRenderer | undefined;
afterEach(async () => { if (view) await act(async () => view!.unmount()); view = undefined; vi.clearAllMocks(); });
async function show(access: Access) {
  mock.access = access;
  await act(async () => { view = create(createElement(PurchaseScreen, {
    navigation: { canGoBack: () => true, goBack: mock.goBack },
  } as unknown as ScreenProps<'Purchase'>)); });
}
const rows = () => view!.root.findAll((node) => String(node.type) === 'ActionRow').map((node) => node.props.label);

it('unavailable verification offers Restore, not a fresh Trial or another Unlock even when the price is loaded', async () => {
  await show({ kind: 'unavailable' });
  expect(rows()).toEqual(['Restore Purchase']);
  const words = view!.root.findAll((node) => String(node.type) === 'Footnote').map((node) => [node.props.children].flat().join(''));
  expect(words).toEqual([VERIFICATION_UNAVAILABLE.message]);
  expect(purchaseValue(mock.access, 0)).toBe('Unavailable');
  expect(mock.goBack).not.toHaveBeenCalled();
});

it('a verified not-started state still offers the Trial and Unlock', async () => {
  await show({ kind: 'not-started' });
  expect(rows()).toEqual(['Start Free Trial', 'Unlock for $4.99', 'Restore Purchase']);
  expect(purchaseValue(mock.access, 0)).toBeUndefined();
});

it('returns after the Unlock is verified', async () => {
  await show({ kind: 'unlocked' });
  expect(mock.goBack).toHaveBeenCalledOnce();
});
