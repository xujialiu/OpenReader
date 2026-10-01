import { beforeEach, expect, it, vi } from 'vitest';

import { openPrivacyPolicy, PRIVACY_POLICY, SITE } from '../../src/app/own-site';

/**
 * #110: the privacy policy opens in Safari, at the address the repository's
 * Pages workflow publishes `site/privacy.html` to. If the phone refuses to open
 * it, an alert gives the address so it can be typed instead.
 */
const openURL = vi.hoisted(() => vi.fn());
const alert = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Linking: { openURL }, Alert: { alert } }));

beforeEach(() => {
  openURL.mockReset();
  alert.mockReset();
});

it('is the privacy page on the project\'s own site', () => {
  expect(SITE).toBe('https://xujialiu.github.io/OpenReader/');
  expect(PRIVACY_POLICY).toBe('https://xujialiu.github.io/OpenReader/privacy.html');
});

it('opens it and says nothing when the phone does', async () => {
  openURL.mockResolvedValue(undefined);
  openPrivacyPolicy();
  await vi.waitFor(() => expect(openURL).toHaveBeenCalledWith(PRIVACY_POLICY));
  await Promise.resolve();
  expect(alert).not.toHaveBeenCalled();
});

it('gives the address in an alert when the phone refuses to open it', async () => {
  openURL.mockRejectedValue(new Error('refused'));
  openPrivacyPolicy();
  await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('Could not open the privacy policy', PRIVACY_POLICY));
});
