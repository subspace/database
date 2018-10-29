export interface IDataBase {
  shards: IShards
}

export interface IShards {
  map: Map<string, IShard>,
  save(): void
  load(): void
}

export interface IShard {
  contract: string
  size: number
  records: Set<string>
}

export interface IRecord {
  key: string,
  value: IValue
}

export interface IValue {
  // immutable + mutable properties
  immutable: boolean
  version: number       // SSDB encoding version of this record
  encoding: string      // the value encoding for the content
  symkey: string        // asym encrypted symmetric key
  content: any           // the data being stored, encrypted by default
  createdAt: number     // unix timestamp when created 
  // ownerKey: string      // full public key of record creator
  // ownerSig: string      // singature of record creator
  
  // mutable only properties
  publicKey?: string     // public key of this record
  privateKey?: string    // sym encrypted private key of this record
  contentHash?: string   // a hash of final content
  revision?: number      // sequence number for conflict resolution
  updatedAt?: number     // last update for this record
  recordSig?: string     // signature with record private key
}


export interface IContract {
  id: string
  createdAt: number
  spaceReserved: number
  replicationFactor: number
  ttl: number
  contractSig: string
}

export interface IRequest {
  record: IRecord
  contractKey: string
  timestamp: number
  signature: string
}


  
