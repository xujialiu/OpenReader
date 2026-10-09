import { useEffect, useReducer } from 'react';

import { purchases } from './purchase';

/**
 * What Settings shows of the Trial and the Unlock (#148), drawn again whenever
 * something is bought, restored or revoked, or the products load. The days left
 * are read against the clock as the screen draws, and Settings is drawn afresh
 * each time it is opened.
 */
export function usePurchases() {
  // The time it was drawn at, taken afresh at every change, for the days left.
  const [now, redraw] = useReducer(() => Date.now(), 0, () => Date.now());
  useEffect(() => purchases.subscribe(redraw), []);
  return { access: purchases.access(), price: purchases.price(), unavailable: purchases.unavailable(), now };
}
