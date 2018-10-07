import * as interfaces from './interfaces'
import * as crypto from '@subspace/crypto'
import { EventEmitter } from 'events'


export default class Database extends EventEmitter {

  storage: any
  profile: any

  constructor(storage: any, profile: any) {
    super()
    this.storage = storage
    this.profile = profile
  }

  async init() {
    try {
      return 
    }
    catch(error) {
      console.log('An error occcured')
      console.log(error)
      this.emit('error', error)
      return error
    }
  } 

   encodeValue(value: any) {
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
    } else if (typeof value === 'object' && value.isArray()) {
      encoding = 'array'
      value = value.toString()
    } else if (typeof value === 'object') {
      encoding = 'object'
      value = JSON.stringify(value)
    } else if (value.isBuffer()) {
      encoding = 'buffer'
      value = value.toString()
    }

    return { 
      encodedValue: value,
      encoding 
    }
  }

   decodeValue(encodedValue: string, encoding: string) {
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
        value = Array.from(encodedValue)
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

  async createImmutableRecord(value: any, contract: string) {
    try {

      const { encodedValue, encoding } = this.encodeValue(value)
      const symkey = crypto.getRandom()
      const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey)
      const encryptedSymkey = await crypto.encryptAssymetric(symkey, this.profile.activeKeyPair.public_key_armored)

      const immutableRecord: interfaces.immutableRecord = {
        key: null,
        value: {
          version: '0.0.1',
          encoding: encoding,
          symkey: encryptedSymkey,
          content: encryptedValue,
          owner: this.profile.user.hexId,
          contract: contract, 
          timestamp: Date.now()
        }
      }

      immutableRecord.key = crypto.getHash(JSON.stringify(immutableRecord.value))

      return immutableRecord
    }
    catch(error) {
      console.log('Error creating immutable record')
      console.log(error)
      this.emit('error', error)
      return error
    }
  }

  async readImmutableRecord(record: interfaces.immutableRecord) {
    try {
      const valid = crypto.isValidHash(record.key, JSON.stringify(record.value))

      if (!valid) {
        // throw error
        return
      }

      record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, this.profile.activeKeyPair.privateKeyObject)

      const encodedValue = await crypto.decryptSymmetric(record.value.content, record.value.symkey)

      record.value.content = this.decodeValue(encodedValue, record.value.encoding)

      return record
    }
    catch(error) {
      console.log('Error reading immutable record')
      console.log(error)
      this.emit('error', error)
      return error
    }
  }

  async createMutableRecord(value: any, contract: string) {
    try {

      const keys: any = await crypto.generateKeys(null)
      const symkey = crypto.getRandom()
      const { encodedValue, encoding } = this.encodeValue(value)
      const hash = crypto.getHash(encodedValue)
      const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey)
      const encryptedSymkey = await crypto.encryptAssymetric(symkey, keys.publicKeyArmored)
      const encryptedPrivkey = await crypto.encryptAssymetric(keys.privateKeyArmored, this.profile.activeKeyPair.public_key_armored)

      // init the record object 
      const mutableRecord: interfaces.mutableRecord = {
        key: null,
        value: {
          version: '0.0.1',
          encoding: encoding,
          symkey: encryptedSymkey,
          pubkey: keys.publicKeyArmored,
          privkey: encryptedPrivkey, 
          content: encryptedValue,
          owner: this.profile.user.hexId,
          contract: contract, 
          revision: 0,
          timestamp: Date.now(),
          contentHash: hash,
          signature: null
        }
      }

      mutableRecord.value.signature = await crypto.sign(mutableRecord.value, mutableRecord.value.pubkey)

      return mutableRecord
    }
    catch(error) {
      console.log('Error creating mutable occcured')
      console.log(error)
      this.emit('error', error)
      return error
    }
  }

  async readMutableRecord(record: interfaces.mutableRecord) {
    try {

      let unsignedValue = { ...record.value }
      unsignedValue.signature = null

      record.value.privkey = await crypto.decryptAssymetric(record.value.privkey, this.profile.activeKeyPair.privateKeyObject)

      const validSignature = await crypto.isValidSignature(unsignedValue, record.value.signature, record.value.privkey)
      if (!validSignature) {
        // throw an error
        return
      }

      const privateKeyObject = await crypto.getPrivateKeyObject(record.value.privkey, 'passphrase')

      record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, privateKeyObject)

      record.value.content = await crypto.decryptSymmetric(record.value.content, record.value.symkey)

      record.value.content = this.decodeValue(record.value.content, record.value.encoding)

      let validHash = crypto.isValidHash(record.value.contentHash, record.value.content)

      if (!validHash) {
        // throw error
        return
      }

      return record
    }
    catch(error) {
      console.log('Error reading mutable record')
      console.log(error)
      this.emit('error', error)
      return error
    }
  }

  async updateMutableRecord(update: any, record: interfaces.mutableRecord) {
    try {
      // eventually apply patches for large objects 
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
    catch(error) {
      console.log('Error updating mutable record')
      console.log(error)
      this.emit('error', error)
      return error
    }
  }

  async put() {
    // make a put request to the network 
      // encode some data
      // compute the shard
      // compute the hosts for this shard 
      // send the request
      // wait for the confirmation 
      // adjust your view of contract state 

      // should I store a decrypted copy locally?

    try {
      return 
    }
    catch(error) {
      console.log('An error occcured')
      console.log(error)
      this.emit('error', error)
      return error
    }
  }

  async get() {
    // make a get request to the network
    // compute the shard id 
    // find the hosts who have the shard
    // request all replicas
    // validate unique encoding for each replica 
    // decode each replica
    // compare replica state
    // return the record

    try {
      return 
    }
    catch(error) {
      console.log('An error occcured')
      console.log(error)
      this.emit('error', error)
      return error
    }
  }

  async update() {
    // optional mutate an existing object instead of creating a new one 
  }

  async delete() {
    // remove an object from subspace 
  }

  async onPut() {
    // respond to a put request from another node

    // valide the reqeust
      // contract
      // record signature
      // owner signature 


    // encode a unique replica of the data 

    // store to disk 

    // send a confirmation 

    // adjust the local contract state 
  }

  async onGet() {
    // respond to a get request from another node 

    // get the data from disk

    // send a reply

  }

  async onUpdate() {
    // update an existing record you are holding for a contract
  }

  async onDelete() {
    // delate a record you are holding for a contract
  }

  async getKeys() {
    // get an array of all keys you are holding
  }

  async getValues() {
    // get an array of all values you are holding (why?)
  }

  async getLength() {
    // get the number of records you are holding
  }

  async clear() {
    // clear all records you are storing (why?)
  }


}

