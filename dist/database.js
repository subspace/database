"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = __importStar(require("@subspace/crypto"));
const jump_consistent_hash_1 = require("@subspace/jump-consistent-hash");
const rendezvous_hash_1 = require("@subspace/rendezvous-hash");
// ToDo
// later add patch method for unecrypted data
const VALID_ENCODING = ['null', 'string', 'number', 'boolean', 'array', 'object', 'buffer'];
const MUTABLE_KEY_NAME = 'key';
const MUTABLE_KEY_EMAIL = 'key@key.com';
const MUTABLE_KEY_PASSPRHASE = 'lockandkey';
const SCHEMA_VERSION = 0;
/**
 * Size of one shard in bytes (100M)
 */
exports.SHARD_SIZE = 100000000;
/**
 * Pledge size in bytes (100 shards or 10G)
 */
exports.PLEDGE_SIZE = exports.SHARD_SIZE * 100;
class DataBase {
    constructor(wallet, storage, tracker) {
        this.wallet = wallet;
        this.storage = storage;
        this.tracker = tracker;
        this.shards = {
            map: new Map(),
            save: async () => {
                await this.storage.put('shards', JSON.stringify([...this.shards.map]));
            },
            load: async () => {
                const shards = await this.storage.get('shards');
                if (shards) {
                    this.shards.map = new Map(JSON.parse(shards));
                }
                else {
                    this.shards.map = new Map();
                }
            }
        };
        this.shards.load();
    }
    // **********************
    // Record CRUD Operations
    // **********************
    async createRecord(content, encrypted) {
        // creates and saves a new record based on current default contract
        const profile = this.wallet.getProfile();
        const contract = this.wallet.getPrivateContract();
        let record;
        if (contract.ttl) {
            record = await MutableRecord.create(content, encrypted, profile.publicKey);
        }
        else {
            record = await ImmutableRecord.create(content, encrypted, profile.publicKey);
        }
        const recordData = record.getData();
        await this.storage.put(recordData.key, JSON.stringify(recordData.value));
        return record;
    }
    async loadMutableRecordFromDisk(key) {
        const stringValue = await this.storage.get(key);
        const value = JSON.parse(stringValue);
        const recordData = { key, value };
        const record = await MutableRecord.readPackedMutableRecord(recordData);
        return record;
    }
    async loadImmutableRecordFromDisk(key) {
        const stringValue = await this.storage.get(key);
        const value = JSON.parse(stringValue);
        const recordData = { key, value };
        const record = await ImmutableRecord.readPackedImmutableRecord(recordData);
        return record;
    }
    async loadRecordFromDisk(key) {
        // loads and returns an existing record instance on disk from a given key (from short key)
        const stringValue = await this.storage.get(key);
        const value = JSON.parse(stringValue);
        // if (!value.symkey) {
        //   // return plain text content to packed format
        //   value.content = JSON.stringify(value.content)
        // }
        const recordData = { key, value };
        const record = await Record.loadFromData(recordData);
        return record;
    }
    async loadRecordFromNetwork(recordData) {
        // loads and returns an existing record instance from a packed record received over the network
        const record = await Record.loadFromData(recordData);
        return record;
    }
    // need a simple save
    // need a simple delete
    async saveRecord(record, contract, update, sizeDelta) {
        // saves an encrypted, encoded record to disk locally, as a host
        const shardId = this.getShardForKey(record.key, contract);
        let shard = this.getShard(shardId);
        if (!shard) {
            shard = await this.createShard(shardId, contract.contractId);
        }
        if (update) {
            shard.size += sizeDelta;
        }
        else {
            shard.records.add(record.key);
            shard.size += record.getSize();
        }
        this.shards.map.set(shardId, JSON.parse(JSON.stringify(shard)));
        await this.shards.save();
        await this.storage.put(record.key, JSON.stringify(record.value));
    }
    async revRecord(key, update) {
        // loads an existing record instance from key, applies update, and returns instance, called by client
        const profile = this.wallet.getProfile();
        const record = await this.loadRecordFromDisk(key);
        if (record.isMutable()) {
            const newRecord = await MutableRecord.readPackedMutableRecord(record.getData());
            await newRecord.update(update, profile);
            await this.storage.put(record.key, JSON.stringify(record.value));
            return record;
        }
    }
    async delRecord(record, shardId) {
        // deletes an existing record from a key, for a host
        await this.storage.del(record.key);
        await this.delRecordInShard(shardId, record);
    }
    parseRecordKey(key) {
        const keys = key.split(':');
        const keyObject = {
            shardId: keys[0],
            recordId: keys[1],
            replicationFactor: Number(keys[2])
        };
        return keyObject;
    }
    // *********************************************
    // record request validation methods (for hosts)
    // *********************************************
    isValidRequest(record, hosts) {
        // is this a valid request message?
        const test = {
            valid: false,
            reason: null
        };
        if (record.value.type === 'mutable') {
            // is the timestamp within 10 minutes?
            if (!crypto.isDateWithinRange(record.value.createdAt, 60000)) {
                test.reason = 'Invalid request, timestamp is not within 10 minutes';
                return test;
            }
        }
        // am I the valid host for shard?
        const amValidHost = hosts.includes(this.wallet.profile.user.id);
        if (!amValidHost) {
            test.reason = 'Invalid contract request, sent to incorrect host';
            return test;
        }
        test.valid = true;
        return test;
    }
    async isValidContractOp(record, contract, shardMap, request, sizeDelta) {
        const test = {
            valid: false,
            reason: null
        };
        // has a valid contract tx been gossiped?
        if (!contract) {
            test.reason = 'Invalid contract request, unknown contract';
            return test;
        }
        // is the contract active
        if ((contract.createdAt + contract.ttl) < Date.now()) {
            test.reason = 'Invalid contract request, contract ttl has expired';
            return test;
        }
        // does record owner match contract owner
        // add ACL later
        // if (crypto.getHash(record.value.ownerKey) !== contract.owner) {
        //   test.reason = 'Invalid del request, contract does not match record contract'
        //   return test
        // }
        // is valid contract signature
        const unsignedValue = JSON.parse(JSON.stringify(request));
        unsignedValue.signature = null;
        const validSignature = await crypto.isValidSignature(unsignedValue, request.signature, request.contract.value.publicKey);
        if (!validSignature) {
            test.reason = 'Invalid contract request, incorrect signature';
            return test;
        }
        // does the shard have space available
        const shard = this.getShard(shardMap.id);
        if (shard) {
            if (sizeDelta) {
                if (!(shard.size + sizeDelta <= exports.SHARD_SIZE)) {
                    test.reason = 'Invalid contract request, this shard is out of space';
                    return test;
                }
            }
            else {
                if (!(shard.size + record.getSize() <= exports.SHARD_SIZE)) {
                    test.reason = 'Invalid contract request, this shard is out of space';
                    return test;
                }
            }
        }
        test.valid = true;
        return test;
    }
    async isValidPutRequest(record, contract, request) {
        // is this a valid put request message?
        const test = {
            valid: false,
            reason: null
        };
        const shardMap = this.getShardAndHostsForKey(record.key, contract);
        // is the request valid
        const isValidRequest = this.isValidRequest(record, shardMap.hosts);
        if (!isValidRequest) {
            return isValidRequest;
        }
        // is valid operation for contract?
        const isValidContractOp = await this.isValidContractOp(record, contract, shardMap.hosts, request);
        if (!isValidContractOp.valid) {
            return isValidContractOp;
        }
        test.valid = true;
        return test;
    }
    async isValidMutableContractRequest(txRecord, contractRecord) {
        // check that the signature in the tx matches the contract record public key
        const message = contractRecord.value.publicKey;
        const signature = txRecord.value.content.contractSig;
        const publicKey = contractRecord.value.publicKey;
        return await crypto.isValidSignature(message, signature, publicKey);
    }
    isValidGetRequest(record, shardId, replicationFactor) {
        const test = {
            valid: false,
            reason: null
        };
        const shardMap = this.computeHostsforShards([shardId], replicationFactor)[0];
        // is this the right shard for request?
        if (shardMap.id !== shardId) {
            test.reason = 'Invalid get request, shard ids do not match';
            return test;
        }
        // is the request valid
        const isValidRequest = this.isValidRequest(record, shardMap.hosts);
        if (!isValidRequest) {
            return isValidRequest;
        }
        test.valid = true;
        return test;
    }
    async isValidRevRequest(oldRecord, newRecord, contract, shardId, request) {
        const test = {
            valid: false,
            reason: null,
            data: null
        };
        // validate the update
        const isValidUpdate = oldRecord.isValidUpdate(oldRecord.value, newRecord.value);
        if (!isValidUpdate) {
            return isValidUpdate;
        }
        const shardMap = this.getShardAndHostsForKey(newRecord.key, contract);
        // is this the right shard for request?
        if (shardMap.id !== shardId) {
            test.reason = 'Invalid get request, shard ids do not match';
            return test;
        }
        // is the request valid
        const isValidRequest = this.isValidRequest(newRecord, shardMap.hosts);
        if (!isValidRequest) {
            return isValidRequest;
        }
        // is valid operation for contract?
        const sizeDelta = oldRecord.getSize() - newRecord.getSize();
        const isValidContractOp = await this.isValidContractOp(newRecord, contract, shardMap.hosts, request, sizeDelta);
        if (!isValidContractOp.valid) {
            return isValidContractOp;
        }
        test.valid = true;
        test.data = sizeDelta;
        return test;
    }
    async isValidDelRequest(record, contract, shardId, request) {
        const test = {
            valid: false,
            reason: null
        };
        const shardMap = this.getShardAndHostsForKey(record.key, contract);
        // is this the right shard for request?
        if (shardMap.id !== shardId) {
            test.reason = 'Invalid del request, shard ids do not match';
            return test;
        }
        if (record.value.type === 'immutable') {
            test.reason = 'Invalid del request, cannot delete an immutable record';
            return test;
        }
        // is the request valid
        const isValidRequest = this.isValidRequest(record, shardMap.hosts);
        if (!isValidRequest) {
            return isValidRequest;
        }
        // is valid operation for contract?
        const isValidContractOp = await this.isValidContractOp(record, contract, shardMap.hosts, request);
        if (!isValidContractOp.valid) {
            return isValidContractOp;
        }
        test.valid = true;
        return test;
    }
    // *********************
    // Shard CRUD operations
    // *********************
    async createShard(shardId, contractId) {
        // add a new shard to shardMap
        const shard = {
            contract: contractId,
            size: 0,
            records: new Set()
        };
        this.shards.map.set(shardId, JSON.parse(JSON.stringify(shard)));
        await this.shards.save();
        return shard;
    }
    getShard(shardId) {
        let shardCopy = null;
        const shard = this.shards.map.get(shardId);
        if (shard) {
            shardCopy = JSON.parse(JSON.stringify(shard));
        }
        return shardCopy;
    }
    async delShard(shardId) {
        const shard = this.getShard(shardId);
        this.shards.map.delete(shardId);
        for (const record of shard.records) {
            await this.storage.del(record);
        }
        await this.shards.save();
    }
    async putRecordInShard(shardId, record) {
        // add a record to shard in shardMap
        const shard = this.shards.map.get(shardId);
        shard.size += record.getSize();
        shard.records.add(record.key);
        this.shards.map.set(shardId, JSON.parse(JSON.stringify(shard)));
        await this.shards.save();
    }
    async revRecordInShard(shardId, sizeDelta) {
        // update a record for shard in shardMap
        const shard = this.shards.map.get(shardId);
        shard.size += sizeDelta;
        await this.storage.put(shardId, JSON.stringify(shard));
        return shard;
    }
    async delRecordInShard(shardId, record) {
        const shard = await this.getShard(shardId);
        shard.size -= record.getSize();
        shard.records.delete(shardId);
    }
    // **************************************
    // Shard <-> Key <-> Host mapping methods
    // **************************************
    computeShardArray(contractId, spaceReserved) {
        // returns an array of shardIds for a contract
        let hash = contractId;
        let shards = [];
        const numberOfShards = spaceReserved / exports.SHARD_SIZE;
        if (numberOfShards % 1) {
            throw new Error('Incorrect contract size');
        }
        for (let i = 0; i < numberOfShards; i++) {
            hash = crypto.getHash(hash);
            shards.push(hash);
        }
        return shards;
    }
    computeShardForKey(key, spaceReserved) {
        // returns the correct shard number for a record given a key and a contract size
        // uses jump consistent hashing
        const hash = crypto.getHash64(key);
        const numberOfShards = spaceReserved / exports.SHARD_SIZE;
        if (numberOfShards % 1) {
            throw new Error('Incorrect contract size');
        }
        return jump_consistent_hash_1.jumpConsistentHash(hash, numberOfShards);
    }
    getDestinations() {
        const profile = this.wallet.getProfile();
        return this.tracker
            .getAllHosts()
            .filter((entry) => entry.status && entry.publicKey !== profile.publicKey)
            .map((entry) => {
            return new rendezvous_hash_1.Destination(crypto.getHash64(crypto.getHash(entry.publicKey)), entry.pledge / exports.PLEDGE_SIZE);
        });
    }
    getHostFromId64(hostId64) {
        return this.tracker
            .getAllHosts()
            .filter((entry) => entry.status && crypto.getHash64(crypto.getHash(entry.publicKey)).toString('hex') === Buffer.from(hostId64).toString('hex'))
            .map((entry) => crypto.getHash(entry.publicKey))[0];
    }
    computeHostsforShards(shardIds, replicationFactor) {
        // returns the closest hosts for each shard based on replication factor and host pledge using weighted rendezvous hashing
        const destinations = this.getDestinations();
        return shardIds.map(shardId => {
            const hash = crypto.getHash64(shardId);
            const binaryHosts = rendezvous_hash_1.pickDestinations(hash, destinations, replicationFactor);
            const stringHosts = binaryHosts.map(host => this.getHostFromId64(host));
            return {
                id: shardId,
                hosts: stringHosts,
            };
        });
    }
    getShardAndHostsForKey(key, contract) {
        // return the correct hosts for a given key
        const shards = this.computeShardArray(contract.contractId, contract.spaceReserved);
        const shardIndex = this.computeShardForKey(key, contract.spaceReserved);
        const shard = shards[shardIndex];
        const shardMaps = this.computeHostsforShards(shards, contract.replicationFactor);
        return shardMaps.filter(shardMap => shardMap.id === shard)[0];
    }
    getShardForKey(key, contract) {
        const shards = this.computeShardArray(contract.contractId, contract.spaceReserved);
        const shardIndex = this.computeShardForKey(key, contract.spaceReserved);
        return shards[shardIndex];
    }
    getHosts(key, contract) {
        return this.getShardAndHostsForKey(key, contract).hosts;
    }
}
exports.DataBase = DataBase;
class Record {
    constructor() {
        this._isEncoded = false;
        this._isEncrypted = false;
    }
    get key() {
        return this._key;
    }
    get value() {
        return this._value;
    }
    set key(key) {
        this._key = key;
    }
    // static methods
    async init(content, encrypted, timestamped = true) {
        this._value = {
            type: null,
            version: SCHEMA_VERSION,
            encoding: null,
            symkey: null,
            content,
            createdAt: null
        };
        this.encodeContent();
        if (encrypted) {
            this._value.symkey = crypto.getRandom();
        }
        if (timestamped) {
            this._value.createdAt = Date.now();
        }
    }
    static async loadFromData(recordData, privateKeyObject) {
        if (recordData.value.type === 'immutable') {
            const immutableRecordData = recordData;
            return await ImmutableRecord.readPackedImmutableRecord(immutableRecordData, privateKeyObject);
        }
        else if (recordData.value.type === 'mutable') {
            const mutableRecordData = recordData;
            return await MutableRecord.readPackedMutableRecord(mutableRecordData, privateKeyObject);
        }
    }
    // public methods
    isMutable() {
        return this.value.type === 'mutable';
    }
    isImmutable() {
        return this.value.type === 'immutable';
    }
    getSize() {
        return Buffer.from(JSON.stringify(this.getData())).byteLength;
    }
    getData() {
        // returns the encrypted, encoded record object
        return {
            key: this._key,
            value: JSON.parse(JSON.stringify(this._value))
        };
    }
    async getContent(shardId, replicationFactor, privateKeyObject) {
        // returns the key and decrypted, decoded content
        return {
            key: `${this._key}:${shardId}:${replicationFactor}`,
            value: JSON.parse(JSON.stringify(this._value.content))
        };
    }
    async isValidRecord(sender) {
        // validates the record schema and signatures
        const test = {
            valid: false,
            reason: null
        };
        // has valid encoding
        if (!VALID_ENCODING.includes(this._value.encoding)) {
            test.reason = 'Invalid encoding format';
            return test;
        }
        // has valid version
        if (this._value.version < 0) {
            test.reason = 'Invalid schema version';
            return test;
        }
        return test;
    }
    // protected methods
    encodeContent() {
        // determine content and encoding and encode content as string
        if (this._isEncoded) {
            throw new Error('Cannot encode content, it is already encoded');
        }
        const content = this._value.content;
        switch (typeof content) {
            case ('undefined'):
                throw new Error('Cannot create a record from content: undefined');
            case ('string'):
                this._value.encoding = 'string';
                break;
            case ('number'):
                this._value.encoding = 'string';
                this._value.content = content.toString();
                break;
            case ('boolean'):
                this._value.encoding = 'string';
                this._value.content = content.toString();
                break;
            case ('object'):
                if (!content) {
                    this._value.encoding = 'null';
                    this._value.content = JSON.stringify(content);
                }
                else if (Array.isArray(content)) {
                    this._value.encoding = 'array';
                    this._value.content = JSON.stringify(content);
                }
                else if (Buffer.isBuffer(content)) {
                    this._value.encoding = 'buffer';
                    this._value.content = content.toString();
                }
                else {
                    this._value.encoding = 'object';
                    this._value.content = JSON.stringify(content);
                }
                break;
            default:
                throw new Error('Cannot create a record from content: unknown type');
        }
        this._isEncoded = true;
    }
    decodeContent() {
        if (!this._isEncoded) {
            throw new Error('Cannot decode content, it is already decoded');
        }
        // convert string content back to original type based on encoding
        switch (this._value.encoding) {
            case 'null':
                this._value.content = null;
                break;
            case 'string':
                // no change
                break;
            case 'number':
                this._value.content = Number(this._value.content);
                break;
            case 'boolean':
                if (this._value.content === 'true')
                    this._value.content = true;
                else
                    this._value.content = false;
                break;
            case 'array':
                if (typeof (this._value.content === 'string')) {
                    this._value.content = JSON.parse(this._value.content);
                }
                break;
            case 'object':
                if (typeof (this._value.content === 'string')) {
                    this._value.content = JSON.parse(this._value.content);
                }
                break;
            case 'buffer':
                this._value.content = Buffer.from(this._value.content);
                break;
            default:
                throw new Error('Unknown encoding, cannot decode');
        }
        this._isEncoded = false;
    }
    async encryptRecord(publicKey, privateKey) {
        if (this._isEncrypted) {
            throw new Error('Cannot encrypt record, it is already encrypted');
        }
        if (this._value.symkey) {
            // sym encrypt the content with sym key
            this._value.content = await crypto.encryptSymmetric(this._value.content, this._value.symkey);
            // asym encyrpt the sym key with node public key
            this._value.symkey = await crypto.encryptAssymetric(this._value.symkey, publicKey);
        }
    }
    async decryptRecord(privateKeyObject) {
        if (!this._isEncrypted) {
            throw new Error('Cannot decrypt record, it is already decrypted');
        }
        if (this._value.symkey) { // is an encrypted record
            // asym decrypt the symkey with node private key
            this._value.symkey = await crypto.decryptAssymetric(this._value.symkey, privateKeyObject);
            // sym decrypt the content with symkey
            this._value.content = await crypto.decryptSymmetric(this._value.content, this._value.symkey);
        }
    }
}
exports.Record = Record;
class ImmutableRecord extends Record {
    constructor() {
        super();
    }
    setKey() {
        this._key = crypto.getHash(JSON.stringify(this._value));
    }
    set value(value) {
        this._value = value;
    }
    static async create(content, encrypted, publicKey, timestamped = true) {
        const record = new ImmutableRecord();
        await record.init(content, encrypted, timestamped);
        record._value.type = 'immutable';
        await record.pack(publicKey);
        record.setKey();
        await record.unpack(publicKey);
        return record;
        // need a method and usage pattern for getting the entire object out
    }
    static async readPackedImmutableRecord(data, privateKeyObject) {
        let record = new ImmutableRecord();
        record.key = data.key;
        record.value = data.value;
        record._isEncoded = true;
        record._isEncrypted = true;
        await record.unpack(privateKeyObject);
        const test = await record.isValidRecord();
        if (!test.valid) {
            throw new Error(`Invalid immutable record data, ${test.reason}`);
        }
        return record;
    }
    async isValid(sender) {
        const test = await this.isValidRecord(sender);
        // is valid hash
        if (!this._value.symkey && !this._isEncoded) {
            await this.pack(null);
        }
        const validHash = crypto.isValidHash(this.key, JSON.stringify(this._value));
        if (!validHash) {
            test.reason = 'Immutable record hash does not match value';
            return test;
        }
        if (!this._value.symkey) {
            await this.unpack(null);
        }
        test.valid = true;
        return test;
    }
    async pack(publicKey) {
        this.encodeContent();
        await this.encrypt(publicKey);
    }
    async unpack(privateKeyObject) {
        await this.decrypt(privateKeyObject);
        this.decodeContent();
    }
    async encrypt(publicKey, privateKey) {
        await this.encryptRecord(publicKey, privateKey);
        this._isEncrypted = true;
    }
    async decrypt(privateKeyObject) {
        await this.decryptRecord(privateKeyObject);
        this._isEncrypted = false;
    }
}
exports.ImmutableRecord = ImmutableRecord;
class MutableRecord extends Record {
    constructor() {
        super();
    }
    setKey() {
        this._key = crypto.getHash(this._value.publicKey);
    }
    set value(value) {
        this._value = value;
    }
    static async create(content, encrypted, publicKey, timestamped = false) {
        const record = new MutableRecord();
        await record.init(content, encrypted, timestamped);
        record._value.type = 'mutable';
        const keys = await crypto.generateKeys(MUTABLE_KEY_NAME, MUTABLE_KEY_EMAIL, MUTABLE_KEY_PASSPRHASE);
        const privateKeyObject = await crypto.getPrivateKeyObject(keys.privateKeyArmored, MUTABLE_KEY_PASSPRHASE);
        record._value.publicKey = keys.publicKeyArmored;
        record._value.privateKey = keys.privateKeyArmored;
        record._value.revision = 0;
        await record.pack(publicKey);
        record.setContentHash();
        await record.sign(privateKeyObject);
        record.setKey();
        await record.unpack(publicKey);
        return record;
    }
    static async readPackedMutableRecord(data, privateKeyObject) {
        let record = new MutableRecord();
        record.key = data.key;
        record.value = data.value;
        record._isEncoded = true;
        record._isEncrypted = true;
        await record.unpack(privateKeyObject);
        const test = await record.isValidRecord();
        if (!test.valid) {
            throw new Error(`Invalid mutable record data, ${test.reason}`);
        }
        return record;
    }
    async update(update, profile) {
        this._value.content = update;
        const privateKeyObject = await crypto.getPrivateKeyObject(this._value.privateKey, MUTABLE_KEY_PASSPRHASE);
        await this.pack(profile.publicKey);
        this.setContentHash();
        this._value.revision += 1;
        this._value.updatedAt = Date.now();
        await this.sign(privateKeyObject);
    }
    setContentHash() {
        this._value.contentHash = crypto.getHash(this._value.content);
    }
    async sign(privateKeyObject) {
        this._value.recordSig = null;
        this._value.recordSig = await crypto.sign(this._value, privateKeyObject);
    }
    async isValid(sender) {
        const test = await this.isValidRecord(sender);
        // timestamp is no more than 10 minutes in the future
        if (this._value.createdAt > (Date.now() + 60000)) {
            test.reason = 'Invalid record timestamp, greater than 10 minutes ahead';
            return test;
        }
        // does the encrypted content value match the hash?
        const validHash = crypto.isValidHash(this._value.contentHash, JSON.stringify(this._value.content));
        if (!validHash) {
            test.reason = 'Mutable record content hash does not match content value';
            return test;
        }
        // does the record signature match the record public key
        let unsignedValue = JSON.parse(JSON.stringify(this._value));
        unsignedValue.recordSig = null;
        const validSignature = await crypto.isValidSignature(unsignedValue, this._value.recordSig, this._value.publicKey);
        if (!validSignature) {
            test.reason = 'Invalid mutable record signature';
            return test;
        }
        test.valid = true;
        return test;
    }
    isValidUpdate(value, update) {
        const test = {
            valid: false,
            reason: null
        };
        // version should be equal
        if (value.version !== update.version) {
            test.reason = 'Versions do not match on mutation';
            return test;
        }
        // symkey should be equal
        if (value.symkey !== update.symkey) {
            test.reason = 'Symkeys do not match on mutation';
            return test;
        }
        // new timestamp must be in the future
        if (value.updatedAt >= update.updatedAt) {
            test.reason = 'Update timestamp cannot be older than original on mutation';
            return test;
        }
        // record publickey will be the same
        if (value.publicKey !== update.publicKey) {
            test.reason = 'Record public keys do not match on mutation';
            return test;
        }
        // record private key will be the same
        if (value.privateKey !== update.privateKey) {
            test.reason = 'Record private keys do not match on mutation';
            return test;
        }
        // revision must be larger
        if (value.revision >= update.revision) {
            test.reason = 'Revision must be larger on mutation';
            return test;
        }
        // record signature must be different
        if (value.recordSig === update.recordSig) {
            test.reason = 'Record signatures cannot match on mutation';
            return test;
        }
        test.valid = true;
        return test;
    }
    async pack(publicKey) {
        this.encodeContent();
        await this.encrypt(publicKey);
    }
    async unpack(privateKeyObject) {
        await this.decrypt(privateKeyObject);
        this.decodeContent();
    }
    async encrypt(publicKey, privateKey) {
        await this.encryptRecord(publicKey, privateKey);
        // asym encrypt the private record signing key with node public key
        this._value.privateKey = await crypto.encryptAssymetric(this._value.privateKey, publicKey);
        this._isEncrypted = true;
    }
    async decrypt(privateKeyObject) {
        await this.decryptRecord(privateKeyObject);
        // asym decyprt the record private key with node private key
        this._value.privateKey = await crypto.decryptAssymetric(this._value.privateKey, privateKeyObject);
        this._isEncrypted = false;
    }
}
exports.MutableRecord = MutableRecord;
//# sourceMappingURL=database.js.map