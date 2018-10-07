
export interface immutableRecord {
  key: string,
  value: immutableValue
}

export interface immutableValue {
  version: string   // subspace database encoding version of this record
  encoding: string  // the value encoding for the content 
  symkey: string    // asym encrypted symmetric key
  content: string   // the data being stored, encrypted by default
  owner: string     // the node_id who created the record
  timestamp: number // unix timestamp when created or revised
  contract: string  // the data contract the record is stored against
}

export interface mutableRecord {
  key: string
  value: mutableValue
}

export interface mutableValue extends immutableValue {
  pubkey: string    // public key of this record
  privkey: string   // sym encrypted private key of this record
  contentHash: string      // a hash of the decrypted content, for authenticity
  revision: number  // sequence number for conflict resolution
  signature: string // contract or pub key signature of message
}
