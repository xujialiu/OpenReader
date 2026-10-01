/**
 * **Voice**: the Voices the owner can actually use, and nothing else (ADR 0020).
 *
 * A service that has not been given its key or its address cannot say what Voices
 * it has, so it is not listed at all — and if none has been set up, the list is
 * empty apart from a line pointing at Settings.
 *
 * **The alternative was to list everything and grey out what is not ready**, so
 * that someone could see other services exist. It was turned down: this app is for
 * one owner, who knows what they have signed up for, and a list mostly full of
 * things that cannot be picked is a worse list than a short one that works. The
 * cost is that nothing here advertises a service that has not been configured —
 * discovering what is supported happens in Settings. That is the owner's decision
 * and the design file carries the argument; it is not to be re-litigated by adding
 * the greyed-out rows back.
 *
 * ## Three levels, and the middle one is always there
 *
 * Provider, then locale, then Voice. Half the Providers have no locale — OpenAI,
 * any OpenAI-compatible server and Kokoro report `multilingual` for every Voice —
 * and for those the middle level is **one entry reading "multilingual"** rather
 * than being skipped, so that choosing a Voice is the same act whoever is speaking
 * (`voices.ts` is the grouping, and the argument).
 *
 * Nothing is fetched until a Provider is tapped. A Voice list is a request against
 * the owner's own account (philosophy rule 4), and it is cached for as long as the
 * app is open because Speechify paginates and Fish merges up to three sources.
 *
 * **What is chosen here is this book's Voice** (ADR 0010). It is written into the
 * Library entry of the Document that is open, and it becomes the global default as
 * well — so the next Document opened for the first time inherits it and a book
 * already under way keeps what it was started with. The sheet says so in as many
 * words, because a picker that quietly did two things is one the owner cannot
 * predict.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import type { ProviderId } from '../core/providers/types';

import { INK } from './controls';
import { Drawer, DrawerFooter, DrawerMenuRow, DrawerRow, DrawerRowText } from './drawer';
import { Icon } from './icon';
import { PROVIDER_LABELS, type AppSettings } from './settings';
import type { VoiceLists } from './use-voices';
import { levelOfVoice, voiceLevels } from './voices';
import { LoadingSpinner } from './loading-spinner';

export interface VoiceSheetProps {
  visible: boolean;
  onClose(): void;
  settings: AppSettings;
  lists: VoiceLists;
  pending?: { provider: ProviderId; voice: string } | null;
  error?: string | null;
  /** Read with this Provider and this Voice. Both at once: a Voice belongs to exactly one Provider (CONTEXT.md). */
  onChoose(provider: ProviderId, voice: string): void;
}

/**
 * On the phone's own sheet since #117 (ADR 0066). The picker inside it is
 * **mounted when it opens** (the sheet mounts its content on presenting it),
 * which is how it starts on the Provider in use without an effect that resets
 * two states as the sheet appears. A picker that kept its state between opens
 * would show whatever was last looked at rather than what is reading.
 */
export function VoiceSheet({ visible, onClose, ...props }: VoiceSheetProps) {
  return (
    <Drawer visible={visible} title="Voice" onClose={onClose}>
      <VoicePicker {...props} />
    </Drawer>
  );
}

/**
 * Two menu rows, Provider and Language, each the system's short menu (ADR
 * 0035), above the Voices as the drawer's plain list; what is said about them
 * is the list's footer (#117). The rows of chips they replace were a row of
 * Providers that wrapped and a row of locales that scrolled sideways.
 */
function VoicePicker({ settings, lists, onChoose, pending, error }: Omit<VoiceSheetProps, 'visible' | 'onClose'>) {
  /** Which Provider's Voices are being looked at. The one in use, until another is chosen. */
  const [looking, setLooking] = useState<ProviderId>(lists.enabled?.includes(settings.provider) ? settings.provider : lists.enabled?.[0] ?? settings.provider);
  /** Which locale is open. Null means none has been chosen yet, and the Voice in use decides. */
  const [locale, setLocale] = useState<string | null>(null);

  const voices = lists.enabled?.includes(looking) ? lists.voicesOf(looking) : null;
  const levels = useMemo(() => voiceLevels(voices ?? []), [voices]);
  const inUse = looking === settings.provider ? levelOfVoice(levels, settings.voice) : null;
  /**
   * The level shown: the one chosen, or else the one the Voice in use is in.
   * The level in use can be the fortieth of them — Fish Audio publishes voices
   * in forty-odd locales — so the Language row opens on it rather than on
   * "multilingual". Same reason the contents list opens at the chapter being
   * read: a picker that opens somewhere else does not show you what you have
   * chosen.
   */
  const open = locale ?? inUse ?? levels[0]?.locale ?? null;
  const shown = useMemo(() => levels.find((level) => level.locale === open)?.voices ?? [], [levels, open]);

  /**
   * Opening the sheet asks the Provider in use for its Voices, if its list is not
   * already held.
   *
   * Usually it is: every enabled Provider is asked when the app starts (#24),
   * because waiting on the first tap of every fresh start was the price of the
   * old rule, that nothing was fetched before the owner opened this list. What
   * is left here is the Provider whose start-up listing failed, or is still out
   * — `ask` joins that request rather than sending another — and a Provider
   * enabled since the start.
   */
  const askRef = useRef(lists);
  useEffect(() => {
    askRef.current = lists;
  }, [lists]);
  useEffect(() => {
    if (askRef.current.enabled?.includes(looking) && !askRef.current.voicesOf(looking)) askRef.current.ask(looking);
    // On mount, which is on opening, and on choosing another Provider. Through a
    // ref because `lists` is a fresh object every render and depending on it
    // would ask again on every one of them.
  }, [looking]);

  const enabled = lists.enabled;

  return (
    <>
      {enabled.length > 0 ? (
        <>
          {/*
           * **Whose Voice this is**, which design 0010 names as the price of a Voice
           * per Document: choosing here is a choice for the book in front of the
           * owner; it becomes the default as well, which is what the next book they
           * open for the first time inherits.
           */}
          <DrawerMenuRow
            label="Provider"
            choices={enabled.map((provider) => ({ value: provider, label: PROVIDER_LABELS[provider] }))}
            chosen={looking}
            onChoose={(provider) => {
              setLooking(provider);
              setLocale(null);
              // Choosing the Provider already shown asks again when its list failed.
              if (!lists.voicesOf(provider)) lists.ask(provider);
            }}
          />
          {levels.length > 0 && open !== null ? (
            <DrawerMenuRow
              label="Language"
              choices={levels.map((level) => ({ value: level.locale, label: level.label }))}
              chosen={open}
              onChoose={(next) => setLocale(next)}
            />
          ) : null}
          <FlatList
            // A Provider or a Language chosen is a new list, which starts at its top.
            key={`${looking} ${open ?? ''}`}
            data={shown}
            style={styles.voices}
            keyExtractor={(voice) => voice.id}
            renderItem={({ item: voice }) => {
              const chosen = looking === settings.provider && voice.id === settings.voice;
              const loading = looking === pending?.provider && voice.id === pending.voice;
              return (
                <DrawerRow onPress={() => onChoose(looking, voice.id)} accessibilityState={{ selected: chosen, busy: loading }}>
                  <View style={styles.voice}>
                    <DrawerRowText style={[styles.voiceLabel, chosen && styles.chosen]}>{voice.label}</DrawerRowText>
                    {loading ? <LoadingSpinner /> : chosen ? <Icon name="check" color={INK.text} size={20} /> : null}
                  </View>
                </DrawerRow>
              );
            }}
          />
          {lists.asking(looking) ? <DrawerFooter>Asking {PROVIDER_LABELS[looking]} for its Voices…</DrawerFooter> : null}
        </>
      ) : (
        <DrawerFooter attention>Enable a provider in Settings to choose a voice.</DrawerFooter>
      )}

      {lists.note ? <DrawerFooter attention>{lists.note}</DrawerFooter> : null}
      {error ? <DrawerFooter attention>{error}</DrawerFooter> : null}
    </>
  );
}

const styles = StyleSheet.create({
  // As tall as its rows, and no taller than the drawer leaves it, so the
  // footer sits under the last row of a short list.
  voices: { flexGrow: 0, flexShrink: 1 },
  voice: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  voiceLabel: { flex: 1 },
  chosen: { color: INK.reading },
});
