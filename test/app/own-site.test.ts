import { beforeEach, expect, it, vi } from 'vitest';

import { AUTHOR, EMAIL, emailAuthor, openPrivacyPolicy, openRepository, PRIVACY_POLICY, REPOSITORY, REPOSITORY_NAME, SITE } from '../../src/app/own-site';

/**
 * #110: the privacy policy opens in Safari, at the address the repository's
 * Pages workflow publishes `site/privacy.html` to. If the phone refuses to open
 * it, an alert gives the address so it can be typed instead.
 *
 * #129: the repository opens the same way, and the Email row starts an email to
 * the Author. A phone with no mail app refuses that, and the alert gives the
 * address instead.
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

it('names the Author, his email and the repository as the support page and the README do (#129)', () => {
  expect(AUTHOR).toBe('Xujia Liu');
  expect(EMAIL).toBe('xujialiuphd@gmail.com');
  expect(REPOSITORY).toBe('https://github.com/xujialiu/OpenReader');
  expect(REPOSITORY).toBe(`https://github.com/${REPOSITORY_NAME}`);
});

it('opens the repository, and gives its address when the phone refuses (#129)', async () => {
  openURL.mockResolvedValue(undefined);
  openRepository();
  await vi.waitFor(() => expect(openURL).toHaveBeenCalledWith(REPOSITORY));
  await Promise.resolve();
  expect(alert).not.toHaveBeenCalled();
  openURL.mockRejectedValue(new Error('refused'));
  openRepository();
  await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('Could not open GitHub', REPOSITORY));
});

it('starts an email to the Author, and gives the address when there is no mail app to start it in (#129)', async () => {
  openURL.mockResolvedValue(undefined);
  emailAuthor();
  await vi.waitFor(() => expect(openURL).toHaveBeenCalledWith('mailto:xujialiuphd@gmail.com'));
  await Promise.resolve();
  expect(alert).not.toHaveBeenCalled();
  openURL.mockRejectedValue(new Error('refused'));
  emailAuthor();
  await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('Could not open Mail', EMAIL));
});
