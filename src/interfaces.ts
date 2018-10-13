
export interface ImmutableRecord {
  key: string,
  value: ImmutableValue
}

export interface ImmutableValue {
  version: number   // subspace database encoding version of this record
  encoding: string  // the value encoding for the content 
  symkey: string    // asym encrypted symmetric key
  content: string   // the data being stored, encrypted by default
  owner: string     // the node_id who created the record
  timestamp: number // unix timestamp when created or revised
  size: number      // size of the full record 
  contract: string  // the data contract the record is stored against
}

export interface MutableRecord {
  key: string
  value: MutableValue
}

export interface MutableValue extends ImmutableValue {
  pubkey: string    // public key of this record
  privkey: string   // sym encrypted private key of this record
  contentHash: string      // a hash of the decrypted content, for authenticity
  revision: number  // sequence number for conflict resolution
  signature: string // contract or pub key signature of message
}

export interface ShardIndex {
  contract: string
  size: number 
  count: number
  shards: string[]
}

export interface Shard {
  id: string
  contract: string
  size: number
  records: string[]
}

