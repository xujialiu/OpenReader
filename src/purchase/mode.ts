import { BUILD_VARIANT } from '../build/variant';

/** Only the formal copy purchases speech. Metro excludes this whole module from the two free copies. */
export const PURCHASE_LOCK: boolean = BUILD_VARIANT === 'formal';
