import type { PortableIssuerSignature } from '../../trust-protocol/src/index.ts';

const KEYS = ['signatureType', 'signatureVersion', 'identityMethod', 'signatureMethod', 'signer', 'recordHash', 'signature'];

/** Strict v1 shell. Signature byte/curve rules belong to the selected method. */
export function validateSignatureEnvelope(input: unknown): PortableIssuerSignature {
  const fail = (): never => { throw new Error('MALFORMED'); };
  if (input === null || typeof input !== 'object') return fail();
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== KEYS.length || keys.some(key => typeof key !== 'string' || !KEYS.includes(key))) return fail();
  const value: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || typeof descriptor.value !== 'string') return fail();
    value[key] = descriptor.value as string;
  }
  if (value.signatureType !== 'BAARNE_SIGNATURE_V1' || value.signatureVersion !== '1' ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(value.identityMethod!) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(value.signatureMethod!) ||
      !/^[a-z][a-z0-9-]{0,31}:0x[0-9a-f]{2,256}$/.test(value.signer!) ||
      !/^0x[0-9a-f]{64}$/.test(value.recordHash!) ||
      value.signature!.length < 1 || value.signature!.length > 16384) return fail();
  // Strings are immutable; snapshot avoids mutations while verification awaits.
  return Object.freeze(value) as unknown as PortableIssuerSignature;
}

/** Strict bounded flat string-object JSON, rejecting duplicates before parsing. */
export function parseSignatureEnvelopeJson(text: string): PortableIssuerSignature {
  const fail = (): never => { throw new Error('MALFORMED'); };
  if (typeof text !== 'string' || text.length > 32768 || new TextEncoder().encode(text).length > 32768) return fail();
  let offset = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '')) offset++; };
  const consume = (character: string) => { whitespace(); if (text[offset++] !== character) fail(); };
  const string = (): string => {
    whitespace();
    const token = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(text.slice(offset))?.[0];
    if (!token) return fail();
    offset += token.length;
    return JSON.parse(token) as string;
  };
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  consume('{');
  whitespace();
  if (text[offset] !== '}') {
    for (;;) {
      const key = string();
      if (Object.hasOwn(result, key)) return fail();
      consume(':');
      result[key] = string();
      whitespace();
      if (text[offset] !== ',') break;
      offset++;
    }
  }
  consume('}'); whitespace();
  if (offset !== text.length) return fail();
  return validateSignatureEnvelope(result);
}
