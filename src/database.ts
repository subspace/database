import {ImmutableRecord, ImmutableValue, MutableRecord, MutableValue, Shard, ShardIndex, ShardMap} from './interfaces'
import * as crypto from '@subspace/crypto'
import {EventEmitter} from 'events'
import {jumpConsistentHash} from '@subspace/jump-consistent-hash'
import {Destination, pickDestinations} from '@subspace/rendezvous-hash'

/**
 * Size of one shard in bytes
 */
export const SHARD_SIZE = 100000000;

// ToDo
  // use sub-level-down to create a namespaced databases

export default class Database extends EventEmitter {
  constructor(
    private storage: any,
    private profile: any,
    private tracker: any,
  ) {
    super()
    this.storage.get('shards', (shards: string) => {
      if(!shards) {
        this.storage.put('shards', JSON.stringify([]))
      }
    })

  }

  private encodeValue(value: any) {
     // determine type and convert to string
    let encoding = null
    if (value === undefined) {
      // need to return an error
    } else if (value === null) {
      encoding = 'null',
      value = 'null'
    } else if (typeof value === 'string') {
      encoding = 'string'
    } else if (typeof value === 'number') {
      // reject NaN and infinity?
      encoding = 'number'
      value = value.toString()
    } else if (typeof value === 'boolean') {
      encoding = 'boolean'
      value = value.toString()
    } else if (Buffer.isBuffer(value)) {
      encoding = 'buffer'
      value = value.toString()
    } else if (typeof value === 'object' && Array.isArray(value)) {
      encoding = 'array'
      value = JSON.stringify(value)
    } else if (typeof value === 'object') {
      encoding = 'object'
      value = JSON.stringify(value)
    }

    return {
      encodedValue: value,
      encoding
    }
  }

  private decodeValue(encodedValue: string, encoding: string) {
     // convert string encodedValue back to original type

    let value = null
    switch (encoding) {
      case 'null':
        value = null
        break
      case 'string':
        value = encodedValue
        break
      case 'number':
        value = Number(encodedValue)
        break
      case 'boolean':
        if (encodedValue === 'true') value = true
        else value = false
        break
      case 'array':
        value = JSON.parse(encodedValue)
        break
      case 'object':
        value = JSON.parse(encodedValue)
        break
      case 'buffer':
        value = Buffer.from(encodedValue)
        break
    }

    return value
  }

  public async createImmutableRecord(value: any, contract: string): Promise<ImmutableRecord> {
    const { encodedValue, encoding } = this.encodeValue(value)
    const symkey = crypto.getRandom()
    const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey)
    const encryptedSymkey = await crypto.encryptAssymetric(symkey, this.profile.activeKeyPair.public_key_armored)

    const immutableRecord: ImmutableRecord = {
      key: null,
      value: {
        version: 0,
        encoding: encoding,
        symkey: encryptedSymkey,
        content: encryptedValue,
        owner: this.profile.user.hexId,
        contract: contract,
        timestamp: Date.now(),
        size: null
      }
    }

    // add the size of partial record, size integer, and detached signature
    const size = Buffer.byteLength(JSON.stringify(immutableRecord.value))
    const sizeOfSize = Buffer.byteLength(size.toString())
    immutableRecord.value.size = size + sizeOfSize + 96
    immutableRecord.key = crypto.getHash(JSON.stringify(immutableRecord.value))
    return immutableRecord
  }

  public async readImmutableRecord(record: ImmutableRecord): Promise<ImmutableRecord> {
    const valid = crypto.isValidHash(record.key, JSON.stringify(record.value))

    if (!valid) {
      throw new Error('Invalid hash for immutable record on read')
    }

    record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, this.profile.activeKeyPair.privateKeyObject)
    const encodedValue = await crypto.decryptSymmetric(record.value.content, record.value.symkey)
    record.value.content = this.decodeValue(encodedValue, record.value.encoding)
    return record
  }

  public async createMutableRecord(value: any, contract: string): Promise<MutableRecord> {
    const keys: any = await crypto.generateKeys(null)
    const symkey = crypto.getRandom()
    const { encodedValue, encoding } = this.encodeValue(value)
    const hash = crypto.getHash(encodedValue)
    const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey)
    const encryptedSymkey = await crypto.encryptAssymetric(symkey, keys.publicKeyArmored)
    const encryptedPrivkey = await crypto.encryptAssymetric(keys.privateKeyArmored, this.profile.activeKeyPair.public_key_armored)

    // init the record object
    const mutableRecord: MutableRecord = {
      key: null,
      value: {
        version: 0,
        encoding: encoding,
        symkey: encryptedSymkey,
        pubkey: keys.publicKeyArmored,
        privkey: encryptedPrivkey,
        content: encryptedValue,
        owner: this.profile.user.hexId,
        contract: contract,
        revision: 0,
        timestamp: Date.now(),
        size: null,
        contentHash: hash,
        signature: null
      }
    }

    // add the size of partial record, size integer, and detached signature
    const size = Buffer.byteLength(JSON.stringify(mutableRecord.value))
    const sizeOfSize = Buffer.byteLength(size.toString())
    mutableRecord.value.size = size + sizeOfSize + 96
    mutableRecord.value.signature = await crypto.sign(mutableRecord.value, mutableRecord.value.pubkey)

    return mutableRecord
  }

  public async readMutableRecord(record: MutableRecord): Promise<MutableRecord> {
    let unsignedValue = { ...record.value }
    unsignedValue.signature = null
    record.value.privkey = await crypto.decryptAssymetric(record.value.privkey, this.profile.activeKeyPair.privateKeyObject)
    const validSignature = await crypto.isValidSignature(unsignedValue, record.value.signature, record.value.privkey)
    if (!validSignature) {
      const sigError = new Error('Invalid signature for mutable record on read')
      reject(sigError)
    }

    const privateKeyObject = await crypto.getPrivateKeyObject(record.value.privkey, 'passphrase')
    record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, privateKeyObject)
    record.value.content = await crypto.decryptSymmetric(record.value.content, record.value.symkey)
    record.value.content = this.decodeValue(record.value.content, record.value.encoding)
    const validHash = crypto.isValidHash(record.value.contentHash, record.value.content)

    if (!validHash) {
      throw new Error('Invalid hash for mutable record')
    }

    return record
  }

  public async updateMutableRecord(update: any, record: MutableRecord): Promise<MutableRecord> {
    // assume the record is opened
    const { encodedValue, encoding } = this.encodeValue(update)
    const hash = crypto.getHash(encodedValue)
    const encryptedValue = await crypto.encryptSymmetric(encodedValue, record.value.symkey)
    const encryptedSymkey = await crypto.encryptAssymetric(record.value.symkey, record.value.pubkey)
    const encryptedPrivkey = await crypto.encryptAssymetric(record.value.privkey, this.profile.activeKeyPair.public_key_armored)

    record.value.encoding = encoding
    record.value.content = encryptedValue
    record.value.symkey = encryptedSymkey
    record.value.privkey = encryptedPrivkey
    record.value.contentHash = hash
    record.value.timestamp = Date.now()
    record.value.revision += 1

    const unsignedValue = { ...record.value }
    unsignedValue.signature = null
    record.value.signature = await crypto.sign(unsignedValue, record.value.pubkey)
    return record
  }

  public async put(record: MutableRecord | ImmutableRecord): Promise<void> {
    await this.storage.put(record.key, JSON.stringify(record.value))
  }

  public async get(key: string): Promise<MutableValue | ImmutableValue> {
    const stringValue = await this.storage.get(key)
    return JSON.parse(stringValue)
  }

  public async del(key: string): Promise<void> {
    // later implement full delete by rewriting garbage to the same location in memory
    await this.storage.del(key)
  }

  // how shards work
    // when a host receives receives the first put request for a contract it will not know about the contract
    // it will check the contract id against the ledger
    // compute the shards, and see if it is closest for any shards from the tracker

  public async createShardIndex(contract: any): Promise<ShardIndex> {
    const count = contract.reserved / SHARD_SIZE
    const shardIndex: ShardIndex = {
      contract: contract.id,
      size: contract.size,
      count: count,
      shards: []
    }

    let hash = contract.id

    for (let i = 0; i < count; i++) {
      hash = crypto.getHash(hash)
      shardIndex.shards.push(hash)
    }
    return shardIndex
  }

  public async createShard(shardId: string, contractId: string): Promise<Shard> {
    const shard: Shard = {
      id: shardId,
      contract: contractId,
      size: 0,
      records: []
    }

    const shards = JSON.parse( await this.storage.get('shards'))
    shards.push(shard.id)
    await this.storage.put('shards', JSON.stringify(shards))
    await this.storage.put(shardId, JSON.stringify(shard))
    return shard
  }

  public async getShard(shardId: string): Promise<Shard> {
    const stringShard = await this.storage.get(shardId)
    return JSON.parse(stringShard)
  }

  public async getAllShards(): Promise<string[]> {
    return JSON.parse(
      await this.storage.get('shards')
    )
  }

  public async addRecordToShard(shardId: string, record: MutableRecord | ImmutableRecord): Promise<Shard> {
    const shard = await this.getShard(shardId)
    shard.size += record.value.size
    shard.records.push(record.key)
    await this.storage.put(shard.id, JSON.stringify(shard))
    return shard
  }

  public async updateRecordInShard(shardId: string, sizeDelta: number): Promise<Shard> {
    const shard = await this.getShard(shardId)
    shard.size += sizeDelta
    await this.storage.put(shard.id, JSON.stringify(shard))
    return shard
  }

  public async removeRecordFromShard(shardId: string, record: MutableRecord | ImmutableRecord): Promise<Shard> {
    const shard = await this.getShard(shardId)
    shard.size -= record.value.size
    shard.records = shard.records.filter(r => r !== record.key)
    await this.storage.put(shard.id, JSON.stringify(shard))
    return shard
  }

  public async deleteShardAndRecords(shardId: string): Promise<void> {
    const shard = await this.getShard(shardId)
    shard.records.forEach(async record => {
      await this.storage.del(record)
    })
    await this.storage.del(shardId)
    let shards: string[] = JSON.parse( await this.storage.get('shards'))
    shards = shards.filter(shard => shard !== shardId)
    await this.storage.put('shards', JSON.stringify(shards))
  }

  public async getAllRecordKeys(): Promise<string[]> {
    let keys: string[] = []
    const shards = await this.getAllShards()
    for (const shardId of shards) {
      const shard = await this.getShard(shardId)
      keys.push(...shard.records)
    }
    return keys
  }

  public async getLengthOfAllRecords(): Promise<number> {
    const keys = await this.getAllRecordKeys()
    return keys.length
  }

  public async deleteAllShardsAndRecords(): Promise<void> {
    const shards = await this.getAllShards()
    shards.forEach(async shardId => {
      await this.deleteShardAndRecords(shardId)
    })
  }

  public computeShards(contractId: string, contractSize: number): string[] {
    // returns an array of shardIds for a contract
    let hash = contractId
    let shards: string[] = []
    const count = contractSize / SHARD_SIZE
    for (let i = 0; i < count; i++) {
      hash = crypto.getHash(hash)
      shards.push(hash)
    }
    return shards
  }

  public getDestinations(): Destination[] {
    return this.tracker
      .getEntries()
      .map((entry: any) => {
        return new Destination(
          crypto.getHash64(entry.hash),
          entry.pledge/10000000000)
      })
  }

  public computeHostsforShards(shardIds: string[], replicationFactor: number): ShardMap[] {
    // returns the closest hosts for each shard based on replication factor and host pledge using weighted rendezvous hashing
    const destinations = this.getDestinations()
    return shardIds.map(shardId => {
      const hash = crypto.getHash64(shardId)
      const binaryHosts = pickDestinations(hash, destinations, replicationFactor)
      const stringHosts = binaryHosts.map(host => (Buffer.from(host)).toString('hex'))
      return {
        id: shardId,
        hosts: stringHosts
      }
    })
  }

  public computeShardForKey(key: string, contractSize: number): number {
    // retuns the correct shard number for a record given a key and a contract size
    // uses jump consistent hashing
    const hash = crypto.getHash64(key)
    const buckets = contractSize / SHARD_SIZE
    return jumpConsistentHash(hash, buckets)
  }

  public computeHostsForKey(key: string, contractId: string, contractSize: number, replicationFactor: number): string[] {
    // return the correct hosts for a given key
    const shards = this.computeShards(contractId, contractSize)
    const shardIndex = this.computeShardForKey(key, contractSize)
    const shard = shards[shardIndex]
    const shardMaps = this.computeHostsforShards(shards, replicationFactor)
    const shardMapForKey = shardMaps.filter(shardMap => shardMap.id === shard)
    return shardMapForKey[0].hosts
  }
}

