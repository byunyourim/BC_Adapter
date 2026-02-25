import { ValidationError, ErrorCode } from "./errors";

export function requireFields(
  data: Record<string, unknown>,
  fields: string[],
): void {
  const missing = fields.filter(
    (f) => data[f] === undefined || data[f] === null || data[f] === "",
  );
  if (missing.length > 0) {
    throw new ValidationError(ErrorCode.MISSING_REQUIRED_FIELDS, missing.join(", "));
  }
}
