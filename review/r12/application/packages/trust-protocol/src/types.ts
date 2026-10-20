/** Method names describe cryptographic identifiers, never people or networks. */
export type IdentityIdentifier = `${string}:0x${string}`;
export type RecordHash = `0x${string}`;

export interface ReferenceRecord {
  readonly protocolVersion: '0.1';
  readonly recordType: 'BAARNE_REFERENCE_V1';
  readonly issuer: IdentityIdentifier;
  readonly subject: IdentityIdentifier;
  readonly issuedAt: number;
  readonly expiresAt: number | null;
  readonly nonce: `0x${string}`;
  readonly revocable: true;
  readonly metadataHash: null;
}

/** Trusted application configuration, never definitions supplied by a record. */
export interface IdentityMethodDefinition {
  readonly method: string;
  readonly byteLength: number;
}

/** Evidence is unverified input until a chain adapter checks it. */
export interface BlockchainEvidence {
  readonly adapter: string;
  readonly network: string;
  readonly attestationId: string;
  readonly transactionHash?: string;
  readonly blockNumber?: string;
  readonly blockHash?: string;
  readonly rpcProvider?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Private operational data; NEVER included in canonical record bytes. */
export interface OperationalMetadata {
  readonly databaseId?: string;
  readonly indexedAt?: string;
  readonly platformStatus?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Method-neutral authorization. The canonical record and its hash exclude it. */
export interface PortableIssuerSignature {
  readonly signatureType: 'BAARNE_SIGNATURE_V1';
  readonly signatureVersion: '1';
  readonly identityMethod: string;
  readonly signatureMethod: string;
  readonly signer: IdentityIdentifier;
  readonly recordHash: RecordHash;
  readonly signature: string;
}

export interface ReferenceEnvelope {
  readonly record: ReferenceRecord;
  readonly issuerSignature?: PortableIssuerSignature;
  readonly blockchainEvidence?: readonly BlockchainEvidence[];
  readonly operationalMetadata?: OperationalMetadata;
}
