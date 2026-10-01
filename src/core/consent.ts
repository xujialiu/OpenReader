/**
 * Asking before text leaves the phone (#109, ADR 0064).
 *
 * Guideline 5.1.2(i) requires the person's permission before their data goes to
 * a third party, and a rejection in this category said a privacy policy alone
 * does not count (ADR 0017). So nothing a Document holds, and nothing selected
 * for a lookup, is sent to a service until the person has said yes to that
 * service, once. This file is the rule; how the question is put, and where the
 * yes is kept, are handed in (`src/app/consent.ts`).
 *
 * **One question per recipient, however many requests are waiting.** A Reading
 * asks for two sentences at once and a download for several, and each would
 * otherwise put its own alert on the screen. The first caller asks, and every
 * caller for that recipient waits on the same answer.
 *
 * **A no is final until the person asks for something again.** A refusal sends
 * nothing and keeps nothing, so the question comes back, but not by itself:
 * after a no, the read-ahead goes on asking for the sentences behind the refused
 * one, and each of those would otherwise raise the alert again the moment it was
 * dismissed. So a refusal holds, and `again` lifts it, called where the person
 * asks for text to be sent: Play, a Voice chosen, a download started or resumed,
 * a lookup.
 *
 * A yes is kept by `keep` and read back by `kept`, so it lasts across launches,
 * and it is read back on every call, so the gate holds no copy that could
 * disagree with what is kept.
 */

/** Whoever would receive the text, as far as the gate cares: what a yes is kept under. */
export interface ConsentRecipient {
  readonly key: string;
}

export interface ConsentDeps<R extends ConsentRecipient> {
  /** Whether a yes for this key is kept. */
  kept(key: string): boolean;
  /** Keep a yes for this key. */
  keep(key: string): void;
  /** Put the question to the person. True is a yes; anything else, a rejection included, is a no. */
  ask(recipient: R): Promise<boolean>;
}

export interface ConsentGate<R extends ConsentRecipient> {
  /**
   * Whether text may go to this recipient: true once the person has said yes,
   * now or before. Asks when it has to; answers false at once while a no holds.
   */
  ensure(recipient: R): Promise<boolean>;
  /** The person has asked for something to be sent: lift the refusals, for one key or for all, so the next `ensure` asks again. */
  again(key?: string): void;
  /** Whether a yes is kept for this key. Asks nothing, and waits on nothing. */
  allows(key: string): boolean;
}

export function createConsentGate<R extends ConsentRecipient>(deps: ConsentDeps<R>): ConsentGate<R> {
  /** Questions on screen now, by key: every caller for that recipient waits on the one answer. */
  const asking = new Map<string, Promise<boolean>>();
  /** Keys the person said no to since the last `again`. */
  const refused = new Set<string>();

  async function put(recipient: R): Promise<boolean> {
    let yes = false;
    try {
      yes = (await deps.ask(recipient)) === true;
    } catch {
      yes = false;
    }
    if (yes) deps.keep(recipient.key);
    else refused.add(recipient.key);
    return yes;
  }

  return {
    ensure(recipient) {
      const { key } = recipient;
      if (deps.kept(key)) return Promise.resolve(true);
      const open = asking.get(key);
      if (open) return open;
      if (refused.has(key)) return Promise.resolve(false);
      const question = put(recipient).finally(() => asking.delete(key));
      asking.set(key, question);
      return question;
    },
    again(key) {
      if (key === undefined) refused.clear();
      else refused.delete(key);
    },
    allows(key) {
      return deps.kept(key);
    },
  };
}
