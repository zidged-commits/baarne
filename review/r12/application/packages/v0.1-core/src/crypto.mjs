import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { canonical } from '../../admission/src/json.ts';

export function sha256Hex(domain, value) {
  const text = typeof value === 'string' ? value : canonical(value);
  return '0x' + createHash('sha256').update(domain).update(text).digest('hex');
}

export function bytesToHex(bytes) {
  return '0x' + Buffer.from(bytes).toString('hex');
}

export function hexToBytes(value, length) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/.test(value) || value.length !== 2 + length * 2) {
    throw new Error('INVALID_HEX');
  }
  return Buffer.from(value.slice(2), 'hex');
}

export function generateEd25519KeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPkcs8: bytesToHex(privateKey.export({ format: 'der', type: 'pkcs8' })),
    publicKeyRaw: bytesToHex(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)),
  };
}

export function privateKeyFromPkcs8(value) {
  return createPrivateKey({ key: hexToBytes(value, 48), format: 'der', type: 'pkcs8' });
}

export function publicKeyFromRaw(value) {
  const raw = hexToBytes(value, 32);
  return createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
    format: 'der',
    type: 'spki',
  });
}

export function publicKeyRawFromPrivate(value) {
  return bytesToHex(createPublicKey(privateKeyFromPkcs8(value)).export({ format: 'der', type: 'spki' }).subarray(-32));
}

export function signText(privateKeyPkcs8, text) {
  return bytesToHex(nodeSign(null, Buffer.from(text, 'utf8'), privateKeyFromPkcs8(privateKeyPkcs8)));
}

export function verifyText(publicKeyRaw, text, signature) {
  try {
    return nodeVerify(null, Buffer.from(text, 'utf8'), publicKeyFromRaw(publicKeyRaw), hexToBytes(signature, 64));
  } catch {
    return false;
  }
}

export function identityFromPublicKey(publicKeyRaw) {
  hexToBytes(publicKeyRaw, 32);
  return `ed25519:${publicKeyRaw}`;
}

export function publicKeyFromIdentity(identity) {
  if (typeof identity !== 'string' || !/^ed25519:0x[0-9a-f]{64}$/.test(identity)) throw new Error('INVALID_IDENTITY');
  return identity.slice('ed25519:'.length);
}
