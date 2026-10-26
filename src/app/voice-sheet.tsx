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
 * ## Three levels, three menus, and the middle one is always there
 *
 * Provider, then Language, then Voice, each a row that opens the system's menu
 * (#232). Two Providers have no locale — OpenAI and an OpenAI Compatible server
 * report `mul` for every Voice — and for those the middle level is **one entry
 * reading "Multilingual"** rather than being skipped, so that choosing a Voice
 * is the same act whoever is speaking (`voices.ts` is the grouping, the names
 * and the order, and the argument for each).
 *
 * Every Enabled Provider is asked for its Voices when the app starts (#24, ADR
 * 0033), not when it is tapped here. A Voice list is a request against the
 * owner's own account (philosophy rule 4), and it is held for as long as the app
 * is open because Speechify paginates and Fish merges up to three sources.
 *
 * **What is chosen here is the Voice** (ADR 0089): the one every Document is
 * read in, this one and every other, from the moment it is chosen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProviderId } from '../core/providers/types';

import { Drawer, DrawerFooter, DrawerMenuRow } from './drawer';
import { PROVIDER_LABELS, type AppSettings } from './settings';
import type { VoiceLists } from './use-voices';
import { levelOfVoice, voiceLevels } from './voices';

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
 * Three menu rows, Provider, Language and Voice, each the system's menu (ADR
 * 0035); what is said about them is the footer under them (#117). Provider and
 * Language replaced a row of Providers that wrapped and a row of locales that
 * scrolled sideways (#117); Voice replaced a plain list of the Language's Voices
 * under the two, so the one choice is made one way at every level (#232).
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
   * "Multilingual". Same reason the contents list opens at the chapter being
   * read: a picker that opens somewhere else does not show you what you have
   * chosen.
   */
  const open = locale ?? inUse ?? levels[0]?.locale ?? null;
  const shown = useMemo(() => levels.find((level) => level.locale === open)?.voices ?? [], [levels, open]);
  /** A Voice of this Provider and Language is being got ready (`pending`), so the row shows it with the spinner. */
  const waiting = !!pending && pending.provider === looking && shown.some((voice) => voice.id === pending.voice);
  const voiceChoices = useMemo(() => shown.map((voice) => ({ value: voice.id, label: voice.label })), [shown]);

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
  /** What went wrong with the listing of the Provider looked at, and only that one (#205). */
  const note = lists.noteOf(looking);

  return (
    <>
      {enabled.length > 0 ? (
        <>
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
          {shown.length > 0 ? (
            /*
             * The Voice in use, checked, when it is in this Language; the Voice
             * being got ready, with the spinner, while it is. On another
             * Provider or Language the row names nothing and nothing changes
             * until a Voice is chosen: picking one for the owner would change
             * the Voice by looking (#232).
             */
            <DrawerMenuRow
              label="Voice"
              choices={voiceChoices}
              chosen={waiting && pending ? pending.voice : looking === settings.provider ? settings.voice : ''}
              busy={waiting}
              onChoose={(voice) => onChoose(looking, voice)}
            />
          ) : null}
          {lists.asking(looking) ? <DrawerFooter>Asking {PROVIDER_LABELS[looking]} for its Voices…</DrawerFooter> : null}
        </>
      ) : (
        <DrawerFooter attention>Enable a provider in Settings to choose a voice.</DrawerFooter>
      )}

      {note ? <DrawerFooter attention>{note}</DrawerFooter> : null}
      {error ? <DrawerFooter attention>{error}</DrawerFooter> : null}
    </>
  );
}
