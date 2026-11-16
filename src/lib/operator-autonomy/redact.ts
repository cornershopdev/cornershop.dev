const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET = /\b(?:sk|rk|pk|whsec)_[A-Za-z0-9]+/g;
const CONNECTION_URL =
  /\b(?:postgres(?:ql)?|redis|rediss|mongodb(?:\+srv)?):\/\/\S+/gi;

export function redactOperatorText(value: string): string {
  return value
    .replace(EMAIL, "[redacted-email]")
    .replace(SECRET, "[redacted-secret]")
    .replace(CONNECTION_URL, "[redacted-url]");
}

export function redactOperatorValue<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return redactOperatorText(value);
  if (Array.isArray(value)) return value.map((entry) => walk(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, walk(entry)]),
    );
  }
  return value;
}
