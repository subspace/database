export interface IShard {
  contract: string
  size: number
  records: Set<string>
}

export interface IRecord {
  key: string
  value: IRecordValue
}

export interface IRecordValue {
  type: string
  version: number
  encoding: string
  symkey: string
  content: any
  createdAt: number
}

export interface IImmutableRecord extends IRecord {
  value: IImmutableRecordValue
}

export interface IImmutableRecordValue extends IRecordValue {
  type: 'immutable'
}

export interface IMutableRecord extends IRecord {
  value: IMutableRecordValue
}

export interface IMutableRecordValue extends IRecordValue {
  type: 'mutable'
  publicKey: string     // public key of this record
  privateKey: string    // sym encrypted private key of this record
  contentHash: string   // a hash of final content
  revision: number      // sequence number for conflict resolution
  updatedAt: number     // last update for this record
  recordSig: string     // signature with record private key
}
export interface IContract {
  txId: string
  createdAt: number
  spaceReserved: number
  replicationFactor: number
  ttl: number
  contractSig: string
  contractId: string
}

export interface IRequest {
  record: IRecord
  contractKey: string
  timestamp: number
  signature: string
}


  
