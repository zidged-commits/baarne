import { parseRecordJson } from './json.ts';
import { ProtocolValidationError } from './validation-error.ts';
import type { IdentityIdentifier, IdentityMethodDefinition, RecordHash, ReferenceRecord } from './types.ts';
export type * from './types.ts';
export { ProtocolValidationError } from './validation-error.ts';

export const RECORD_HASH_DOMAIN = 'BAARNE_RECORD_V1\n';
export const SIGNATURE_INTENT_DOMAIN = 'BAARNE_REFERENCE_V1\n';
export const REFERENCE_STATEMENT = 'I know this person and I vouch for their admission to the BAARNE network.';

// RFC 8785 UTF-16 lexicographic order, fixed for this flat, ASCII-keyed schema.
const KEYS = Object.freeze(['expiresAt', 'issuedAt', 'issuer', 'metadataHash', 'nonce',
  'protocolVersion', 'recordType', 'revocable', 'subject'] as const);

function reject(code: string): never { throw new ProtocolValidationError(code); }

function fields(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object') return reject('OBJECT');
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return reject('OBJECT');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== KEYS.length || keys.some(key => typeof key !== 'string' || !KEYS.includes(key as typeof KEYS[number]))) {
    return reject('FIELDS');
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of KEYS) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable) return reject('FIELDS');
    result[key] = property.value as unknown;
  }
  return result;
}

function seconds(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || Object.is(input, -0)) return reject('TIME');
  return input;
}

/** Hex is byte data, not Ethereum serialization. ASCII 0x prefix is canonical. */
function hex(input: unknown, bytes: number, code: string): `0x${string}` {
  if (typeof input !== 'string' || input.length !== 2 + bytes * 2 || !/^0x[0-9a-fA-F]+$/.test(input)) return reject(code);
  return input.toLowerCase() as `0x${string}`;
}

/**
 * Extensions register fixed-width public cryptographic identifiers only.
 * Names/lengths are trusted versioned configuration; unknown methods fail closed.
 * This does not install a signer or claim that an identifier is controlled by anyone.
 */
export function createReferenceCodec(additionalMethods: readonly IdentityMethodDefinition[] = []) {
  const methods = new Map<string, number>([['evm-eoa', 20]]);
  for (const definition of additionalMethods) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(definition.method) || methods.has(definition.method) ||
        !Number.isSafeInteger(definition.byteLength) || definition.byteLength < 1 || definition.byteLength > 128) {
      return reject('IDENTITY_METHOD_CONFIGURATION');
    }
    methods.set(definition.method, definition.byteLength);
  }

  function identity(input: unknown): IdentityIdentifier {
    if (typeof input !== 'string' || input.length > 291) return reject('IDENTITY');
    const match = /^([a-z][a-z0-9-]{0,31}):(0x[0-9a-fA-F]+)$/.exec(input);
    if (!match) return reject('IDENTITY');
    const method = match[1]!;
    const width = methods.get(method);
    if (width === undefined) return reject('UNSUPPORTED_IDENTITY_METHOD');
    const value = hex(match[2], width, 'IDENTITY');
    if (/^0x0+$/.test(value)) return reject('IDENTITY');
    return `${method}:${value}`;
  }

  function validateReference(input: unknown): ReferenceRecord {
    const value = fields(input);
    if (value.protocolVersion !== '0.1' || value.recordType !== 'BAARNE_REFERENCE_V1' ||
        value.revocable !== true || value.metadataHash !== null) return reject('CONSTANT');
    const issuedAt = seconds(value.issuedAt);
    const expiresAt = value.expiresAt === null ? null : seconds(value.expiresAt);
    if (expiresAt !== null && expiresAt <= issuedAt) return reject('EXPIRATION');
    return Object.freeze({
      protocolVersion: '0.1', recordType: 'BAARNE_REFERENCE_V1',
      issuer: identity(value.issuer), subject: identity(value.subject),
      issuedAt, expiresAt, nonce: hex(value.nonce, 32, 'NONCE'),
      revocable: true, metadataHash: null,
    });
  }

  function canonicalizeReference(input: unknown): string {
    const record = validateReference(input);
    // Values are only constrained ASCII strings, safe integers, true and null.
    // This implements JCS for this schema, not a general arbitrary-JSON encoder.
    return `{${KEYS.map(key => `${JSON.stringify(key)}:${JSON.stringify(record[key])}`).join(',')}}`;
  }

  function canonicalReferenceBytes(input: unknown): Uint8Array {
    return new TextEncoder().encode(canonicalizeReference(input));
  }

  async function hashReference(input: unknown): Promise<RecordHash> {
    const bytes = new TextEncoder().encode(RECORD_HASH_DOMAIN + canonicalizeReference(input));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return `0x${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  function parseReferenceJson(text: string): ReferenceRecord {
    return validateReference(parseRecordJson(text));
  }

  async function portableSignatureMessage(input: unknown): Promise<string> {
    return SIGNATURE_INTENT_DOMAIN + await hashReference(input);
  }

  return Object.freeze({ validateReference, canonicalizeReference, canonicalReferenceBytes,
    hashReference, parseReferenceJson, portableSignatureMessage });
}

export const { validateReference, canonicalizeReference, canonicalReferenceBytes,
  hashReference, parseReferenceJson, portableSignatureMessage } = createReferenceCodec();
