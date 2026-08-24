/**
 * Serializes JSON-LD for embedding in a native script element.
 *
 * JSON.stringify does not make HTML script contents safe on its own. Escaping
 * tag openings prevents `</script>` breakouts, while escaping the JavaScript
 * line separators keeps the payload safe for consumers that parse it as
 * script source instead of JSON.
 */
export function serializeJsonLd(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("JSON-LD must be JSON-serializable");
  }
  return serialized
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
