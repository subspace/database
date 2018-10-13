/// <reference types="node" />
import * as I from './interfaces';
import { EventEmitter } from 'events';
export default class Database extends EventEmitter {
    interfaces: any;
    storage: any;
    profile: any;
    constructor(storage: any, profile: any);
    private encodeValue;
    private decodeValue;
    createImmutableRecord(value: any, contract: string): Promise<I.ImmutableRecord>;
    readImmutableRecord(record: I.ImmutableRecord): Promise<I.ImmutableRecord>;
    createMutableRecord(value: any, contract: string): Promise<I.MutableRecord>;
    readMutableRecord(record: I.MutableRecord): Promise<I.MutableRecord>;
    updateMutableRecord(update: any, record: I.MutableRecord): Promise<I.MutableRecord>;
    put(record: I.MutableRecord | I.ImmutableRecord): Promise<void>;
    get(key: string): Promise<I.MutableValue | I.ImmutableValue>;
    del(key: string): Promise<void>;
    createShardIndex(contract: any): Promise<I.ShardIndex>;
    createShard(shardId: string, contractId: string): Promise<I.Shard>;
    getShard(shardId: string): Promise<I.Shard>;
    getAllShards(): Promise<string[]>;
    addRecordToShard(shardId: string, record: I.MutableRecord | I.ImmutableRecord): Promise<I.Shard>;
    updateRecordInShard(shardId: string, sizeDelta: number): Promise<I.Shard>;
    removeRecordFromShard(shardId: string, record: I.MutableRecord | I.ImmutableRecord): Promise<I.Shard>;
    deleteShardAndRecords(shardId: string): Promise<void>;
    getAllRecordKeys(): Promise<string[]>;
    getLengthOfAllRecords(): Promise<number>;
    deleteAllShardsAndRecords(): Promise<void>;
}
