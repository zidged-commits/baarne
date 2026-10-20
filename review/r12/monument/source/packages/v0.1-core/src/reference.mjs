import { createReferenceCodec } from '../../trust-protocol/src/index.ts';
import { createAuthorizationVerifier } from '../../identity/src/index.ts';
import { canonical } from '../../admission/src/json.ts';
import { identityFromPublicKey, publicKeyFromIdentity, signText, verifyText } from './crypto.mjs';

export const referenceCodec = createReferenceCodec([{ method: 'ed25519', byteLength: 32 }]);
export const authorizationVerifier = createAuthorizationVerifier({
  identities: [{ method: 'ed25519', byteLength: 32 }],
  signatures: [{
    identityMethod: 'ed25519',
    signatureMethod: 'ed25519-v1',
    async verify(message, signature, signer) {
      return verifyText(publicKeyFromIdentity(signer), message, signature) ? 'VALID' : 'INVALID_SIGNATURE';
    },
  }],
});

export async function createReference(privateKeyPkcs8, subject, issuedAt, nonce) {
  const issuer = identityFromPublicKey((await import('./crypto.mjs')).publicKeyRawFromPrivate(privateKeyPkcs8));
  const record = referenceCodec.validateReference({
    protocolVersion: '0.1',
    recordType: 'BAARNE_REFERENCE_V1',
    issuer,
    subject,
    issuedAt,
    expiresAt: null,
    nonce,
    revocable: true,
    metadataHash: null,
  });
  const recordHash = await referenceCodec.hashReference(record);
  const authorization = {
    signatureType: 'BAARNE_SIGNATURE_V1',
    signatureVersion: '1',
    identityMethod: 'ed25519',
    signatureMethod: 'ed25519-v1',
    signer: issuer,
    recordHash,
    signature: signText(privateKeyPkcs8, await referenceCodec.portableSignatureMessage(record)),
  };
  return { record, authorization };
}

export async function verifyReferencePackage(reference) {
  try {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference) ||
        Object.keys(reference).sort().join(',') !== 'authorization,record') return { status: 'MALFORMED' };
    const record = referenceCodec.validateReference(reference.record);
    const result = await authorizationVerifier.verifyAuthorization(record, reference.authorization);
    if (result.state !== 'VALID') return { status: result.state };
    return {
      status: 'VALID',
      record,
      recordHash: await referenceCodec.hashReference(record),
      canonicalRecord: referenceCodec.canonicalizeReference(record),
      canonicalPackage: canonical({ record, authorization: reference.authorization }),
    };
  } catch {
    return { status: 'MALFORMED' };
  }
}

export async function portableReferenceBundle(reference) {
  const checked = await verifyReferencePackage(reference);
  if (checked.status !== 'VALID') throw new Error('INVALID_REFERENCE');
  return {
    bundleFormatVersion: 'BAARNE_VERIFICATION_BUNDLE_V1',
    canonicalRecord: checked.canonicalRecord,
    portableAuthorization: canonical(reference.authorization),
    optionalChainEvidence: null,
  };
}
