import { decrypt } from "openpgp";

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
  encodeContent(content: any): void
  decodeContent(): void
  update(value: any): void
  createPoR(nodeId: string): string
  isValidPoR(nodeId: string, proof: string): boolean
  createPoD(nodeId: string): string
  isValidPoD(nodeId: string, proof: string): boolean
  isValid(sender: string): Promise<any>
  isValidUpdate(value: IValue, update: IValue): any
  decrypt(privateKeyObject: any): Promise<void>
  getSize(): number
  getRecord(): any
  getContent(shardId: string, replicationFactor: number, privateKeyObject: any): Promise<any>


}

export interface IValue {
  // immutable + mutable properties
  immutable: boolean
  version: number       // SSDB encoding version of this record
  encoding: string      // the value encoding for the content
  symkey: string        // asym encrypted symmetric key
  content: any       // the data being stored, encrypted by default
  owner: string         // the node_id who created the record
  createdAt: number     // unix timestamp when created or revised
  size: number          // size of the full record
  contractKey: string   // public key of record contract
  contractSig: string   // signature with contract private key

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


  
