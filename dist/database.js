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
/**
 * Size of one shard in bytes (100M)
 */
exports.SHARD_SIZE = 100000000;
/**
 * Pledge size in bytes (100 shards or 10G)
 */
exports.PLEDGE_SIZE = exports.SHARD_SIZE * 100;
// ToDo
// use sub-level-down to create a namespaced databases
class Database {
    constructor(storage, wallet, tracker) {
        this.storage = storage;
        this.wallet = wallet;
        this.tracker = tracker;
        this.storage.get('shards', (shards) => {
            if (!shards) {
                this.storage.put('shards', JSON.stringify([]));
            }
        });
    }
    encodeValue(value) {
        // determine type and convert to string
        let encoding = null;
        if (value === undefined) {
            throw new Error('Cannot store an undefined value');
        }
        else if (value === null) {
            encoding = 'null',
                value = 'null';
        }
        else if (typeof value === 'string') {
            encoding = 'string';
        }
        else if (typeof value === 'number') {
            // reject NaN and infinity?
            encoding = 'number';
            value = value.toString();
        }
        else if (typeof value === 'boolean') {
            encoding = 'boolean';
            value = value.toString();
        }
        else if (Buffer.isBuffer(value)) {
            encoding = 'buffer';
            value = value.toString();
        }
        else if (typeof value === 'object' && Array.isArray(value)) {
            encoding = 'array';
            value = JSON.stringify(value);
        }
        else if (typeof value === 'object') {
            encoding = 'object';
            value = JSON.stringify(value);
        }
        else {
            throw new Error('Unknown value type, cannot encode');
        }
        return {
            encodedValue: value,
            encoding
        };
    }
    decodeValue(encodedValue, encoding) {
        // convert string encodedValue back to original type
        let value;
        switch (encoding) {
            case 'null':
                value = null;
                break;
            case 'string':
                value = encodedValue;
                break;
            case 'number':
                value = Number(encodedValue);
                break;
            case 'boolean':
                if (encodedValue === 'true')
                    value = true;
                else
                    value = false;
                break;
            case 'array':
                value = JSON.parse(encodedValue);
                break;
            case 'object':
                value = JSON.parse(encodedValue);
                break;
            case 'buffer':
                value = Buffer.from(encodedValue);
                break;
            default:
                throw new Error('Unknown encoding, cannot decode');
        }
        return value;
    }
    async createRecord(value, contract, encrypted) {
        let record;
        if (contract.ttl) { // mutable record
            record = await this.createImmutableRecord(value, contract, encrypted);
        }
        else { // immutable record
            record = await this.createMutableRecord(value, contract, encrypted);
        }
        return record;
    }
    setRecordType(record) {
        if (record.value.publickey) {
            record.type = 'mutable';
        }
        else {
            record.type = 'immutable';
        }
        const typedRecord = record;
        return typedRecord;
    }
    async readRecord(record) {
        // generic adapter for mutable and immutable reads
        // dont validate contract signature if this is not your record
        let contract = this.wallet.getContract();
        if (!(contract.id === record.value.contract)) {
            contract = null;
        }
        if (record.kind === 'immutable') {
            record = await this.readImmutableRecord(record, contract);
        }
        if (record.kind === 'mutable') {
            record = await this.readMutableRecord(record, contract);
        }
        return record;
    }
    async createImmutableRecord(value, contract, encrypted) {
        const profile = this.wallet.getProfile();
        const { encodedValue, encoding } = this.encodeValue(value);
        let symkey, content = null;
        if (encrypted) {
            symkey = crypto.getRandom();
            content = await crypto.encryptSymmetric(encodedValue, symkey);
            symkey = await crypto.encryptAssymetric(symkey, profile.publicKey);
        }
        else {
            content = encodedValue;
        }
        const immutableRecord = {
            kind: 'immutable',
            key: null,
            value: {
                version: 0,
                encoding: encoding,
                symkey: symkey,
                content: content,
                owner: profile.id,
                contract: contract.id,
                timestamp: Date.now(),
                size: null,
                contractSignature: null
            }
        };
        // add the size of partial record, size integer, detached signature, and key
        let pureImmutableRecord = Object.assign({}, immutableRecord);
        delete pureImmutableRecord.kind;
        const size = Buffer.from(JSON.stringify(pureImmutableRecord)).byteLength;
        const sizeOfSize = Buffer.from(size.toString()).byteLength;
        immutableRecord.value.size = size + sizeOfSize + 96 + 32;
        // sign with the contract private key
        immutableRecord.value.contractSignature = await crypto.sign(immutableRecord.value, contract.privateKeyObject);
        // hash the final value to get the key
        immutableRecord.key = crypto.getHash(JSON.stringify(immutableRecord.value));
        return immutableRecord;
    }
    async readImmutableRecord(record, contract) {
        const profile = this.wallet.getProfile();
        // is valid record?
        const recordTest = await this.isValidRecord(record, contract);
        if (!recordTest.valid) {
            throw new Error(recordTest.reason);
        }
        // is valid immutable record?
        const immutableTest = this.isValidImmutableRecord(record);
        if (!immutableTest.valid) {
            throw new Error(immutableTest.reason);
        }
        if (record.value.symkey) {
            record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, profile.publicKey);
            record.value.content = await crypto.decryptSymmetric(record.value.content, record.value.symkey);
        }
        record.value.content = this.decodeValue(record.value.content, record.value.encoding);
        return record;
    }
    async createMutableRecord(value, contract, encrypted) {
        const profile = this.wallet.getProfile();
        const keys = await crypto.generateKeys('keys', 'keys@keys.com', 'passphrase');
        const { encodedValue, encoding } = this.encodeValue(value);
        let symkey, content = null;
        if (encrypted) {
            symkey = crypto.getRandom();
            content = await crypto.encryptSymmetric(encodedValue, symkey);
            symkey = await crypto.encryptAssymetric(symkey, keys.publicKeyArmored);
        }
        else {
            content = encodedValue;
        }
        const contentHash = crypto.getHash(content);
        const encryptedPrivateKey = await crypto.encryptAssymetric(keys.privateKeyArmored, profile.publicKey);
        let contractId, contractPrivateKeyObject = null;
        if (contract) {
            // using an existing contract to create the record
            contractId = contract.id;
            contractPrivateKeyObject = contract.privateKeyObject;
        }
        else {
            // creating a new public contract record and contract
            contractId = crypto.getHash(keys.publicKeyArmored);
            contractPrivateKeyObject = await crypto.getPrivateKeyObject(keys.privateKeyArmored, 'passphrase');
        }
        // init the record object
        const mutableRecord = {
            kind: 'mutable',
            key: null,
            value: {
                version: 0,
                encoding: encoding,
                symkey: symkey,
                publicKey: keys.publicKeyArmored,
                privateKey: encryptedPrivateKey,
                content: content,
                owner: profile.id,
                contract: contractId,
                revision: 0,
                timestamp: Date.now(),
                size: null,
                contentHash: contentHash,
                recordSignature: null,
                contractSignature: null
            }
        };
        // add the size of partial record, size integer, detached signatures, and key
        let pureMutableRecord = Object.assign({}, mutableRecord);
        delete pureMutableRecord.kind;
        const size = Buffer.from(JSON.stringify(pureMutableRecord)).byteLength;
        const sizeOfSize = Buffer.from(size.toString()).byteLength;
        mutableRecord.value.size = size + sizeOfSize + 96 + 96;
        // sign the record with record key 
        const privateKeyObject = crypto.getPrivateKeyObject(keys.privateKeyArmored, 'passphrase');
        mutableRecord.value.recordSignature = await crypto.sign(mutableRecord.value, privateKeyObject);
        // sign the record with contract key
        mutableRecord.value.contractSignature = await crypto.sign(mutableRecord.value, contractPrivateKeyObject);
        return mutableRecord;
    }
    async readMutableRecord(record, contract) {
        const profile = this.wallet.getProfile();
        // is valid record?
        const recordTest = await this.isValidRecord(record, contract);
        if (!recordTest.valid) {
            throw new Error(recordTest.reason);
        }
        // is valid mutable record?
        const mutableTest = await this.isValidMutableRecord(record);
        if (!mutableTest.valid) {
            throw new Error(mutableTest.reason);
        }
        record.value.privateKey = await crypto.decryptAssymetric(record.value.privateKey, profile.privateKeyObject);
        const privateKeyObject = await crypto.getPrivateKeyObject(record.value.privateKey, 'passphrase');
        if (record.value.symkey) {
            record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, privateKeyObject);
            record.value.content = await crypto.decryptSymmetric(record.value.content, record.value.symkey);
        }
        record.value.content = this.decodeValue(record.value.content, record.value.encoding);
        return record;
    }
    async updateMutableRecord(update, record) {
        const contract = this.wallet.getContract();
        const profile = this.wallet.getProfile();
        const { encodedValue, encoding } = this.encodeValue(update);
        const privateKey = record.value.privateKey;
        // if encrypted, encrypt value
        if (record.value.symkey) {
            record.value.content = await crypto.encryptSymmetric(encodedValue, record.value.symkey);
            record.value.symkey = await crypto.encryptAssymetric(record.value.symkey, record.value.publicKey);
        }
        record.value.contentHash = crypto.getHash(record.value.content);
        record.value.privateKey = await crypto.encryptAssymetric(record.value.privateKey, profile.publicKey);
        record.value.encoding = encoding;
        record.value.timestamp = Date.now();
        record.value.revision += 1;
        record.value.recordSignature = null;
        record.value.contractSignature = null;
        // add the size of partial record, size integer, detached signatures
        const size = Buffer.from(JSON.stringify(record)).byteLength;
        const sizeOfSize = Buffer.from(size.toString()).byteLength;
        record.value.size = size + sizeOfSize + 96 + 96;
        // sign the record with record key 
        const privateKeyObject = crypto.getPrivateKeyObject(privateKey, 'passphrase');
        record.value.recordSignature = await crypto.sign(record.value, privateKeyObject);
        // sign the record with contract key
        record.value.contractSignature = await crypto.sign(record.value, contract.privateKeyObject);
        return record;
    }
    async isValidRecord(record, contract) {
        // timestamp is no more than 10 minutes in the future
        if (record.value.timestamp > (Date.now() + 60000)) {
            return {
                valid: false,
                reason: 'Invalid record timestamp, greater than 10 minutes ahead'
            };
        }
        // is valid size (w/in 10 bytes for now)
        let pureRecord = Object.assign({}, record);
        delete pureRecord.kind;
        const recordSize = Buffer.byteLength(JSON.stringify(pureRecord));
        if (recordSize > record.value.size + 10 || recordSize < record.value.size - 10) {
            return {
                valid: false,
                reason: 'Invalid record size'
            };
        }
        if (contract) {
            // is valid contract signature
            const unsignedValue = Object.assign({}, record.value);
            unsignedValue.contractSignature = null;
            const validSignature = await crypto.isValidSignature(unsignedValue, record.value.contractSignature, contract.publicKey);
            if (!validSignature) {
                return {
                    valid: false,
                    reason: 'Invalid contract signature'
                };
            }
        }
        return {
            valid: true,
            reason: null
        };
    }
    isValidImmutableRecord(record) {
        // is valid hash
        const validHash = crypto.isValidHash(record.key, JSON.stringify(record.value));
        if (!validHash) {
            return {
                valid: false,
                reason: 'Immutable record hash does not match value'
            };
        }
        return {
            valid: true,
            reason: null
        };
    }
    async isValidMutableRecord(record) {
        // does the encrypted content value match the hash?
        const validHash = crypto.isValidHash(record.value.contentHash, JSON.stringify(record.value.content));
        if (!validHash) {
            return {
                valid: false,
                reason: 'Mutable record content hash does not match content value'
            };
        }
        // does the record signature match the record public key
        let unsignedValue = Object.assign({}, record.value);
        unsignedValue.recordSignature = null;
        unsignedValue.contractSignature = null;
        const validSignature = await crypto.isValidSignature(unsignedValue, record.value.recordSignature, record.value.publicKey);
        if (!validSignature) {
            return {
                valid: false,
                reason: 'Invalid mutable record signature'
            };
        }
        return {
            valid: true,
            reason: null
        };
    }
    async isValidContractOperation(type, record, contract, sizeDelta) {
        // has a valid contract tx been gossiped?
        if (!contract) {
            return {
                valid: false,
                reason: 'Invalid contract request, unknown contract'
            };
        }
        // is the contract active?
        if ((contract.createdAt + contract.ttl) < Date.now()) {
            return {
                valid: false,
                reason: 'Invalid contract request, contract ttl has expired'
            };
        }
        // does the  owner match the contract, or are they on the ACL, later ...
        // am I the valid host for this contract?
        const shardMap = this.computeShardAndHostsForKey(record.key, record.value.contract, contract.replicationFactor, contract.spaceReserved);
        const amValidHost = shardMap.hosts.includes(this.wallet.profile.user.id);
        if (!amValidHost) {
            return {
                valid: false,
                reason: 'Invalid contract request, sent to incorrect host'
            };
        }
        // does the assigned shard have space available?
        const shard = await this.getShard(shardMap.id);
        if (shard) {
            if (type === 'put') {
                if (!(shard.size + record.value.size <= exports.SHARD_SIZE)) {
                    return {
                        valid: false,
                        reason: 'Invalid contract request, this shard is out of space'
                    };
                }
            }
            else if (type === 'rev') {
                if (!(shard.size + sizeDelta <= exports.SHARD_SIZE)) {
                    return {
                        valid: false,
                        reason: 'Invalid contract request, this shard is out of space'
                    };
                }
            }
        }
        return {
            valid: true,
            reason: null
        };
    }
    isValidMutation(value, update) {
        // version should be equal 
        if (value.version !== update.version) {
            return {
                valid: false,
                reason: 'Versions do not match on mutation'
            };
        }
        // symkey should be equal 
        if (value.symkey !== update.symkey) {
            return {
                valid: false,
                reason: 'Symkeys do not match on mutation'
            };
        }
        // owner should be equal 
        if (value.owner !== update.owner) {
            return {
                valid: false,
                reason: 'Owners do not match on mutation'
            };
        }
        // timestamp must be in the future 
        if (value.timestamp >= update.timestamp) {
            return {
                valid: false,
                reason: 'Update timestamp cannot be older than original on mutation'
            };
        }
        // contract should be the same 
        if (value.contract !== update.contract) {
            return {
                valid: false,
                reason: 'Contracts do not match on mutation'
            };
        }
        // publickey will be the same
        if (value.publicKey !== update.publicKey) {
            return {
                valid: false,
                reason: 'Public keys do not match on mutation'
            };
        }
        // private key will be the same
        if (value.privateKey !== update.privateKey) {
            return {
                valid: false,
                reason: 'Versions do not match on mutation'
            };
        }
        // revision must be larger
        if (value.revision >= update.revision) {
            return {
                valid: false,
                reason: 'Revision must be larger on mutation'
            };
        }
        // record signature must be different
        if (value.recordSignature === update.recordSignature) {
            return {
                valid: false,
                reason: 'Record signatures cannot match on mutation'
            };
        }
        // contract signature must be different 
        if (value.contractSignature !== update.contractSignature) {
            return {
                valid: false,
                reason: 'Contract signatures cannot match on mutation'
            };
        }
        return {
            valid: true,
            reason: null
        };
    }
    async isValidPutRequest(record, contract) {
        // is this request valid for the given contract
        const validContractOp = await this.isValidContractOperation('put', record, contract);
        if (!validContractOp) {
            return validContractOp;
        }
        // is the basic record encoding valid (size, contract signature, timestamp)
        const validRecord = await this.isValidRecord(record, contract);
        if (!validRecord) {
            return validRecord;
        }
        // is the timestamp within 10 minutes?
        if (crypto.isDateWithinRange(record.value.timestamp, 60000)) {
            return {
                valid: false,
                reason: 'Invalid put request, timestamp is not within 10 minutes'
            };
        }
        let validType;
        if (record.kind === 'mutable') {
            validType = await this.isValidMutableRecord(record);
        }
        if (record.kind === 'immutable') {
            validType = await this.isValidImmutableRecord(record);
        }
        if (!validType) {
            return validType;
        }
        return {
            valid: true,
            reason: null
        };
    }
    async isValidRevRequest(oldRecord, newRecord, contract) {
        // is this a valid mutation?
        const validMuatation = await this.isValidMutation(oldRecord.value, newRecord.value);
        if (!validMuatation) {
            return validMuatation;
        }
        // measure the size delta
        const sizeDelta = Buffer.from(JSON.stringify(newRecord)).byteLength - Buffer.from(JSON.stringify(oldRecord)).byteLength;
        // is this request valid for the given contract
        const validContractOp = await this.isValidContractOperation('rev', newRecord, contract, sizeDelta);
        if (!validContractOp) {
            return validContractOp;
        }
        // is the basic record encoding valid (size, contract signature, timestamp)
        const validRecord = await this.isValidRecord(newRecord, contract);
        if (!validRecord) {
            return validRecord;
        }
        // is the timestamp within 10 minutes?
        if (crypto.isDateWithinRange(newRecord.value.timestamp, 60000)) {
            return {
                valid: false,
                reason: 'Invalid rev request, timestamp is not within 10 minutes'
            };
        }
        if (newRecord.kind === 'mutable') {
            const validType = await this.isValidMutableRecord(newRecord);
            if (!validType) {
                return validType;
            }
        }
        return {
            valid: true,
            reason: null
        };
    }
    async isValidDelRequest(proof, record, contract) {
        // does contract id matches record contract id?
        if (proof.contract !== record.value.contract) {
            return {
                valid: false,
                reason: 'Invalid del request, contract does not match record contract'
            };
        }
        // does signature matches contract id?
        const unsignedProof = Object.assign({}, proof);
        unsignedProof.signature = null;
        const validSignature = await crypto.isValidSignature(JSON.stringify(unsignedProof), proof.signature, contract.publicKey);
        if (!validSignature) {
            return {
                valid: false,
                reason: 'Invalid del request, signature does not match record contract signature'
            };
        }
        // is it an immutable record?
        if (record.kind === 'immutable') {
            return {
                valid: false,
                reason: 'Invalid del request, cannot delete an immutable record'
            };
        }
        // is the timestamp within 10 minutes?
        if (crypto.isDateWithinRange(proof.timestamp, 60000)) {
            return {
                valid: false,
                reason: 'Invalid del request, timestamp is not within 10 minutes'
            };
        }
        return {
            valid: true,
            reason: null
        };
    }
    createProofOfReplication(record, nodeId) {
        return crypto.getHash(JSON.stringify(record) + nodeId);
    }
    isValidProofOfReplicaiton(proof, record, nodeId) {
        return proof === this.createProofOfReplication(record, nodeId);
    }
    async put(record) {
        await this.storage.put(record.key, JSON.stringify(record.value));
    }
    async get(key) {
        const stringValue = await this.storage.get(key);
        return JSON.parse(stringValue);
    }
    async del(key) {
        // later implement full delete by rewriting garbage to the same location in memory
        await this.storage.del(key);
    }
    // how shards work
    // when a host receives receives the first put request for a contract it will not know about the contract
    // it will check the contract id against the ledger
    // compute the shards, and see if it is closest for any shards from the tracker
    async createShardIndex(contract) {
        const count = contract.reserved / exports.SHARD_SIZE;
        const shardIndex = {
            contract: contract.id,
            size: contract.size,
            count: count,
            shards: []
        };
        let hash = contract.id;
        for (let i = 0; i < count; i++) {
            hash = crypto.getHash(hash);
            shardIndex.shards.push(hash);
        }
        return shardIndex;
    }
    async getOrCreateShard(shardId, contractId) {
        const stringShard = await this.storage.get('shard');
        let shard;
        if (stringShard) {
            shard = JSON.parse(stringShard);
        }
        else {
            shard = await this.createShard(shardId, contractId);
        }
        return shard;
    }
    async createShard(shardId, contractId) {
        const shard = {
            id: shardId,
            contract: contractId,
            size: 0,
            records: []
        };
        const shards = JSON.parse(await this.storage.get('shards'));
        shards.push(shard.id);
        await this.storage.put('shards', JSON.stringify(shards));
        await this.storage.put(shardId, JSON.stringify(shard));
        return shard;
    }
    async getShard(shardId) {
        const stringShard = await this.storage.get(shardId);
        if (stringShard) {
            return JSON.parse(stringShard);
        }
        else {
            return null;
        }
    }
    async getAllShards() {
        return JSON.parse(await this.storage.get('shards'));
    }
    async addRecordToShard(shardId, record) {
        const shard = await this.getShard(shardId);
        shard.size += record.value.size;
        shard.records.push(record.key);
        await this.storage.put(shard.id, JSON.stringify(shard));
        return shard;
    }
    async updateRecordInShard(shardId, sizeDelta) {
        const shard = await this.getShard(shardId);
        shard.size += sizeDelta;
        await this.storage.put(shard.id, JSON.stringify(shard));
        return shard;
    }
    async removeRecordFromShard(shardId, record) {
        const shard = await this.getShard(shardId);
        shard.size -= record.value.size;
        shard.records = shard.records.filter(r => r !== record.key);
        await this.storage.put(shard.id, JSON.stringify(shard));
        return shard;
    }
    async deleteShardAndRecords(shardId) {
        const shard = await this.getShard(shardId);
        shard.records.forEach(async (record) => {
            await this.storage.del(record);
        });
        await this.storage.del(shardId);
        let shards = JSON.parse(await this.storage.get('shards'));
        shards = shards.filter(shard => shard !== shardId);
        await this.storage.put('shards', JSON.stringify(shards));
    }
    async getAllRecordKeys() {
        let keys = [];
        const shards = await this.getAllShards();
        for (const shardId of shards) {
            const shard = await this.getShard(shardId);
            keys.push(...shard.records);
        }
        return keys;
    }
    async getLengthOfAllRecords() {
        const keys = await this.getAllRecordKeys();
        return keys.length;
    }
    async deleteAllShardsAndRecords() {
        const shards = await this.getAllShards();
        shards.forEach(async (shardId) => {
            await this.deleteShardAndRecords(shardId);
        });
    }
    computeShards(contractId, contractSize) {
        // returns an array of shardIds for a contract
        let hash = contractId;
        let shards = [];
        const numberOfShards = contractSize / exports.SHARD_SIZE;
        if (numberOfShards % 1) {
            throw new Error('Incorrect contract size');
        }
        for (let i = 0; i < numberOfShards; i++) {
            hash = crypto.getHash(hash);
            shards.push(hash);
        }
        return shards;
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
    isValidShardForKey(key, shardId, contractId) {
        // compute the shards 
    }
    computeShardForKey(key, contractSize) {
        // returns the correct shard number for a record given a key and a contract size
        // uses jump consistent hashing
        const hash = crypto.getHash64(key);
        const numberOfShards = contractSize / exports.SHARD_SIZE;
        if (numberOfShards % 1) {
            throw new Error('Incorrect contract size');
        }
        return jump_consistent_hash_1.jumpConsistentHash(hash, numberOfShards);
    }
    computeShardAndHostsForKey(key, contractId, contractSize, replicationFactor) {
        // return the correct hosts for a given key
        const shards = this.computeShards(contractId, contractSize);
        const shardIndex = this.computeShardForKey(key, contractSize);
        const shard = shards[shardIndex];
        const shardMaps = this.computeHostsforShards(shards, replicationFactor);
        return shardMaps.filter(shardMap => shardMap.id === shard)[0];
    }
    parseKey(key) {
        const keys = key.split(':');
        const keyObject = {
            shardId: keys[0],
            recordId: keys[1],
            replicationFactor: Number(keys[2])
        };
        return keyObject;
    }
}
exports.default = Database;
//# sourceMappingURL=database.js.map