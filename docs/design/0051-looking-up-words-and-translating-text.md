# Looking up words and translating text

## What has been chosen

The owner wants to understand unfamiliar words and passages without leaving the document. Long-press lookup and translation have a switch, initially on. The app remembers the owner's choice.

The owner has chosen Youdao for Chinese–English and English–Chinese word lookup and Free Dictionary API for English definitions. Text translation defaults to Youdao, with Google as another option requiring no credentials and Microsoft Translator as an optional service the owner configures.

The owner chooses the lookup language direction in settings, initially English–English. Language direction is a saved setting rather than a choice repeated with every result. Text translation detects the source and uses a fixed target language chosen by the owner: Simplified Chinese or English in the first version, initially English. Selecting Chinese text must not silently change the target to English. Selecting English text when the target is English likewise leaves the target and the choice of translation unchanged: it still asks the selected Translation Service, rather than switching to Chinese or to dictionary meanings. A translation is not promised to rewrite or explain an English selection merely because English is its target; English definitions belong to Word Lookup.

Importing dictionaries is excluded from the first version. Lookup uses online services, so there is no local-dictionary miss or local-to-online fallback to configure. This postpones the owner's original import request and means lookup will need a connection.

## Selecting text and seeing the result

With the feature enabled, a long press selects a word and opens its result immediately, without a second menu action. It does not change the reading position. The owner can drag the selection to include part of a sentence, a whole sentence or several sentences; translation is requested after the drag ends, not repeatedly while the selection is moving.

Opening a word lookup again uses the owner's Preferred Lookup Mode: the last explicit choice of dictionary meanings or translation in the result drawer. Before any explicit choice, a word opens dictionary meanings. Both choices are remembered on the current device across documents and app restarts. Only an explicit choice of Dictionary or Translation changes this preference. This preference is a choice of the kind of result, separate from the saved language direction. Always reopening dictionary meanings was turned down because it would make an owner who prefers translation choose it again for every word.

Selecting multiple words defaults to translation for that selection only and never changes the Preferred Lookup Mode. Shrinking it back to one word restores the Preferred Lookup Mode. Long-pressing another word is a new selection even while the result drawer remains open; it uses the Preferred Lookup Mode, rather than being mistaken for an expansion of the previous selection. Remembering an automatic switch was turned down because expanding one passage is not a request to change future word lookups; leaving that temporary translation in place after shrinking or selecting a new word would make an unrelated word inherit it.

The automatic choice follows the selected text's word boundaries, not whether the owner has dragged the selection or changed any characters. Surrounding punctuation, a contraction such as “don't”, and a hyphenated word such as “well-known” still count as one word; “give up” counts as multiple words. A Chinese word such as “学习” does not become multiple words merely because it contains more than one character. Adjusting the selection within one word does not itself call for translation.

An explicit mode choice takes precedence for the current selection while its text stays the same. The owner can switch “give up” to Dictionary and keep its dictionary result while lifting their finger, waiting for the result or retrying. Changing the selected text applies the single-word or multiword rule again: expanding it to “give up hope” chooses Translation without overwriting the Preferred Lookup Mode. Immediately switching back after an explicit choice was turned down because it would prevent the owner from looking up a phrase as a dictionary entry.

Results appear in a drawer rising from the bottom of the screen, initially leaving part of the document visible. The owner can expand it for longer definitions or translations. Word lookup and text translation share that surface. A small floating bubble beside the word was turned down in favor of space for longer results.

_Revised in [decision 0066](0066-every-drawer-rises-to-the-drawer-height.md): the result drawer is the phone's own, like every other drawer, and rests at the owner's Drawer Height or nearly full rather than at its own two heights._

The drawer follows the phone's own look wherever possible and uses the app's existing light and dark colors. It earns its space with definitions and translations, rather than explanatory captions or repeated notices. This is the same native-first rule as the rest of the app, not a separate visual style for translation.

Dictionary results show the word, phonetics, part of speech, meanings and examples where the service supplies them. A pronunciation playback control is retained when pronunciation audio is available. Translation results show the translated text. Results retain their source, copying and the necessary switching controls. Favorites and lookup history are excluded from the first version.

## Settings

A dedicated “Dictionary & Translation” page opens from Settings, under the same name. It contains the feature switch, lookup direction, translation target, translation service and the option to pause speech during lookup. Microsoft credential fields appear only when Microsoft is selected. These choices and the Preferred Lookup Mode are remembered on the current device and apply to every document; cross-device synchronization is outside this first version.

The initial values apply only when there is no saved choice for the setting. Existing switch states, lookup directions and translation targets are kept, rather than replacing choices the owner has already made when the app is updated.

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

Online lookup needs a connection and sends the selected text to the chosen service. Youdao's free access depends on how its website behaves, so changes there can interrupt lookup or translation. A service being offered does not guarantee it is currently reachable, and a failure never silently sends the selection elsewhere.

## Design confirmation

The owner confirmed the complete refined behavior and authorized implementation, including correcting a new word being mistaken for an expansion while the result drawer remains open. The service shortlist is not a claim that current live availability has been verified.
