import { APP_VERSION } from '../../app-version';
import { shownVersion } from '../debug/mode';
import { ActionRow, DetailRow, Footnote, LinkRow, NavigationRow, SettingsGroup, SettingsPage } from './controls';
import { AUTHOR, EMAIL, emailAuthor, openPrivacyPolicy, openRepository, REPOSITORY_NAME } from './own-site';
import { PURCHASE, purchaseValue } from './purchase';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { usePurchases } from './use-purchases';

/**
 * Why the Author's card asks for a star. It is the one standing line
 * `MEMORY/interface.md` would otherwise remove: the rows above it say who made
 * the app and where it lives, and only this says why a star is worth giving
 * (design 0072).
 */
export const STAR_LINE = 'If you like OpenReader, give it a ⭐ on GitHub — it helps others find it.';

/**
 * The front page of Settings: the card of settings, then the Author's card
 * (#129), then a card holding the privacy policy (#110) and the
 * acknowledgements (#111), with the version under it (design 0041). The version
 * ends in `-debug` in a build with Debug Mode (design 0054).
 *
 * Each row says on its right only what is true behind it now, a count or a
 * state. General says nothing: the `Theme` it used to carry described what was
 * behind the row, and stopped being the whole of it once General also held the
 * brackets.
 *
 * The Author's card is drawn as the phone's own About page is, a name on the
 * left and what it is on the right (design 0072). The name is a fact; the email
 * and the repository are addresses a tap opens in another app, so theirs are
 * tinted. It sits on this page rather than a page of its own, so that it is
 * seen without being looked for.
 *
 * Neither of the last card's rows is a setting. The privacy policy is a link,
 * and its tinted words say so, as the phone's own link rows do. The
 * acknowledgements are a page in the app, so theirs is a row like any other.
 * Both sit in a card of their own at the foot of the page, where the phone puts
 * its own legal rows.
 *
 * **Purchase** (#148, ADR 0075) closes the first card in a build with the
 * lock, in the owner's wording and look of 2026-10-09: the label in the tint,
 * as Privacy Policy's is, because behind it is something to do; on the right,
 * in the quiet ink, the days left in the Trial or that it ended, and nothing
 * before the Trial; and the chevron. It opens the Purchase page. Once the
 * Unlock is owned there is nothing to do, so the row is a plain one reading
 * Unlocked that opens nothing. A build without the lock has no such row.
 */
export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const { settings } = useShell();
  const { access, now } = usePurchases();
  const version = shownVersion(APP_VERSION);
  const purchase = purchaseValue(access, now);
  return (
    <SettingsPage>
      <SettingsGroup>
        <NavigationRow label="General" onPress={() => navigation.navigate('General')} />
        <NavigationRow label="Word Lookup & Translation" onPress={() => navigation.navigate('Translation')} />
        <NavigationRow label="Providers" value={`${settings.enabledProviders.length} enabled`}
          onPress={() => navigation.navigate('Providers')} />
        <NavigationRow label="Sync" value={settings.sync.enabled ? 'On' : 'Off'} onPress={() => navigation.navigate('Sync')} />
        {access && access.kind === 'unlocked' ? <DetailRow label={PURCHASE} value={purchase!} /> : null}
        {access && access.kind !== 'unlocked' && access.kind !== 'off'
          ? <NavigationRow label={PURCHASE} value={purchase} tint onPress={() => navigation.navigate('Purchase')} /> : null}
      </SettingsGroup>
      <SettingsGroup footer={<Footnote>{STAR_LINE}</Footnote>}>
        <DetailRow label="Author" value={AUTHOR} />
        <LinkRow label="Email" value={EMAIL} onPress={emailAuthor} />
        <LinkRow label="GitHub" value={REPOSITORY_NAME} onPress={openRepository} />
      </SettingsGroup>
      <SettingsGroup footer={<Footnote accessibilityLabel={`Version ${version}`}>{version}</Footnote>}>
        <ActionRow label="Privacy Policy" onPress={openPrivacyPolicy} />
        <NavigationRow label="Acknowledgements" onPress={() => navigation.navigate('Acknowledgements')} />
      </SettingsGroup>
    </SettingsPage>
  );
}
