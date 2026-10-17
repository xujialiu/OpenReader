/**
 * FastAPI's `detail`: a sentence, or one entry per refused field whose `loc`
 * starts with where the field was (`body`, `query`), which is left out when a
 * field name follows it. `voice: Field required; speed: Input should be…`.
 */
function fastApiDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail.trim();
  if (!Array.isArray(detail)) return '';
  return detail.flatMap((entry) => {
    const { loc, msg } = (entry ?? {}) as { loc?: unknown; msg?: unknown };
    if (typeof msg !== 'string' || !msg.trim()) return [];
    const path = Array.isArray(loc) ? loc.map(String) : [];
    const field = (path.length > 1 && ['body', 'query', 'path', 'header'].includes(path[0]!) ? path.slice(1) : path).join('.');
    return [field ? `${field}: ${msg.trim()}` : msg.trim()];
  }).join('; ');
}

/**
 * What the server said, from an error body in OpenAI's shape — the longer
 * of `error.message` and `error.param`, since OpenAI puts the detail in the
 * message ("Invalid value: 'x'. Supported values are…", param "voice") and
 * other servers in the param ("Unknown voice: x. Available voices: […]",
 * message "Param Incorrect") — or in FastAPI's, which self-hosted servers
 * such as Chatterbox answer with (#65): `detail` as a sentence, or as a list
 * of fields and what is wrong with each. Empty for anything else.
 */
export function serverReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; detail?: unknown } | null;
    const detail = fastApiDetail(parsed?.detail);
    if (detail) return detail.slice(0, 300);
    const error = parsed?.error;
    if (typeof error === 'string') return error.trim().slice(0, 300);
    const fields = error as { message?: unknown; param?: unknown } | null;
    const texts = [fields?.message, fields?.param].filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return texts.sort((a, b) => b.length - a.length)[0]?.trim().slice(0, 300) ?? '';
  } catch {
    return '';
  }
}

