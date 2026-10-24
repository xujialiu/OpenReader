/** No store, cache, clock, listener or fabricated ownership in a free/Debug artifact (#324). */
export const purchases: typeof import('./purchase').purchases = {
  allowsSpeech: () => true,
  canStartSpeech: () => true,
  ready: () => Promise.resolve(),
  settled: () => true,
  trialLeft: () => null,
  askForSpeech: () => Promise.resolve(true),
  access: () => ({ kind: 'off' }),
  price: () => null,
  unavailable: () => false,
  startTrial: () => Promise.resolve(false),
  unlock: () => Promise.resolve(false),
  restore: () => Promise.resolve(false),
  subscribe: () => () => {},
};
