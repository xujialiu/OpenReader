import { withTimeout } from '../timeout';

/** Speech Models, not the reference voices Fish also calls models (#229). */
export interface FishSpeechModel { id: string; free?: boolean }
export const DEFAULT_FISH_MODEL = 's2.1-pro-free';
export const FISH_MODELS: readonly FishSpeechModel[] = [
  { id: DEFAULT_FISH_MODEL, free: true },
  { id: 's2.1-pro', free: false },
  { id: 'drama-3', free: false },
  { id: 's2-pro', free: false },
];
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The compat list's prices have no billing unit: never turn them into a quoted price. */
export function parseFishModels(value: unknown): FishSpeechModel[] {
  const data = object(value).data;
  if (!Array.isArray(data)) throw new Error('Fish Audio returned no Model list.');
  const models = new Map<string, FishSpeechModel>();
  for (const raw of data) {
    const row = object(raw);
    if (object(row.architecture).modality !== 'text->speech' || typeof row.id !== 'string') continue;
    const match = /^fish-audio\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(row.id);
    if (!match) continue;
    const price = object(row.pricing).prompt;
    const known = (typeof price === 'number' || typeof price === 'string' && price.trim() !== '') && Number.isFinite(Number(price)) && Number(price) >= 0;
    models.set(match[1], { id: match[1], ...(known ? { free: Number(price) === 0 } : {}) });
  }
  return [...models.values()];
}

export function fishModels(discovered: readonly FishSpeechModel[], selected?: string): FishSpeechModel[] {
  const models = new Map(FISH_MODELS.map((model) => [model.id, model]));
  for (const model of discovered) if (!models.has(model.id)) models.set(model.id, model);
  if (selected && !models.has(selected)) models.set(selected, { id: selected });
  return [...models.values()];
}
export const fishModelLabel = ({ id, free }: FishSpeechModel): string =>
  free === undefined ? id : `${id} — ${free ? 'free' : 'paid'}`;

/** Keyless, bounded through body consumption, single-flight; only successful lists are cached. */
export class FishModelList {
  private cached?: { models: FishSpeechModel[]; until: number };
  private flight?: Promise<FishSpeechModel[]>;
  constructor(private readonly now = Date.now, private readonly timeoutMs = 5000) {}
  load(fetcher: typeof fetch): Promise<FishSpeechModel[]> {
    if (this.cached && this.cached.until > this.now()) return Promise.resolve(this.cached.models);
    if (this.flight) return this.flight;
    const controller = new AbortController();
    this.flight = withTimeout((async () => {
      const reply = await fetcher('https://api.fish.audio/compat/v1/models', { signal: controller.signal });
      if (!reply.ok) throw new Error(`Fish Audio Model list: HTTP ${reply.status}`);
      return parseFishModels(await reply.json());
    })(), this.timeoutMs, () => new Error('Fish Audio Model list did not respond.'), () => controller.abort())
      .then((models) => { this.cached = { models, until: this.now() + 30 * 60_000 }; return models; })
      .finally(() => { this.flight = undefined; });
    return this.flight;
  }
}
export const sharedFishModels = new FishModelList();
