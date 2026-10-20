import { createReferenceCodec, ProtocolValidationError } from '../../trust-protocol/src/index.ts';
import type { IdentityMethodDefinition, PortableIssuerSignature } from '../../trust-protocol/src/index.ts';
import { validateSignatureEnvelope, parseSignatureEnvelopeJson } from './envelope.ts';
import { evmEoaVerifier } from './evm-eoa.ts';
import type { AuthorizationResult, SignatureMethodVerifier } from './types.ts';
export type * from './types.ts';
export { validateSignatureEnvelope, parseSignatureEnvelopeJson } from './envelope.ts';

export interface AuthorizationMethods {
  readonly identities?: readonly IdentityMethodDefinition[];
  readonly signatures?: readonly SignatureMethodVerifier[];
}

/** Registry is trusted application configuration, never provided by a signature. */
export function createAuthorizationVerifier(additional: AuthorizationMethods = {}) {
  const definitions = (additional.identities ?? []).map(value => ({ method: value.method, byteLength: value.byteLength }));
  const codec = createReferenceCodec(definitions);
  const identities = new Set(['evm-eoa', ...definitions.map(value => value.method)]);
  const methods = new Map<string, SignatureMethodVerifier['verify']>();
  for (const method of [evmEoaVerifier, ...(additional.signatures ?? [])]) {
    const key = `${method.identityMethod}/${method.signatureMethod}`;
    if (!identities.has(method.identityMethod) || !/^[a-z][a-z0-9-]{0,63}$/.test(method.signatureMethod) ||
        methods.has(key) || typeof method.verify !== 'function') throw new Error('INVALID_METHOD_CONFIGURATION');
    // Bind the function once: later object property replacement cannot select a new verifier.
    methods.set(key, method.verify.bind(method));
  }

  async function verifyAuthorization(recordInput: unknown, signatureInput: unknown): Promise<AuthorizationResult> {
    const result = (state: AuthorizationResult['state']): AuthorizationResult => Object.freeze({ state });
    let envelope: PortableIssuerSignature;
    try { envelope = validateSignatureEnvelope(signatureInput); } catch { return result('MALFORMED'); }
    if (!identities.has(envelope.identityMethod)) return result('UNSUPPORTED_IDENTITY_METHOD');
    const verify = methods.get(`${envelope.identityMethod}/${envelope.signatureMethod}`);
    if (!verify) return result('UNSUPPORTED_SIGNATURE_METHOD');
    let record;
    try { record = codec.validateReference(recordInput); }
    catch (error) {
      return result(error instanceof ProtocolValidationError && error.code === 'UNSUPPORTED_IDENTITY_METHOD'
        ? 'UNSUPPORTED_IDENTITY_METHOD' : 'MALFORMED');
    }
    const expectedWidth = envelope.identityMethod === 'evm-eoa' ? 20 : definitions.find(value => value.method === envelope.identityMethod)!.byteLength;
    if (envelope.signer.split(':')[0] !== envelope.identityMethod ||
        envelope.signer.split(':')[1]!.length !== 2 + expectedWidth * 2 || /^0x0+$/.test(envelope.signer.split(':')[1]!)) {
      return result('MALFORMED');
    }
    // Recompute from a frozen record snapshot; do not trust envelope.recordHash.
    if (await codec.hashReference(record) !== envelope.recordHash) return result('RECORD_HASH_MISMATCH');
    if (record.issuer !== envelope.signer) return result('SIGNER_MISMATCH');
    try {
      const state = await verify(await codec.portableSignatureMessage(record), envelope.signature, envelope.signer);
      return result(['VALID', 'INVALID_SIGNATURE', 'SIGNER_MISMATCH', 'MALFORMED'].includes(state) ? state : 'INVALID_SIGNATURE');
    } catch { return result('INVALID_SIGNATURE'); }
  }

  async function verifyAuthorizationJson(recordJson: string, signatureJson: string): Promise<AuthorizationResult> {
    try { return await verifyAuthorization(codec.parseReferenceJson(recordJson), parseSignatureEnvelopeJson(signatureJson)); }
    catch (error) {
      return Object.freeze({ state: error instanceof ProtocolValidationError && error.code === 'UNSUPPORTED_IDENTITY_METHOD'
        ? 'UNSUPPORTED_IDENTITY_METHOD' : 'MALFORMED' });
    }
  }
  return Object.freeze({ verifyAuthorization, verifyAuthorizationJson });
}

export const { verifyAuthorization, verifyAuthorizationJson } = createAuthorizationVerifier();
