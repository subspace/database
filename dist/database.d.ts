import { ImmutableRecord, ImmutableValue, MutableRecord, MutableValue, Shard, ShardIndex, ShardMap } from './interfaces';
import { Destination } from '@subspace/rendezvous-hash';
/**
 * Size of one shard in bytes (100M)
 */
export declare const SHARD_SIZE = 100000000;
/**
 * Pledge size in bytes (100 shards or 10G)
 */
export declare const PLEDGE_SIZE: number;
export default class Database {
    private storage;
    private profile;
    private tracker;
    constructor(storage: any, profile: any, tracker: any);
    private encodeValue;
    private decodeValue;
    createImmutableRecord(value: any, contract: string): Promise<ImmutableRecord>;
    readImmutableRecord(record: ImmutableRecord): Promise<ImmutableRecord>;
    createMutableRecord(value: any, contract: string): Promise<MutableRecord>;
    readMutableRecord(record: MutableRecord): Promise<MutableRecord>;
    updateMutableRecord(update: any, record: MutableRecord): Promise<MutableRecord>;
    put(record: MutableRecord | ImmutableRecord): Promise<void>;
    get(key: string): Promise<MutableValue | ImmutableValue>;
    del(key: string): Promise<void>;
    createShardIndex(contract: any): Promise<ShardIndex>;
    createShard(shardId: string, contractId: string): Promise<Shard>;
    getShard(shardId: string): Promise<Shard>;
    getAllShards(): Promise<string[]>;
    addRecordToShard(shardId: string, record: MutableRecord | ImmutableRecord): Promise<Shard>;
    updateRecordInShard(shardId: string, sizeDelta: number): Promise<Shard>;
    removeRecordFromShard(shardId: string, record: MutableRecord | ImmutableRecord): Promise<Shard>;
    deleteShardAndRecords(shardId: string): Promise<void>;
    getAllRecordKeys(): Promise<string[]>;
    getLengthOfAllRecords(): Promise<number>;
    deleteAllShardsAndRecords(): Promise<void>;
    computeShards(contractId: string, contractSize: number): string[];
    getDestinations(): Destination[];
    computeHostsforShards(shardIds: string[], replicationFactor: number): ShardMap[];
    computeShardForKey(key: string, contractSize: number): number;
    computeHostsForKey(key: string, contractId: string, contractSize: number, replicationFactor: number): string[];
}
