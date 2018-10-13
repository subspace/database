"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const I = __importStar(require("./interfaces"));
const crypto = __importStar(require("@subspace/crypto"));
const events_1 = require("events");
// ToDo
// use sub-level-down to create a namespaced databases
class Database extends events_1.EventEmitter {
    constructor(storage, profile) {
        super();
        this.interfaces = I;
        this.storage = storage;
        this.profile = profile;
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
            // need to return an error 
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
        return {
            encodedValue: value,
            encoding
        };
    }
    decodeValue(encodedValue, encoding) {
        // convert string encodedValue back to original type  
        let value = null;
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
        }
        return value;
    }
    createImmutableRecord(value, contract) {
        return new Promise(async (resolve, reject) => {
            try {
                const { encodedValue, encoding } = this.encodeValue(value);
                const symkey = crypto.getRandom();
                const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey);
                const encryptedSymkey = await crypto.encryptAssymetric(symkey, this.profile.activeKeyPair.public_key_armored);
                const immutableRecord = {
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
                };
                // add the size of partial record, size integer, and detached signature
                const size = Buffer.byteLength(JSON.stringify(immutableRecord.value));
                const sizeOfSize = Buffer.byteLength(size.toString());
                immutableRecord.value.size = size + sizeOfSize + 96;
                immutableRecord.key = crypto.getHash(JSON.stringify(immutableRecord.value));
                resolve(immutableRecord);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    readImmutableRecord(record) {
        return new Promise(async (resolve, reject) => {
            try {
                const valid = crypto.isValidHash(record.key, JSON.stringify(record.value));
                if (!valid) {
                    const error = new Error('Invalid hash for immutable record on read');
                    reject(error);
                }
                record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, this.profile.activeKeyPair.privateKeyObject);
                const encodedValue = await crypto.decryptSymmetric(record.value.content, record.value.symkey);
                record.value.content = this.decodeValue(encodedValue, record.value.encoding);
                resolve(record);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    createMutableRecord(value, contract) {
        return new Promise(async (resolve, reject) => {
            try {
                const keys = await crypto.generateKeys(null);
                const symkey = crypto.getRandom();
                const { encodedValue, encoding } = this.encodeValue(value);
                const hash = crypto.getHash(encodedValue);
                const encryptedValue = await crypto.encryptSymmetric(encodedValue, symkey);
                const encryptedSymkey = await crypto.encryptAssymetric(symkey, keys.publicKeyArmored);
                const encryptedPrivkey = await crypto.encryptAssymetric(keys.privateKeyArmored, this.profile.activeKeyPair.public_key_armored);
                // init the record object 
                const mutableRecord = {
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
                };
                // add the size of partial record, size integer, and detached signature
                const size = Buffer.byteLength(JSON.stringify(mutableRecord.value));
                const sizeOfSize = Buffer.byteLength(size.toString());
                mutableRecord.value.size = size + sizeOfSize + 96;
                mutableRecord.value.signature = await crypto.sign(mutableRecord.value, mutableRecord.value.pubkey);
                resolve(mutableRecord);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    readMutableRecord(record) {
        return new Promise(async (resolve, reject) => {
            try {
                let unsignedValue = Object.assign({}, record.value);
                unsignedValue.signature = null;
                record.value.privkey = await crypto.decryptAssymetric(record.value.privkey, this.profile.activeKeyPair.privateKeyObject);
                const validSignature = await crypto.isValidSignature(unsignedValue, record.value.signature, record.value.privkey);
                if (!validSignature) {
                    const sigError = new Error('Invalid signature for mutable record on read');
                    reject(sigError);
                }
                const privateKeyObject = await crypto.getPrivateKeyObject(record.value.privkey, 'passphrase');
                record.value.symkey = await crypto.decryptAssymetric(record.value.symkey, privateKeyObject);
                record.value.content = await crypto.decryptSymmetric(record.value.content, record.value.symkey);
                record.value.content = this.decodeValue(record.value.content, record.value.encoding);
                const validHash = crypto.isValidHash(record.value.contentHash, record.value.content);
                if (!validHash) {
                    let hashError = new Error('Invalid hash for mutable record');
                    reject(hashError);
                }
                resolve(record);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    updateMutableRecord(update, record) {
        return new Promise(async (resolve, reject) => {
            try {
                // assume the record is opened 
                const { encodedValue, encoding } = this.encodeValue(update);
                const hash = crypto.getHash(encodedValue);
                const encryptedValue = await crypto.encryptSymmetric(encodedValue, record.value.symkey);
                const encryptedSymkey = await crypto.encryptAssymetric(record.value.symkey, record.value.pubkey);
                const encryptedPrivkey = await crypto.encryptAssymetric(record.value.privkey, this.profile.activeKeyPair.public_key_armored);
                record.value.encoding = encoding;
                record.value.content = encryptedValue;
                record.value.symkey = encryptedSymkey;
                record.value.privkey = encryptedPrivkey;
                record.value.contentHash = hash;
                record.value.timestamp = Date.now();
                record.value.revision += 1;
                const unsignedValue = Object.assign({}, record.value);
                unsignedValue.signature = null;
                record.value.signature = await crypto.sign(unsignedValue, record.value.pubkey);
                resolve(record);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    put(record) {
        return new Promise(async (resolve, reject) => {
            try {
                await this.storage.put(record.key, JSON.stringify(record.value));
                resolve();
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    get(key) {
        return new Promise(async (resolve, reject) => {
            try {
                const stringValue = await this.storage.get(key);
                const value = JSON.parse(stringValue);
                resolve(value);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    del(key) {
        return new Promise(async (resolve, reject) => {
            try {
                // later implement full delete by rewriting garbage to the same location in memory
                await this.storage.del(key);
                resolve();
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    // how shards work
    // when a host receives receives the first put request for a contract it will not know about the contract
    // it will check the contract id against the ledger
    // compute the shards, and see if it is closest for any shards from the tracker
    createShardIndex(contract) {
        return new Promise(async (resolve, reject) => {
            try {
                const count = contract.reserved / 100000000;
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
                resolve(shardIndex);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    createShard(shardId, contractId) {
        return new Promise(async (resolve, reject) => {
            try {
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
                resolve(shard);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    getShard(shardId) {
        return new Promise(async (resolve, reject) => {
            try {
                const stringShard = await this.storage.get(shardId);
                const shard = JSON.parse(stringShard);
                resolve(shard);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    getAllShards() {
        return new Promise(async (resolve, reject) => {
            try {
                const shards = JSON.parse(await this.storage.get('shards'));
                resolve(shards);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    addRecordToShard(shardId, record) {
        return new Promise(async (resolve, reject) => {
            try {
                const shard = await this.getShard(shardId);
                shard.size += record.value.size;
                shard.records.push(record.key);
                await this.storage.put(shard.id, JSON.stringify(shard));
                resolve(shard);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    updateRecordInShard(shardId, sizeDelta) {
        return new Promise(async (resolve, reject) => {
            try {
                const shard = await this.getShard(shardId);
                shard.size += sizeDelta;
                await this.storage.put(shard.id, JSON.stringify(shard));
                resolve(shard);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    removeRecordFromShard(shardId, record) {
        return new Promise(async (resolve, reject) => {
            try {
                const shard = await this.getShard(shardId);
                shard.size -= record.value.size;
                shard.records = shard.records.filter(r => r !== record.key);
                await this.storage.put(shard.id, JSON.stringify(shard));
                resolve(shard);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    deleteShardAndRecords(shardId) {
        return new Promise(async (resolve, reject) => {
            try {
                const shard = await this.getShard(shardId);
                shard.records.forEach(async (record) => {
                    await this.storage.del(record);
                });
                await this.storage.del(shardId);
                let shards = JSON.parse(await this.storage.get('shards'));
                shards = shards.filter(shard => shard !== shardId);
                await this.storage.put('shards', JSON.stringify(shards));
                resolve();
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    getAllRecordKeys() {
        return new Promise(async (resolve, reject) => {
            try {
                let keys = [];
                const shards = await this.getAllShards();
                shards.forEach(async (shardId) => {
                    const shard = await this.getShard(shardId);
                    keys = keys.concat(shard.records);
                });
                resolve(keys);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    getLengthOfAllRecords() {
        return new Promise(async (resolve, reject) => {
            try {
                const keys = await this.getAllRecordKeys();
                resolve(keys.length);
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
    deleteAllShardsAndRecords() {
        return new Promise(async (resolve, reject) => {
            try {
                const shards = await this.getAllShards();
                shards.forEach(async (shardId) => {
                    await this.deleteShardAndRecords(shardId);
                });
                resolve();
            }
            catch (error) {
                this.emit('error', error);
                reject(error);
            }
        });
    }
}
exports.default = Database;
//# sourceMappingURL=database.js.map