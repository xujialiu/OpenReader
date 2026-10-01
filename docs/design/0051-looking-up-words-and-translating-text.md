# Looking up words and translating text

## What has been chosen

The owner wants to understand unfamiliar words and passages without leaving the document. Long-press lookup and translation will have a switch, initially off. The app remembers the owner's choice.

The owner has chosen Youdao for Chinese–English and English–Chinese word lookup and Free Dictionary API for English definitions. Text translation defaults to Youdao, with Google as another option requiring no credentials and Microsoft Translator as an optional service the owner configures.

The owner chooses the lookup language direction in settings, initially English–Chinese. Language direction is a saved setting rather than a choice repeated with every result. Text translation detects the source and uses a fixed target language chosen by the owner: Simplified Chinese or English in the first version, initially Simplified Chinese. Selecting Chinese text must not silently change the target to English.

Importing dictionaries is excluded from the first version. Lookup uses online services, so there is no local-dictionary miss or local-to-online fallback to configure. This postpones the owner's original import request and means lookup will need a connection.

## Selecting text and seeing the result

With the feature enabled, a long press selects a word and opens its meanings immediately, without a second menu action. It does not change the reading position. The owner can drag the selection to include part of a sentence, a whole sentence or several sentences; translation is requested after the drag ends, not repeatedly while the selection is moving.

The initial word selection opens dictionary meanings; expanding the selection defaults to translation. The owner can switch between dictionary meanings and translation in the result drawer, so a phrase such as “give up” can still be looked up as a dictionary entry. This is a choice of the kind of result, separate from the saved language direction.

Results appear in a drawer rising from the bottom of the screen, initially leaving part of the document visible. The owner can expand it for longer definitions or translations. Word lookup and text translation share that surface. A small floating bubble beside the word was turned down in favor of space for longer results.

_Revised in [decision 0066](0066-every-drawer-rises-to-the-drawer-height.md): the result drawer is the phone's own, like every other drawer, and rests at the owner's Drawer Height or nearly full rather than at its own two heights._

The drawer follows the phone's own look wherever possible and uses the app's existing light and dark colors. It earns its space with definitions and translations, rather than explanatory captions or repeated notices. This is the same native-first rule as the rest of the app, not a separate visual style for translation.

Dictionary results show the word, phonetics, part of speech, meanings and examples where the service supplies them. A pronunciation playback control is retained when pronunciation audio is available. Translation results show the translated text. Results retain their source, copying and the necessary switching controls. Favorites and lookup history are excluded from the first version.

## Settings

A dedicated “Word Lookup and Translation” page opens from Settings. It contains the feature switch, lookup direction, translation target, translation service and the option to pause speech during lookup. Microsoft credential fields appear only when Microsoft is selected. These choices are remembered on the current device and apply to every document; cross-device synchronization is outside this first version.

## Speech during lookup

Whether lookup pauses ongoing speech is an option in settings, initially on. When it pauses speech, closing the result does not resume it automatically; the owner resumes explicitly. If the owner turns this option off, speech continues but the page stops following it while the result is open, keeping the selected text in view. Closing the result restores the preceding following state: a page that was following ongoing speech returns to its current position, while a page that was being browsed stays where it was.

Playing a pronunciation temporarily pauses document speech if it is running at that moment, even when the automatic lookup-pause option is off. When the pronunciation finishes, that interrupted speech resumes. Speech that was already paused before the pronunciation remains paused: this includes speech paused by opening lookup. This temporary interruption is distinct from pausing to read a definition.

Tapping pronunciation again restarts it; closing the result or selecting another word stops it. British and American pronunciations have separate controls when supplied. Only dictionary-supplied audio is played; the app does not ask a speech provider to generate missing pronunciation.

## When a service fails

A failed request shows the failure and a retry action in the result drawer. The app does not automatically try a different service. For text translation, the owner can explicitly switch to Microsoft after configuring it. Automatic fallback was turned down because one action would otherwise send text to additional services, potentially consuming a paid allowance without a deliberate choice.

## Why these services

The default services let the owner begin without signing up for another account. English definitions have a separate source because explaining an English word in English is different from translating it into another language. Microsoft offers an alternative for an owner willing to set up an account and credentials.

Requiring credentials before the first lookup would add setup to a small reading action. Offering many services immediately would add choices before the owner knows whether the basic interaction feels right. The selected services keep those initial choices small.

## What it costs

Online lookup needs a connection and sends the selected text to the chosen service. Youdao's free access depends on how its website behaves, so changes there can interrupt lookup or translation. The shortlist has been checked against another reader's integration, but has not yet been tested live in this app.

## Design confirmation

The owner confirmed the complete design and authorized implementation. Live service availability and selection behavior on the device still need verification during implementation; the service shortlist is not a claim that those checks have passed.
