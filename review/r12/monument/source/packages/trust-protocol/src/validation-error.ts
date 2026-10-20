export class ProtocolValidationError extends Error {
  readonly code: string;
  constructor(code: string) {
    // Never reflect supplied keys, identifiers, secrets or values in diagnostics.
    super(`Invalid BAARNE reference (${code})`);
    this.name = 'ProtocolValidationError';
    this.code = code;
  }
}
