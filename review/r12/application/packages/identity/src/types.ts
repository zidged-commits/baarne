import type { IdentityIdentifier, PortableIssuerSignature, ReferenceRecord } from '../../trust-protocol/src/index.ts';

export type AuthorizationState = 'VALID' | 'INVALID_SIGNATURE' | 'SIGNER_MISMATCH' |
  'RECORD_HASH_MISMATCH' | 'UNSUPPORTED_IDENTITY_METHOD' | 'UNSUPPORTED_SIGNATURE_METHOD' | 'MALFORMED';

export interface AuthorizationResult { readonly state: AuthorizationState }

/** Client/local capability. Neither a key nor a wallet implementation is exposed. */
export interface IdentityProvider {
  readonly identityMethod: string;
  getAddress(): Promise<IdentityIdentifier>;
  sign(record: ReferenceRecord): Promise<PortableIssuerSignature>;
}

export interface IdentityProviderFactory {
  createIdentity(): Promise<IdentityProvider>;
}

export type MethodVerification = 'VALID' | 'INVALID_SIGNATURE' | 'SIGNER_MISMATCH' | 'MALFORMED';

/** Trusted plugins verify control using their own mechanism, not necessarily recovery. */
export interface SignatureMethodVerifier {
  readonly identityMethod: string;
  readonly signatureMethod: string;
  verify(message: string, signature: string, signer: IdentityIdentifier): Promise<MethodVerification>;
}
