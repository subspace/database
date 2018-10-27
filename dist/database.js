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
            map: null,
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
    async createImmutableRecord(content, encrypted, timestamped = true) {
        // create a new immutable record
        const profile = this.wallet.getProfile();
        let symkey = null;
        if (encrypted) {
            symkey = crypto.getRandom();
        }
        let timestamp = null;
        if (timestamped) {
            timestamp = Date.now();
        }
        const recordData = {
            immutable: true,
            version: SCHEMA_VERSION,
            encoding: null,
            symkey: symkey,
            content: content,
            createdAt: timestamp
        };
        const record = new Record(null, recordData);
        record.encodeContent();
        if (encrypted) {
            record.value.content = await crypto.encryptSymmetric(record.value.content, symkey);
            record.value.symkey = await crypto.encryptAssymetric(symkey, profile.publicKey);
        }
        record.setKey();
        return record;
    }
    async createMutableRecord(content, encrypted) {
        // create a new mutable record 
        const profile = this.wallet.getProfile();
        let symkey = null;
        if (encrypted) {
            symkey = crypto.getRandom();
        }
        const keys = await crypto.generateKeys(MUTABLE_KEY_NAME, MUTABLE_KEY_EMAIL, MUTABLE_KEY_PASSPRHASE);
        const privateKeyObject = await crypto.getPrivateKeyObject(keys.privateKeyArmored, MUTABLE_KEY_PASSPRHASE);
        const recordData = {
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
        };
        const record = new Record(null, recordData);
        record.encodeContent();
        if (encrypted) {
            record.value.content = await crypto.encryptSymmetric(record.value.content, symkey);
            record.value.symkey = await crypto.encryptAssymetric(symkey, profile.publicKey);
        }
        record.value.privateKey = await crypto.encryptAssymetric(keys.privateKeyArmored, profile.publicKey);
        record.value.contentHash = crypto.getHash(record.value.content);
        record.value.recordSig = await crypto.sign(record.value, privateKeyObject);
        record.setKey();
        return record;
    }
    async createRecord(content, encrypted) {
        // creates and saves a new record based on current default contract
        const contract = this.wallet.getContract();
        let record;
        if (contract.ttl) {
            record = await this.createMutableRecord(content, encrypted);
        }
        else {
            record = await this.createImmutableRecord(content, encrypted);
        }
        await this.storage.put(record.key, JSON.stringify(record.value));
        return record;
    }
    async getRecord(key) {
        // loads and returns an existing record instance on disk from a given key (from short key)
        const stringRecord = await this.storage.get(key);
        const record = new Record(key, JSON.parse(stringRecord));
        return record;
    }
    loadRecord(recordObject) {
        // loads and returns an existing record instance from an encoded record received over the network
        const record = new Record(recordObject.key, recordObject.value);
        return record;
    }
    async saveRecord(record, contract, update, sizeDelta) {
        // saves an encrypted, encoded record to disk locally, as a host
        const shardId = this.getShardForKey(record.key, contract);
        let shard = this.getShard(shardId);
        if (!shard) {
            shard = await this.createShard(shardId, contract.id);
        }
        if (update) {
            shard.size += sizeDelta;
        }
        else {
            shard.records.add(record.key);
            shard.size += record.getSize();
        }
        this.shards.map.set(shardId, shard);
        await this.shards.save();
        await this.storage.put(record.key, JSON.stringify(record.value));
    }
    async revRecord(key, update) {
        // loads an existing record instance from key, applies update, and returns instance, called by client
        const profile = this.wallet.getProfile();
        const record = await this.getRecord(key);
        await record.decrypt(profile.privateKeyObject);
        record.value.content = update;
        record.encodeContent();
        const privateKeyObject = await crypto.getPrivateKeyObject(record.value.privateKey, MUTABLE_KEY_PASSPRHASE);
        if (record.value.symkey) { // sym encrypt value and asym encrypt sym key
            record.value.content = await crypto.encryptSymmetric(record.value.content, record.value.symkey);
            record.value.symkey = await crypto.encryptAssymetric(record.value.symkey, profile.publicKey);
        }
        record.value.recordSig = null;
        record.value.contentHash = crypto.getHash(record.value.content);
        record.value.revision += 1;
        record.value.updatedAt = Date.now();
        record.value.privateKey = await crypto.encryptAssymetric(record.value.privateKey, profile.publicKey);
        record.value.recordSig = await crypto.sign(record.value, privateKeyObject);
        await this.storage.put(record.key, JSON.stringify(record.value));
        return record;
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
        // is the timestamp within 10 minutes?
        if (!crypto.isDateWithinRange(record.value.createdAt, 60000)) {
            test.reason = 'Invalid request, timestamp is not within 10 minutes';
            return test;
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
        const unsignedValue = Object.assign({}, request);
        unsignedValue.signature = null;
        const validSignature = await crypto.isValidSignature(unsignedValue, request.signature, request.contractKey);
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
    isValidGetRequest(record, contract, shardId) {
        const test = {
            valid: false,
            reason: null
        };
        const shardMap = this.getShardAndHostsForKey(record.key, contract);
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
        if (record.value.immutable) {
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
        this.shards.map.set(shardId, shard);
        await this.shards.save();
        return shard;
    }
    getShard(shardId) {
        return this.shards.map.get(shardId);
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
        this.shards.map.set(shardId, shard);
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
    computeShardArray(contract) {
        // returns an array of shardIds for a contract
        let hash = contract.id;
        let shards = [];
        const numberOfShards = contract.spaceReserved / exports.SHARD_SIZE;
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
        return this.tracker
            .getEntries()
            .map((entry) => {
            return new rendezvous_hash_1.Destination(crypto.getHash64(entry.hash), entry.pledge / exports.PLEDGE_SIZE);
        });
    }
    computeHostsforShards(shardIds, replicationFactor) {
        // returns the closest hosts for each shard based on replication factor and host pledge using weighted rendezvous hashing
        const destinations = this.getDestinations();
        return shardIds.map(shardId => {
            const hash = crypto.getHash64(shardId);
            const binaryHosts = rendezvous_hash_1.pickDestinations(hash, destinations, replicationFactor);
            const stringHosts = binaryHosts.map(host => (Buffer.from(host)).toString('hex'));
            return {
                id: shardId,
                hosts: stringHosts,
            };
        });
    }
    getShardAndHostsForKey(key, contract) {
        // return the correct hosts for a given key
        const shards = this.computeShardArray(contract);
        const shardIndex = this.computeShardForKey(key, contract.spaceReserved);
        const shard = shards[shardIndex];
        const shardMaps = this.computeHostsforShards(shards, contract.replicationFactor);
        return shardMaps.filter(shardMap => shardMap.id === shard)[0];
    }
    getShardForKey(key, contract) {
        const shards = this.computeShardArray(contract);
        const shardIndex = this.computeShardForKey(key, contract.spaceReserved);
        return shards[shardIndex];
    }
    getHosts(key, contract) {
        return this.getShardAndHostsForKey(key, contract).hosts;
    }
}
exports.DataBase = DataBase;
class Record {
    constructor(key = null, value = null) {
        this.key = key;
        this.value = value;
    }
    encodeContent() {
        // determine content and encoding and encode content as string
        const content = this.value.content;
        switch (typeof content) {
            case ('undefined'):
                throw new Error('Cannot create a record from content: undefined');
            case ('string'):
                this.value.encoding = 'string';
                break;
            case ('number'):
                this.value.encoding = 'string';
                this.value.content = content.toString();
                break;
            case ('boolean'):
                this.value.encoding = 'string';
                this.value.content = content.toString();
                break;
            case ('object'):
                if (!content) {
                    this.value.encoding = 'null';
                    this.value.content = JSON.stringify(content);
                }
                else if (Array.isArray(content)) {
                    this.value.encoding = 'array';
                    this.value.content = JSON.stringify(content);
                }
                else if (Buffer.isBuffer(content)) {
                    this.value.encoding = 'buffer';
                    this.value.content = content.toString();
                }
                else {
                    this.value.encoding = 'object';
                    this.value.content = JSON.stringify(content);
                }
                break;
            default:
                throw new Error('Cannot create a record from content: unknown type');
        }
    }
    decodeContent() {
        // convert string content back to original type based on encoding
        switch (this.value.encoding) {
            case 'null':
                this.value.content = null;
                break;
            case 'string':
                // no change
                break;
            case 'number':
                this.value.content = Number(this.value.content);
                break;
            case 'boolean':
                if (this.value.content === 'true')
                    this.value.content = true;
                else
                    this.value.content = false;
                break;
            case 'array':
                this.value.content = JSON.parse(this.value.content);
                break;
            case 'object':
                this.value.content = JSON.parse(this.value.content);
                break;
            case 'buffer':
                this.value.content = Buffer.from(this.value.content);
                break;
            default:
                throw new Error('Unknown encoding, cannot decode');
        }
    }
    // move to crypto module
    createPoR(nodeId) {
        // creates a mock Proof of Replication for a record from this node
        // proof should actually be created when the record is stored by a host, then fetched on get (not created)
        return crypto.getHash(JSON.stringify(this.getRecord()) + nodeId);
    }
    isValidPoR(nodeId, proof) {
        // validates a Proof of Replicaiton from another node
        return proof === this.createPoR(nodeId);
    }
    createPoD(nodeId) {
        // creates a mock Proof of Deletion for a record from this node
        return crypto.getHash(JSON.stringify(this) + nodeId);
    }
    isValidPoD(nodeId, proof) {
        // validates a Proof of Deletion from another node
        return proof === this.createPoD(nodeId);
    }
    async isValid(sender) {
        // validates the record schema and signatures
        const test = {
            valid: false,
            reason: null
        };
        // *****************
        // Shared Properties
        // ***************** 
        // has valid encoding 
        if (!VALID_ENCODING.includes(this.value.encoding)) {
            test.reason = 'Invalid encoding format';
            return test;
        }
        // has valid version
        if (this.value.version < 0) {
            test.reason = 'Invalid schema version';
            return test;
        }
        // timestamp is no more than 10 minutes in the future
        if (this.value.createdAt > (Date.now() + 60000)) {
            test.reason = 'Invalid record timestamp, greater than 10 minutes ahead';
            return test;
        }
        // ********************
        // Immutable Properties
        // ********************
        if (this.value.immutable) {
            // is valid hash
            const validHash = crypto.isValidHash(this.key, JSON.stringify(this.value));
            if (!validHash) {
                test.reason = 'Immutable record hash does not match value';
                return test;
            }
        }
        // ******************
        // Mutable Properties
        // ******************
        if (!this.value.immutable) {
            // does the encrypted content value match the hash?
            const validHash = crypto.isValidHash(this.value.contentHash, JSON.stringify(this.value.content));
            if (!validHash) {
                test.reason = 'Mutable record content hash does not match content value';
                return test;
            }
            // does the record signature match the record public key
            let unsignedValue = Object.assign({}, this.value);
            unsignedValue.recordSig = null;
            const validSignature = await crypto.isValidSignature(unsignedValue, this.value.recordSig, this.value.publicKey);
            if (!validSignature) {
                test.reason = 'Invalid mutable record signature';
                return test;
            }
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
    async decrypt(privateKeyObject) {
        if (this.value.symkey) { // is an encrypted record
            // asym decrypt the symkey with node private key
            this.value.symkey = await crypto.decryptAssymetric(this.value.symkey, privateKeyObject);
            // sym decrypt the content with symkey 
            this.value.content = await crypto.decryptSymmetric(this.value.content, this.value.symkey);
        }
        if (!this.value.immutable) {
            // asym decyprt the record private key with node private key
            this.value.privateKey = await crypto.decryptAssymetric(this.value.privateKey, privateKeyObject);
        }
    }
    setKey() {
        if (this.value.immutable) {
            this.key = crypto.getHash(JSON.stringify(this.value));
        }
        else {
            this.key = crypto.getHash(this.value.publicKey);
        }
    }
    getSize() {
        const record = {
            key: this.key,
            value: this.value
        };
        return Buffer.from(JSON.stringify(record)).byteLength;
    }
    getRecord() {
        // returns the encrypted, encoded record object
        return {
            key: this.key,
            value: this.value
        };
    }
    async getContent(shardId, replicationFactor, privateKeyObject) {
        // returns the key and decrypted, decoded content
        await this.decrypt(privateKeyObject);
        this.decodeContent();
        return {
            key: `${this.key}:${shardId}:${replicationFactor}`,
            value: this.value.content
        };
    }
    // later
    serialize() {
        // later, convert json object so streamlined binary based on encoding version
    }
    deserialize() {
        // later, conver binary data back to json object based on encoding version
    }
}
exports.Record = Record;
//# sourceMappingURL=database.js.map