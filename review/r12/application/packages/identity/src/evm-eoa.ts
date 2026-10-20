import { verifyMessage } from 'ethers';
import type { SignatureMethodVerifier } from './types.ts';

export const EVM_IDENTITY_METHOD = 'evm-eoa';
export const EVM_SIGNATURE_METHOD = 'eip191-personal-sign-v1';
const ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

export const evmEoaVerifier: SignatureMethodVerifier = Object.freeze({
  identityMethod: EVM_IDENTITY_METHOD,
  signatureMethod: EVM_SIGNATURE_METHOD,
  async verify(message, signature, signer) {
    // One wire form only: r(32) || s(32) || v(1), low-s, v=27/28.
    if (!/^0x[0-9a-f]{130}$/.test(signature)) return 'MALFORMED';
    const r = BigInt('0x' + signature.slice(2, 66));
    const s = BigInt('0x' + signature.slice(66, 130));
    const v = signature.slice(130);
    if (r === 0n || r >= ORDER || s === 0n || s > ORDER / 2n || !['1b', '1c'].includes(v)) return 'INVALID_SIGNATURE';
    try {
      const recovered = `evm-eoa:${verifyMessage(message, signature).toLowerCase()}`;
      return recovered === signer ? 'VALID' : 'SIGNER_MISMATCH';
    } catch {
      // Never propagate library exceptions which may echo untrusted inputs.
      return 'INVALID_SIGNATURE';
    }
  },
} satisfies SignatureMethodVerifier);
