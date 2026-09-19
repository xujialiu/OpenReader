/**
 * What it means when the Keychain will not answer, kept as a value.
 *
 * PHILOSOPHY rule 1 is honest signals, and the signal being protected here is a
 * narrow one. `getItemAsync` resolves `null` when there is no entry for a key
 * and **rejects** when something went wrong; a wrapper that caught the
 * rejection and returned `null` too would collapse "the owner has not entered a
 * key" into "the key is there and could not be read". The second is the one
 * that happens at 2 a.m. with the screen locked, in the background, where
 * nobody is watching a console — the class of failure notes/NOTES.md item 4
 * says is invisible until a 60–90 minute session on a real device.
 *
 * So a refusal is a value carrying what the Keychain said, and a caller has to
 * look at it to get past it.
 */

/** The sentence `expo-secure-store` reports for iOS's `errSecInteractionNotAllowed`. */
const INTERACTION_NOT_ALLOWED = 'User interaction is not allowed.';

export type KeychainRefusal = {
  /**
   * What to show the owner, or log. `expo-secure-store` rejects with the reason
   * its iOS module builds from the OSStatus the Keychain returned — "No
   * keychain is available. You may need to restart your computer.", "I/O
   * error.", "User interaction is not allowed." — which is more than this
   * module could say for itself, so it is passed along rather than replaced.
   */
  readonly message: string;

  /**
   * Whatever was thrown, unaltered. When a refusal turns out to be a bug of
   * ours rather than a locked device, a stack is worth more than a sentence.
   */
  readonly cause: unknown;

  /**
   * Set when the reported failure is iOS's `errSecInteractionNotAllowed`: the
   * Keychain holds the entry but its accessibility does not permit a read in
   * the device's current state. That is exactly the locked-screen failure
   * `store.ts` chooses `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` to avoid, so
   * seeing it means the entry on this device was created at a stricter
   * accessibility than the one asked for now — recoverable, but not by writing
   * the key again. `saveProviderKey` explains why, and is the fix.
   *
   * It is recognised from the message, because the message is all the native
   * module hands JavaScript. That is sound rather than fragile for this one
   * status: `KeyChainException` in
   * node_modules/expo-secure-store/ios/SecureStoreExceptions.swift matches
   * `errSecInteractionNotAllowed` explicitly and returns a literal, so the
   * string is the package's own and not a localised one from
   * `SecCopyErrorMessageString`. It is still a string in someone else's source,
   * which is why this is one field on a refusal and not an outcome of its own.
   */
  readonly interactionNotAllowed: boolean;
};

/**
 * Describe whatever `expo-secure-store` threw.
 *
 * Takes `unknown` and never throws. It runs inside every `catch` block in
 * `store.ts`, and a `catch` block that can fail is a failure with no report at
 * all.
 */
export function keychainRefusal(cause: unknown): KeychainRefusal {
  const message = reportedMessage(cause);
  return {
    message,
    cause,
    // `includes`, not equality: ExpoModulesCore wraps a module's reason in its
    // own sentence naming the function that was called.
    interactionNotAllowed: message.includes(INTERACTION_NOT_ALLOWED),
  };
}

function reportedMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;
  if (typeof cause === 'string' && cause !== '') return cause;
  // Nothing in expo-secure-store rejects with anything but an Error, so arriving
  // here is itself information. Say what turned up instead of substituting a
  // sentence of our own that would read like a diagnosis.
  return `The Keychain refused the operation, reporting ${printable(cause)}.`;
}

function printable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A circular object, a BigInt, or a `toString` that throws.
    return `an unprintable ${typeof value}`;
  }
}
