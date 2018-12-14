import {IRecord, IValue, IContract, IShard} from './interfaces'
import * as crypto from '@subspace/crypto'
import {jumpConsistentHash} from '@subspace/jump-consistent-hash'
import {Destination, pickDestinations} from '@subspace/rendezvous-hash'
import { encrypt } from 'openpgp';
export {IRecord, IValue}

// ToDo
  // later add patch method for unecrypted data

const VALID_ENCODING = ['null', 'string', 'number', 'boolean', 'array', 'object', 'buffer']
const MUTABLE_KEY_NAME = 'key'
const MUTABLE_KEY_EMAIL = 'key@key.com'
const MUTABLE_KEY_PASSPRHASE = 'lockandkey'
const SCHEMA_VERSION = 0

/**
 * Size of one shard in bytes (100M)
 */
export const SHARD_SIZE = 100000000;
/**
 * Pledge size in bytes (100 shards or 10G)
 */
export const PLEDGE_SIZE = SHARD_SIZE * 100;


export class DataBase {
  
  constructor(
    private wallet: any,
    private storage?: any,
    private tracker?: any
  ) {
    this.shards.load()
  }

  shards = {
    map: <Map<string, IShard>> new Map(),
    save: async () => {
      await this.storage.put('shards', JSON.stringify([...this.shards.map]))
    }, 
    load: async () => {
      const shards = await this.storage.get('shards')
      if (shards) {
        this.shards.map = new Map(JSON.parse(shards))
      } else {
        this.shards.map = new Map()
      }
    }
  }

  // **********************
  // Record CRUD Operations
  // **********************

  public async createRecord(content: any, encrypted: boolean) {
    // creates and saves a new record based on current default contract
    const profile = this.wallet.getProfile()
    const contract = this.wallet.getContract()

    let record: Record
    if (contract.ttl) {
      record = await Record.createMutable(content, encrypted, profile.publickey)
    } else {
      record = await Record.createImmutable(content, encrypted, profile.publicKey)
    }
    await this.storage.put(record.key, JSON.stringify(record.value))
    return record
  }

  public async getRecord(key: string) {
    // loads and returns an existing record instance on disk from a given key (from short key)
    const stringValue = await this.storage.get(key)
    const value = JSON.parse(stringValue)
    if (!value.symkey) {
      // return plain text content to packed format 
      value.content = JSON.stringify(value.content)
    }
    const record = Record.readPacked(key, value)
    return record   
  }

  public loadPackedRecord(recordObject: IRecord) {
    // loads and returns an existing record instance from a packed record received over the network
    const record = Record.readPacked(recordObject.key, recordObject.value)
    return record
  }

  public loadUnpackedRecord(recordObject: IRecord) {
    // loads and returns an existing record instance from an upacked record received over the network
    const record = Record.readUnpacked(recordObject.key, recordObject.value)
    return record
  }

  // need a simple save 

  // need a simple delete 

  public async saveRecord(record: Record, contract: IContract, update?: boolean, sizeDelta?: number) {
    // saves an encrypted, encoded record to disk locally, as a host

    const shardId = this.getShardForKey(record.key, contract)
    let shard = this.getShard(shardId)
    if (!shard) {
      shard = await this.createShard(shardId, contract.id)
    }

    if (update) {
      shard.size += sizeDelta
    } else {
      shard.records.add(record.key)
      shard.size += record.getSize()
    }
    
    this.shards.map.set(shardId, JSON.parse(JSON.stringify(shard)))
    await this.shards.save()
    await this.storage.put(record.key, JSON.stringify(record.value))
  }

  public async revRecord(key: string, update: any) {
    // loads an existing record instance from key, applies update, and returns instance, called by client
    const profile = this.wallet.getProfile()
    const record = await this.getRecord(key)
    await record.update(update, profile)
    await this.storage.put(record.key, JSON.stringify(record.value))
    return record
  }

  public async delRecord(record: Record, shardId: string) {
    // deletes an existing record from a key, for a host
    await this.storage.del(record.key)
    await this.delRecordInShard(shardId, record)
  }

  public parseRecordKey(key: string) {
    const keys = key.split(':')
    const keyObject = {
      shardId: keys[0],
      recordId: keys[1],
      replicationFactor: Number(keys[2])
    }
    return keyObject
  }

  // *********************************************
  // record request validation methods (for hosts)
  // *********************************************

  public isValidRequest(record: IRecord, hosts: string[]) {
    // is this a valid request message?

    const test = {
      valid: false,
      reason: <string> null
    }

    if (!record.value.immutable) {
      // is the timestamp within 10 minutes?
      if (! crypto.isDateWithinRange(record.value.createdAt, 60000) ) {
        test.reason = 'Invalid request, timestamp is not within 10 minutes'
        return test
      }
    }

    // am I the valid host for shard?
    const amValidHost = hosts.includes(this.wallet.profile.user.id)
    if (! amValidHost) {
      test.reason = 'Invalid contract request, sent to incorrect host'
      return test
    }

    test.valid = true
    return test
  }

  public async isValidContractOp(record: Record, contract: IContract, shardMap: any, request: any, sizeDelta?: number) {

    const test = {
      valid: false,
      reason: <string> null
    }

    // has a valid contract tx been gossiped?
    if (!contract) {
      test.reason = 'Invalid contract request, unknown contract'
      return test
    }

    // is the contract active  
    if ((contract.createdAt + contract.ttl) < Date.now()) {
      test.reason = 'Invalid contract request, contract ttl has expired'
      return test
    }

    // does record owner match contract owner 
    // add ACL later
    // if (crypto.getHash(record.value.ownerKey) !== contract.owner) {
    //   test.reason = 'Invalid del request, contract does not match record contract'
    //   return test
    // }

    // is valid contract signature
    const unsignedValue = JSON.parse(JSON.stringify(request))
    unsignedValue.signature = null
    const validSignature = await crypto.isValidSignature(unsignedValue, request.signature, request.contractKey)
    if (!validSignature) {
      test.reason = 'Invalid contract request, incorrect signature'
      return test
    }

    // does the shard have space available
    const shard = this.getShard(shardMap.id)
    if (shard) {
      if (sizeDelta) {
        if (! (shard.size + sizeDelta <= SHARD_SIZE)) {
          test.reason = 'Invalid contract request, this shard is out of space'
          return test
        }
      } else {
        if (! (shard.size + record.getSize() <= SHARD_SIZE)) {
          test.reason = 'Invalid contract request, this shard is out of space'
          return test
        }
      }
    }

    test.valid = true
    return test
  }

  public async isValidPutRequest(record: Record, contract: IContract, request: any) {
    // is this a valid put request message?

    const test = {
      valid: false,
      reason: <string> null
    }

    const shardMap = this.getShardAndHostsForKey(record.key, contract)

    // is the request valid
    const isValidRequest = this.isValidRequest(record, shardMap.hosts)
    if (!isValidRequest) {
      return isValidRequest
    }

    // is valid operation for contract?
    const isValidContractOp = await this.isValidContractOp(record, contract, shardMap.hosts, request)
    if (!isValidContractOp.valid) {
      return isValidContractOp
    }

    test.valid = true
    return test
  }

  public async isValidMutableContractRequest(txRecord: Record, contractRecord: Record) {
    // check that the signature in the tx matches the contract record public key 
    const message = contractRecord.value.publicKey
    const signature = txRecord.value.content.contractSig
    const publicKey = contractRecord.value.publicKey
    return await crypto.isValidSignature(message, signature, publicKey)
  }

  public isValidGetRequest(record: IRecord, shardId: string, replicationFactor: number) {
    const test = {
      valid: false,
      reason: <string> null
    }

    const shardMap = this.computeHostsforShards([shardId], replicationFactor)[0]

    // is this the right shard for request?
    if (shardMap.id !== shardId) {
      test.reason = 'Invalid get request, shard ids do not match'
      return test
    }

    // is the request valid
    const isValidRequest = this.isValidRequest(record, shardMap.hosts)
    if (!isValidRequest) {
      return isValidRequest
    }

    test.valid = true
    return test
  }

  public async isValidRevRequest(oldRecord: Record, newRecord: Record, contract: IContract, shardId: string, request: any) {
    const test = {
      valid: false,
      reason: <string> null,
      data: <number> null
    }

    // validate the update
    const isValidUpdate = oldRecord.isValidUpdate(oldRecord.value, newRecord.value)
    if (!isValidUpdate) {
      return isValidUpdate
    }

    const shardMap = this.getShardAndHostsForKey(newRecord.key, contract)
    // is this the right shard for request?
    if (shardMap.id !== shardId) {
      test.reason = 'Invalid get request, shard ids do not match'
      return test
    }

    // is the request valid
    const isValidRequest = this.isValidRequest(newRecord, shardMap.hosts)
    if (!isValidRequest) {
      return isValidRequest
    }

    // is valid operation for contract?
    const sizeDelta = oldRecord.getSize() - newRecord.getSize()
    const isValidContractOp = await this.isValidContractOp(newRecord, contract, shardMap.hosts, request, sizeDelta)
    if (!isValidContractOp.valid) {
      return isValidContractOp
    }

    test.valid = true
    test.data = sizeDelta
    return test
  }

  public async isValidDelRequest(record: Record, contract: IContract, shardId: string, request: any) {
    const test = {
      valid: false,
      reason: <string> null
    }

    const shardMap = this.getShardAndHostsForKey(record.key, contract)

    // is this the right shard for request?
    if (shardMap.id !== shardId) {
      test.reason = 'Invalid del request, shard ids do not match'
      return test
    }

    if (record.value.immutable) {
      test.reason = 'Invalid del request, cannot delete an immutable record'
      return test
    }

    // is the request valid
    const isValidRequest = this.isValidRequest(record, shardMap.hosts)
    if (!isValidRequest) {
      return isValidRequest
    }

    // is valid operation for contract?
    const isValidContractOp = await this.isValidContractOp(record, contract, shardMap.hosts, request)
    if (!isValidContractOp.valid) {
      return isValidContractOp
    }

    test.valid = true
    return test
  }

  // *********************
  // Shard CRUD operations
  // *********************
 
  public async createShard(shardId: string, contractId: string) {
    // add a new shard to shardMap
    const shard = {
      contract: contractId,
      size: 0,
      records: new Set()
    }
    this.shards.map.set(shardId, JSON.parse(JSON.stringify(shard)))
    await this.shards.save()
    return shard
  }

  public getShard(shardId: string) {
    return JSON.parse(JSON.stringify(this.shards.map.get(shardId)))
  }

  public async delShard(shardId: string) {
    const shard = this.getShard(shardId)
    this.shards.map.delete(shardId)
    for (const record of shard.records) {
      await this.storage.del(record)
    }
    await this.shards.save()
  } 

  public async putRecordInShard(shardId: string, record: Record) {
    // add a record to shard in shardMap
    const shard = this.shards.map.get(shardId)
    shard.size += record.getSize()
    shard.records.add(record.key)
    this.shards.map.set(shardId, JSON.parse(JSON.stringify(shard)))
    await this.shards.save()
  }

  public async revRecordInShard(shardId: string, sizeDelta: number) {
    // update a record for shard in shardMap
    const shard = this.shards.map.get(shardId)
    shard.size += sizeDelta
    await this.storage.put(shardId, JSON.stringify(shard))
    return shard
  }

  public async delRecordInShard(shardId: string, record: Record) {
    const shard = await this.getShard(shardId)
    shard.size -= record.getSize()
    shard.records.delete(shardId)
  }

  // **************************************
  // Shard <-> Key <-> Host mapping methods
  // **************************************

  public computeShardArray(contractId: string, spaceReserved: number) {
    // returns an array of shardIds for a contract
    let hash = contractId
    let shards: string[] = []
    const numberOfShards = spaceReserved / SHARD_SIZE
    if (numberOfShards % 1) {
      throw new Error('Incorrect contract size')
    }
    for (let i = 0; i < numberOfShards; i++) {
      hash = crypto.getHash(hash)
      shards.push(hash)
    }
    return shards
  }

  public computeShardForKey(key: string, spaceReserved: number) {
    // returns the correct shard number for a record given a key and a contract size
    // uses jump consistent hashing
    const hash = crypto.getHash64(key)
    const numberOfShards = spaceReserved / SHARD_SIZE
    if (numberOfShards % 1) {
      throw new Error('Incorrect contract size')
    }
    return jumpConsistentHash(hash, numberOfShards)
  }

  public getDestinations(): Destination[] {
    const profile = this.wallet.getProfile()
    return this.tracker
      .getAllHosts()
      .filter((entry: any) => entry.status && entry.publicKey !== profile.publicKey)
      .map((entry: any) => {
        return new Destination(
          crypto.getHash64(entry.hash),
          entry.pledge/PLEDGE_SIZE
        )
      })
  }

  public getHostFromId64(hostId64: Uint8Array) {
    return this.tracker
      .getAllHosts()
      .filter((entry: any) => entry.status && crypto.getHash64(entry.hash).toString('hex') === Buffer.from(hostId64).toString('hex'))
      .map((entry: any) => entry.hash)[0]
  }

  public computeHostsforShards(shardIds: string[], replicationFactor: number) {
    // returns the closest hosts for each shard based on replication factor and host pledge using weighted rendezvous hashing
    const destinations = this.getDestinations()
    return shardIds.map(shardId => {
      const hash = crypto.getHash64(shardId)
      const binaryHosts = pickDestinations(hash, destinations, replicationFactor)
      const stringHosts = binaryHosts.map(host => this.getHostFromId64(host))
      return {
        id: shardId,
        hosts: stringHosts,
      }
    })
  }

  public getShardAndHostsForKey(key: string, contract: IContract) {
    // return the correct hosts for a given key
    const shards = this.computeShardArray(contract.id, contract.spaceReserved)
    const shardIndex = this.computeShardForKey(key, contract.spaceReserved)
    const shard = shards[shardIndex]
    const shardMaps = this.computeHostsforShards(shards, contract.replicationFactor)
    return shardMaps.filter(shardMap => shardMap.id === shard)[0]
  }

  public getShardForKey(key: string, contract: IContract) {
    const shards = this.computeShardArray(contract.id, contract.spaceReserved)
    const shardIndex = this.computeShardForKey(key, contract.spaceReserved)
    return shards[shardIndex]
  }

  public getHosts(key: string, contract: IContract) {
    return this.getShardAndHostsForKey(key, contract).hosts
  }

  // public getContra

  // public getShardsForHost() {

  // }
}

export class Record {
  
  private _encoded = false
  private _encrypted = false
  constructor (private _key: string, private _value: IValue) {
    this._key = _key
    this._value = _value
  }

  // getters

  get key() {
    return this._key
  }

  get value() {
    return this._value
  }

  get encoded() {
    return this._encoded
  }

  get encrypted() {
    return this._encrypted
  }

  // static methods

  static async createImmutable(content: any, encrypted: boolean, publicKey: string, timestamped = true) {
    // creates and returns a new immutable record instance

    let symkey: string = null
    if (encrypted) {
      symkey = crypto.getRandom()
    }

    let timestamp: number = null
    if (timestamped) {
      timestamp = Date.now()
    }

    const value: IValue = {
      immutable: true,
      version: SCHEMA_VERSION,
      encoding: null,
      symkey: symkey,
      content: content,
      createdAt: timestamp
    }

    const record = new Record(null, value)
    await record.pack(publicKey)
    record.setKey()
    return record 
  }

  static async createMutable(content: any, encrypted: boolean, publicKey: string) {
    // creates and returns a new mutable record instance 

    let symkey: string = null
    if (encrypted) {
      symkey = crypto.getRandom()
    }

    const keys = await crypto.generateKeys(MUTABLE_KEY_NAME, MUTABLE_KEY_EMAIL, MUTABLE_KEY_PASSPRHASE)
    const privateKeyObject = await crypto.getPrivateKeyObject(keys.privateKeyArmored, MUTABLE_KEY_PASSPRHASE)

    const value: IValue = {
      immutable: false,
      version: SCHEMA_VERSION,
      encoding: null,
      symkey: symkey,
      content: content,
      createdAt: Date.now(),
      publicKey: keys.publicKeyArmored,
      privateKey: keys.privateKeyArmored,
      contentHash: null,
      revision: 0,
      updatedAt: null,
      recordSig: null
    }

    const record = new Record(null, value)
    await record.pack(publicKey, )
    record.setContentHash()
    await record.sign(privateKeyObject)
    record.setKey()
    return record
  }

  static readUnpacked(key: string, value: IValue) {
    // create a new unpacked record from data from disk or over the network
    const record = new Record(key, value)
    record._encoded = false
    record._encrypted = false
    return record
  }

  static readPacked(key: string, value: IValue) {
    // create a new packed record from data received from disk or over the network
    const record = new Record(key, value)
    record._encoded = true
    record._encrypted = true
    return record
  }

  // public methods

  public async update(update: any, profile: any) {
    // update an existing record stored on disk

    if (this._value.immutable) {
      throw new Error('Cannot update an immutable record')
    }

    await this.unpack(profile.privateKeyObject) 
    this._value.content = update
    const privateKeyObject = await crypto.getPrivateKeyObject(this._value.privateKey, MUTABLE_KEY_PASSPRHASE)
    await this.pack(profile.publicKey)
    this.setContentHash()
    this._value.revision += 1
    this._value.updatedAt = Date.now()
    await this.sign(privateKeyObject)
  }

  public async pack(publicKey: string) {
    this.encodeContent()
    await this.encrypt(publicKey)
  }

  public async unpack(privateKeyObject: any) {
    await this.decrypt(privateKeyObject)
    this.decodeContent()
  }

  public getSize() {
    return Buffer.from(JSON.stringify(this.getRecord())).byteLength
  }

  public getRecord() {
    // returns the encrypted, encoded record object
    return {
      key: this._key,
      value: JSON.parse(JSON.stringify(this._value))
    }
  }

  public async getContent(shardId: string, replicationFactor: number, privateKeyObject: any) {
    // returns the key and decrypted, decoded content
    await this.decrypt(privateKeyObject)
    this.decodeContent()
    return {
      key: `${this._key}:${shardId}:${replicationFactor}`,
      value: JSON.parse(JSON.stringify(this._value.content))
    }
  } 

  // move to crypto module

  public createPoR(nodeId: string) {
    // creates a mock Proof of Replication for a record from this node
    // proof should actually be created when the record is stored by a host, then fetched on get (not created)
    return crypto.getHash(JSON.stringify(this.getRecord()) + nodeId)
  }

  public isValidPoR(nodeId: string, proof: string) {
    // validates a Proof of Replicaiton from another node
    return proof === this.createPoR(nodeId)
  }

  public createPoD(nodeId: string) {
    // creates a mock Proof of Deletion for a record from this node
    return crypto.getHash(JSON.stringify(this.getRecord()) + nodeId)
  }

  public isValidPoD(nodeId: string, proof: string) {
    // validates a Proof of Deletion from another node
    return proof === this.createPoD(nodeId)  
  }

  public async isValid(sender?: string) {
    // validates the record schema and signatures

    const test = {
      valid: false,
      reason: <string> null
    }

    // *****************
    // Shared Properties
    // ***************** 

    // has valid encoding 
    if (! VALID_ENCODING.includes(this._value.encoding)) {
      test.reason = 'Invalid encoding format'
      return test
    }

    // has valid version
    if (this._value.version < 0) {
      test.reason = 'Invalid schema version'
      return test
    }


    // ********************
    // Immutable Properties
    // ********************

    if (this._value.immutable) {
      // is valid hash
      if (!this._value.symkey && !this._encoded) {
        await this.pack(null)
      }
      const validHash = crypto.isValidHash(this.key, JSON.stringify(this._value))
      if (!validHash) {
        test.reason = 'Immutable record hash does not match value'
        return test
      }

      if (!this._value.symkey) {
        await this.unpack(null)
      }
    }

    // ******************
    // Mutable Properties
    // ******************

    if (!this._value.immutable) {

      // timestamp is no more than 10 minutes in the future
      if (this._value.createdAt > (Date.now() + 60000)) {
        test.reason = 'Invalid record timestamp, greater than 10 minutes ahead'
        return test
      }

      // does the encrypted content value match the hash?
      const validHash = crypto.isValidHash(this._value.contentHash, JSON.stringify(this._value.content))
      if (!validHash) {
        test.reason = 'Mutable record content hash does not match content value'
        return test
      }

      // does the record signature match the record public key
      let unsignedValue = JSON.parse(JSON.stringify(this._value))
      unsignedValue.recordSig = null
      const validSignature = await crypto.isValidSignature(unsignedValue, this._value.recordSig, this._value.publicKey)

      if (!validSignature) {
        test.reason = 'Invalid mutable record signature'
        return test
      }
    }

    test.valid = true
    return test
  }

  public isValidUpdate(value: IValue, update: IValue) {

    const test = {
      valid: false,
      reason: <string> null
    }

    // version should be equal 
    if (value.version !== update.version) {
      test.reason = 'Versions do not match on mutation'
      return test 
    }

    // symkey should be equal 
    if (value.symkey !== update.symkey) {
      test.reason = 'Symkeys do not match on mutation'
      return test 
    }

    // new timestamp must be in the future 
    if (value.updatedAt >= update.updatedAt) {
      test.reason = 'Update timestamp cannot be older than original on mutation'
      return test 
    }

    // record publickey will be the same
    if (value.publicKey !== update.publicKey) {
      test.reason = 'Record public keys do not match on mutation'
      return test 
    }

    // record private key will be the same
    if (value.privateKey !== update.privateKey) {
      test.reason = 'Record private keys do not match on mutation'
      return test 
    } 

    // revision must be larger
    if (value.revision >= update.revision) {
      test.reason = 'Revision must be larger on mutation'
      return test 
    } 

    // record signature must be different
    if (value.recordSig === update.recordSig) {
      test.reason = 'Record signatures cannot match on mutation'
      return test 
    } 

    test.valid = true
    return test
  }

  // private methods

  private encodeContent() {
    // determine content and encoding and encode content as string

    if (this._encoded) {
      throw new Error ('Cannot encode content, it is already encoded')
    }

    const content = this._value.content
    switch(typeof content) {
      case('undefined'):
        throw new Error('Cannot create a record from content: undefined')
      case('string'):
        this._value.encoding = 'string'
        break
      case('number'):
        this._value.encoding = 'string'
        this._value.content = content.toString()
        break
      case('boolean'):
        this._value.encoding = 'string'
        this._value.content = content.toString()
        break
      case('object'):
        if (!content) { 
          this._value.encoding = 'null'
          this._value.content = JSON.stringify(content)
        } else if (Array.isArray(content)) {
          this._value.encoding = 'array'
          this._value.content = JSON.stringify(content)
        } else if (Buffer.isBuffer(content)) {
          this._value.encoding = 'buffer'
          this._value.content = content.toString()
        } else {
          this._value.encoding = 'object'
          this._value.content = JSON.stringify(content)
        }
        break
      default:
        throw new Error('Cannot create a record from content: unknown type')
    }  
    this._encoded = true   
  }

  private decodeContent() {

    if (!this._encoded) {
      throw new Error ('Cannot decode content, it is already decoded')
    }

    // convert string content back to original type based on encoding
    switch (this._value.encoding) {
      case 'null':
        this._value.content = null
        break
      case 'string':
        // no change
        break
      case 'number':
        this._value.content = Number(this._value.content)
        break
      case 'boolean':
        if (this._value.content === 'true') this._value.content = true
        else  this._value.content = false
        break
      case 'array':
        if (typeof(this._value.content === 'string')) {
          this._value.content = JSON.parse(this._value.content)
        }
        break
      case 'object':
        if (typeof(this._value.content === 'string')) {
          this._value.content = JSON.parse(this._value.content)
        }
        break
      case 'buffer':
        this._value.content = Buffer.from(this._value.content)
        break
      default:
        throw new Error('Unknown encoding, cannot decode')
    }

    this._encoded = false
  } 

  private async encrypt(publicKey: string, privateKey?: string) {

    if (this._encrypted) {
      throw new Error('Cannot encrypt record, it is already encrypted')
    }

    
    if (this._value.symkey) {
      // sym encrypt the content with sym key
      this._value.content = await crypto.encryptSymmetric(this._value.content, this._value.symkey)
      // asym encyrpt the sym key with node public key
      this._value.symkey = await crypto.encryptAssymetric(this._value.symkey, publicKey)
      
    }
    
    if (!this._value.immutable) {
      // asym encrypt the private record signing key with node public key
      this._value.privateKey = await crypto.encryptAssymetric(this._value.privateKey, publicKey)
    }

    this._encrypted = true
  }

  private async decrypt(privateKeyObject: any) {

    if (!this._encrypted) {
      throw new Error('Cannot decrypt record, it is already decrypted')
    }

    if (this._value.symkey) { // is an encrypted record
      // asym decrypt the symkey with node private key
      this._value.symkey = await crypto.decryptAssymetric(this._value.symkey, privateKeyObject)
      // sym decrypt the content with symkey 
      this._value.content = await crypto.decryptSymmetric(this._value.content, this._value.symkey)
    }

    if (!this._value.immutable) {
      // asym decyprt the record private key with node private key
      this._value.privateKey = await crypto.decryptAssymetric(this._value.privateKey, privateKeyObject)
    }

    this._encrypted = false
  }

  private async sign(privateKeyObject: any) {
    this._value.recordSig = null
    this._value.recordSig = await crypto.sign(this._value, privateKeyObject)
  }

  private setContentHash() {
    this._value.contentHash = crypto.getHash(this._value.content)
  }

  private setKey() {
    if (this._value.immutable) {
      this._key = crypto.getHash(JSON.stringify(this._value))
    } else {
      this._key = crypto.getHash(this._value.publicKey)
    }
  }
}
