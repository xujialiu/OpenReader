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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProviderId } from '../core/providers/types';

import { INK, Note } from './controls';
import { Icon } from './icon';
import { PROVIDER_LABELS, type AppSettings } from './settings';
import type { VoiceLists } from './use-voices';
import { levelOfVoice, voiceLevels } from './voices';
import { Sheet } from './sheet';
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
 * The sheet is the modal; the picker inside it is **mounted when it opens**, which
 * is how it starts on the Provider in use without an effect that resets two states
 * as the sheet appears. A picker that kept its state between opens would show
 * whatever was last looked at rather than what is reading.
 */
export function VoiceSheet({ visible, onClose, ...props }: VoiceSheetProps) {
  return (
    <Sheet visible={visible} title="Voice" onClose={onClose}>
      {visible ? <VoicePicker {...props} /> : null}
    </Sheet>
  );
}

function VoicePicker({ settings, lists, onChoose, pending, error }: Omit<VoiceSheetProps, 'visible' | 'onClose'>) {
  /** Which Provider's Voices are being looked at. The one in use, until another is tapped. */
  const [looking, setLooking] = useState<ProviderId>(lists.enabled?.includes(settings.provider) ? settings.provider : lists.enabled?.[0] ?? settings.provider);
  /** Which locale is open. Null means none has been chosen yet, and the Voice in use decides. */
  const [locale, setLocale] = useState<string | null>(null);

  const voices = lists.enabled?.includes(looking) ? lists.voicesOf(looking) : null;
  const levels = useMemo(() => voiceLevels(voices ?? []), [voices]);
  const inUse = looking === settings.provider ? levelOfVoice(levels, settings.voice) : null;
  const open = locale ?? inUse ?? levels[0]?.locale ?? null;

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
    // On mount, which is on opening. Through a ref because `lists` is a fresh object
    // every render and depending on it would ask again on every one of them.
  }, [looking]);

  /**
   * The locale row, scrolled to the level in use as it lays out.
   *
   * Only while the owner has not chosen one themselves: scrolling the row back
   * under a finger that has just tapped a chip would be the picker arguing with
   * them.
   */
  const localeRow = useRef<ScrollView | null>(null);
  const scrollToChosen = useCallback(
    (x: number) => {
      if (locale !== null) return;
      localeRow.current?.scrollTo({ x: Math.max(0, x - 16), animated: false });
    },
    [locale],
  );

  const enabled = lists.enabled;

  return (
    <>
      <View style={{ gap: 10 }}>

        {enabled.length === 0 ? (
          <Note attention>
            Enable a provider in Settings to choose a voice.
          </Note>
        ) : (
          <>
            {/*
             * **Whose Voice this is**, which design 0010 names as the price of a Voice
             * per Document: a picker that did not say would leave the owner unable to
             * tell which of the two things they had just done. Choosing here is a
             * choice for the book in front of them; it becomes the default as well,
             * which is what the next book they open for the first time inherits.
             */}
            <View style={styles.providers}>
              {enabled.map((provider) => (
                <Chip
                  key={provider}
                  label={PROVIDER_LABELS[provider]}
                  chosen={provider === looking}
                  onPress={() => {
                    setLooking(provider);
                    setLocale(null);
                    if (!lists.voicesOf(provider)) lists.ask(provider);
                  }}
                />
              ))}
            </View>

            {lists.asking(looking) ? <Note>Asking {PROVIDER_LABELS[looking]} for its Voices…</Note> : null}

            {levels.length > 0 ? (
              <ScrollView
                horizontal
                ref={localeRow}
                style={styles.locales}
                contentContainerStyle={styles.localesBody}
                showsHorizontalScrollIndicator={false}
              >
                {levels.map((level) => (
                  <Chip
                    key={level.locale}
                    label={level.label}
                    chosen={level.locale === open}
                    onPress={() => setLocale(level.locale)}
                    /**
                     * The level in use can be the fortieth of them — Fish Audio
                     * publishes voices in forty-odd locales — so the row is scrolled
                     * to it rather than left at "multilingual". Same reason the
                     * contents list opens at the chapter being read: a picker that
                     * opens somewhere else does not show you what you have chosen.
                     * The x is measured because a chip's width is its label's.
                     */
                    onMeasured={level.locale === open ? scrollToChosen : undefined}
                  />
                ))}
              </ScrollView>
            ) : null}

            <ScrollView style={styles.voices}>
              {levels
                .filter((level) => level.locale === open)
                .flatMap((level) => level.voices)
                .map((voice) => {
                  const chosen = looking === settings.provider && voice.id === settings.voice;
                  const loading = looking === pending?.provider && voice.id === pending.voice;
                  return (
                    <Pressable
                      key={voice.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: chosen, busy: loading }}
                      onPress={() => {
                        onChoose(looking, voice.id);
                      }}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                    >
                      <Text style={[styles.rowLabel, chosen && styles.rowLabelChosen]} numberOfLines={1}>
                        {voice.label}
                      </Text>
                      {loading ? <LoadingSpinner /> : chosen ? <Icon name="check" color={INK.text} size={20} /> : null}
                    </Pressable>
                  );
                })}
            </ScrollView>
          </>
        )}

        {lists.note ? <Note attention>{lists.note}</Note> : null}
        {error ? <Note attention>{error}</Note> : null}
      </View>
    </>
  );
}

function Chip({
  label,
  chosen,
  onPress,
  onMeasured,
}: {
  label: string;
  chosen: boolean;
  onPress(): void;
  /** Where this chip starts, once it has been laid out. Only the chosen one is asked. */
  onMeasured?(x: number): void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      onLayout={onMeasured ? (event) => onMeasured(event.nativeEvent.layout.x) : undefined}
      style={({ pressed }) => [styles.chip, chosen && styles.chipChosen, pressed && styles.pressed]}
    >
      <Text style={[styles.chipLabel, chosen && styles.chipLabelChosen]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  behind: { flex: 1 },
  chip: {
    backgroundColor: INK.page,
    borderColor: INK.line,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipChosen: { backgroundColor: INK.text, borderColor: INK.text },
  chipLabel: { color: INK.text, fontSize: 14 },
  chipLabelChosen: { color: INK.page, fontWeight: '600' },
  done: { alignItems: 'center', backgroundColor: INK.text, borderRadius: 10, marginHorizontal: 16, paddingVertical: 12 },
  doneLabel: { color: INK.page, fontSize: 15, fontWeight: '600' },
  grip: { alignSelf: 'center', backgroundColor: INK.line, borderRadius: 3, height: 5, marginBottom: 6, width: 40 },
  locales: { flexGrow: 0 },
  localesBody: { gap: 8, paddingHorizontal: 16 },
  pressed: { opacity: 0.65 },
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderBottomColor: INK.line, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12 },
  rowLabel: { flex: 1, color: INK.text, fontSize: 15, fontWeight: '600' },
  rowLabelChosen: { color: INK.reading },
  sheet: {
    backgroundColor: INK.panel,
    borderTopColor: INK.line,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingBottom: 32,
    paddingTop: 10,
  },
  title: { color: INK.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16 },
  voices: { height: 260 },
});
