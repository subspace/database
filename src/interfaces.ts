export interface IRecord {
  kind: 'mutable' | 'immutable'
  key: string,
  value: IValue
}

export interface IImmutableRecord extends IRecord {
  kind: 'immutable'
  value: IImmutableValue
}

export interface IMutableRecord extends IRecord {
  kind: 'mutable'
  value: IMutableValue
}

export type Record = IImmutableRecord | IMutableRecord

export interface IValue {
  version: number   // subspace database encoding version of this record
  encoding: string  // the value encoding for the content
  symkey: string    // asym encrypted symmetric key
  content: string   // the data being stored, encrypted by default
  owner: string     // the node_id who created the record
  timestamp: number // unix timestamp when created or revised
  size: number      // size of the full record
  contract: string  // the id of the data contract this record is assigned to
  contractSignature: string 
}

export interface IImmutableValue extends IValue {
}

export interface IMutableValue extends IValue {
  publicKey: string    // public key of this record
  privateKey: string   // sym encrypted private key of this record
  contentHash: string      // a hash of the decrypted content, for authenticity
  revision: number  // sequence number for conflict resolution
  recordSignature: string
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

export interface ShardMap {
  id: string
  hosts: string[]
}

export interface IContractObject {
  kind: 'contractObject'
  id: string
  owner: string
  name: string
  email: string
  passphrase: string
  ttl: number
  replicationFactor: number
  spaceReserved: number
  spaceUsed: number
  createdAt: number
  updatedAt: number
  recordIndex: Set<string>
  publicKey: string
  privateKey: string
  privateKeyObject: any
}

export interface IContractData {
  kind: 'contractData'
  publicKey: string
  clientKey: string
  createdAt: number
  ttl: number 
  spaceReserved: number
  replicationFactor: number
}

export type IContract = IContractObject | IContractData


