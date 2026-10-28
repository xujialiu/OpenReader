/**
 * One literal for the owner's Version, formal base Build Number and Beta.
 * Free is base + 1; Debug is base + 2 (ADR 0086, #324). Only the owner moves
 * the Version. Each app change advances the Beta; a complete upload set drops
 * it, and the next set advances the base by three. Native configuration and
 * Settings derive their identity from this same line.
 */
export const APP_VERSION = '1.0.3 (22)-beta2';
