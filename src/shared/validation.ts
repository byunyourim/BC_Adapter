export function requireFields(
  data: Record<string, unknown>,
  fields: string[],
): void {
  const missing = fields.filter(
    (f) => data[f] === undefined || data[f] === null || data[f] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
}
