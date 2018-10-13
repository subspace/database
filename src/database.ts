import * as I from './interfaces'
import * as crypto from '@subspace/crypto'
import { EventEmitter } from 'events'
import {jumpConsistentHash} from '@subspace/jump-consistent-hash'
import {Destination, pickDestinations} from '@subspace/rendezvous-hash'


// ToDo
  // use sub-level-down to create a namespaced databases

export default class Database extends EventEmitter {


  constructor(
    private storage: any,
    private profile: any,
    private tracker: any,
    public interfaces: any = I
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

  public createImmutableRecord(value: any, contract: string): Promise<I.ImmutableRecord> {
    return new Promise<I.ImmutableRecord> (async (resolve, reject) => {
      try {
        const { encodedValue, encoding } = this.encodeValue(value)
        const symkey = crypto.getRandom()
        const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey)
        const encryptedSymkey = await crypto.encryptAssymetric(symkey, this.profile.activeKeyPair.public_key_armored)

        const immutableRecord: I.ImmutableRecord = {
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
        resolve(immutableRecord)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public readImmutableRecord(record: I.ImmutableRecord): Promise<I.ImmutableRecord> {
    return new Promise<I.ImmutableRecord> (async (resolve, reject) => {
      try {

        const valid = crypto.isValidHash(record.key, JSON.stringify(record.value))

        if (!valid) {
          const error = new Error('Invalid hash for immutable record on read')
          reject(error)
        }

        record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, this.profile.activeKeyPair.privateKeyObject)
        const encodedValue = await crypto.decryptSymmetric(record.value.content, record.value.symkey)
        record.value.content = this.decodeValue(encodedValue, record.value.encoding)
        resolve(record)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public createMutableRecord(value: any, contract: string): Promise<I.MutableRecord> {
    return new Promise<I.MutableRecord> (async (resolve, reject) => {
      try {
        const keys: any = await crypto.generateKeys(null)
        const symkey = crypto.getRandom()
        const { encodedValue, encoding } = this.encodeValue(value)
        const hash = crypto.getHash(encodedValue)
        const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey)
        const encryptedSymkey = await crypto.encryptAssymetric(symkey, keys.publicKeyArmored)
        const encryptedPrivkey = await crypto.encryptAssymetric(keys.privateKeyArmored, this.profile.activeKeyPair.public_key_armored)

        // init the record object
        const mutableRecord: I.MutableRecord = {
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

        resolve(mutableRecord)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public readMutableRecord(record: I.MutableRecord): Promise<I.MutableRecord> {
    return new Promise<I.MutableRecord> (async (resolve, reject) => {
      try {

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
          let hashError = new Error('Invalid hash for mutable record')
          reject(hashError)
        }

        resolve(record)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public updateMutableRecord(update: any, record: I.MutableRecord): Promise<I.MutableRecord> {
    return new Promise<I.MutableRecord> (async (resolve, reject) => {
      try {
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
        resolve(record)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public put(record: I.MutableRecord | I.ImmutableRecord): Promise<void> {
    return new Promise<void> (async (resolve, reject) => {
      try {
        await this.storage.put(record.key, JSON.stringify(record.value))
        resolve()
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public get(key: string): Promise<I.MutableValue | I.ImmutableValue> {
    return new Promise<I.MutableValue | I.ImmutableValue> (async (resolve, reject) => {
      try {
        const stringValue = await this.storage.get(key)
        const value = JSON.parse(stringValue)
        resolve(value)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public del(key: string): Promise<void> {
    return new Promise<void> (async (resolve, reject) => {
      try {
        // later implement full delete by rewriting garbage to the same location in memory
        await this.storage.del(key)
        resolve()
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  // how shards work
    // when a host receives receives the first put request for a contract it will not know about the contract
    // it will check the contract id against the ledger
    // compute the shards, and see if it is closest for any shards from the tracker

  public createShardIndex(contract: any): Promise<I.ShardIndex> {
    return new Promise<I.ShardIndex> (async (resolve, reject) => {
      try {
        const count = contract.reserved / 100000000
        const shardIndex: I.ShardIndex = {
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
        resolve(shardIndex)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public createShard(shardId: string, contractId: string): Promise<I.Shard> {
    return new Promise<I.Shard> (async (resolve, reject) => {
      try {

        const shard: I.Shard = {
          id: shardId,
          contract: contractId,
          size: 0,
          records: []
        }

        const shards = JSON.parse( await this.storage.get('shards'))
        shards.push(shard.id)
        await this.storage.put('shards', JSON.stringify(shards))
        await this.storage.put(shardId, JSON.stringify(shard))
        resolve(shard)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public getShard(shardId: string): Promise<I.Shard> {
    return new Promise<I.Shard> (async (resolve, reject) => {
      try {
        const stringShard = await this.storage.get(shardId)
        const shard = JSON.parse(stringShard)
        resolve(shard)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public getAllShards(): Promise<string[]> {
    return new Promise<string[]> (async (resolve, reject) => {
      try {
        const shards = JSON.parse( await this.storage.get('shards'))
        resolve(shards)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public addRecordToShard(shardId: string, record: I.MutableRecord | I.ImmutableRecord): Promise<I.Shard> {
    return new Promise<I.Shard> (async (resolve, reject) => {
      try {
        const shard = await this.getShard(shardId)
        shard.size += record.value.size
        shard.records.push(record.key)
        await this.storage.put(shard.id, JSON.stringify(shard))
        resolve(shard)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public updateRecordInShard(shardId: string, sizeDelta: number): Promise<I.Shard> {
    return new Promise<I.Shard> (async (resolve, reject) => {
      try {
        const shard = await this.getShard(shardId)
        shard.size += sizeDelta
        await this.storage.put(shard.id, JSON.stringify(shard))
        resolve(shard)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public removeRecordFromShard(shardId: string, record: I.MutableRecord | I.ImmutableRecord): Promise<I.Shard> {
    return new Promise<I.Shard> (async (resolve, reject) => {
      try {
        const shard = await this.getShard(shardId)
        shard.size -= record.value.size
        shard.records = shard.records.filter(r => r !== record.key)
        await this.storage.put(shard.id, JSON.stringify(shard))
        resolve(shard)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public deleteShardAndRecords(shardId: string): Promise<void> {
    return new Promise<void> (async (resolve, reject) => {
      try {
        const shard = await this.getShard(shardId)
        shard.records.forEach(async record => {
          await this.storage.del(record)
        })
        await this.storage.del(shardId)
        let shards: string[] = JSON.parse( await this.storage.get('shards'))
        shards = shards.filter(shard => shard !== shardId)
        await this.storage.put('shards', JSON.stringify(shards))
        resolve()
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public getAllRecordKeys(): Promise<string[]> {
    return new Promise<string[]> (async (resolve, reject) => {
      try {
        let keys: string[] = []
        const shards = await this.getAllShards()
        shards.forEach(async shardId => {
          const shard = await this.getShard(shardId)
          keys = keys.concat(shard.records)
        })

        resolve(keys)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public getLengthOfAllRecords(): Promise<number> {
    return new Promise<number> (async (resolve, reject) => {
      try {
        const keys = await this.getAllRecordKeys()
        resolve(keys.length)
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public deleteAllShardsAndRecords(): Promise<void> {
    return new Promise<void> (async (resolve, reject) => {
      try {
        const shards = await this.getAllShards()
        shards.forEach(async shardId => {
          await this.deleteShardAndRecords(shardId)
        })
        resolve()
      }
      catch(error) {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  public computeShards(contractId: string, contractSize: number) {
    // returns an array of shardIds for a contract
    let hash = contractId
    let shards = []
    const count = contractSize / 100000000
    for (let i = 0; i < count; i++) {
      hash = crypto.getHash(hash)
      shards.push(hash)
    }
    return shards
  }

  public getDestinations() {
    const destinations: Destination[] = this.tracker
      .getEntries()
      .map((entry: any) => {
        new Destination(
          crypto.getHash64(entry.hash),
          entry.pledge/10000000000)
      })
    return destinations
  }

  public computeHostsforShards(shardIds: string[], replication: number) {
    // returns the closest hosts for each shard based on replication factor and host pledge using weighted rendezvous hashing
    const destinations = this.getDestinations()
    const shards: I.ShardMap[] = []
    shardIds.forEach(shardId => {
      const hash = crypto.getHash64(shardId)
      const binaryHosts = pickDestinations(hash, destinations, replication)
      const stringHosts = binaryHosts.map(host => (Buffer.from(host)).toString('hex'))
      const shard: I.ShardMap = {
        id: shardId,
        hosts: stringHosts
      }
      shards.push(shard)
    })
    return shards
  }

  public computeShardForKey(key: string, contractSize: number) {
    // retuns the correct shard number for a record given a key and a contract size
    // uses jump consistent hashing
    const hash = crypto.getHash64(key)
    const buckets = contractSize / 100000000
    return jumpConsistentHash(hash, buckets)
  }

  public computeHostsForKey(key: string, contractId: string, contractSize: number, replication: number) {
    // return the correct hosts for a given key
    const shards = this.computeShards(contractId, contractSize)
    const shardIndex = this.computeShardForKey(key, contractSize)
    const shard = shards[shardIndex]
    const shardMaps = this.computeHostsforShards(shards, replication)
    const shardMapForKey = shardMaps.filter(shardMap => shardMap.id === shard)
    return shardMapForKey[0].hosts
  }
}

