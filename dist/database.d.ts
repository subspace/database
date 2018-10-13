import { IImmutableRecord, IMutableRecord, IRecord, IValue, Shard, ShardIndex, ShardMap } from './interfaces';
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
    createImmutableRecord(value: any, contract: string): Promise<IImmutableRecord>;
    readImmutableRecord(record: IImmutableRecord): Promise<IImmutableRecord>;
    createMutableRecord(value: any, contract: string): Promise<IMutableRecord>;
    readMutableRecord(record: IMutableRecord): Promise<IMutableRecord>;
    updateMutableRecord(update: any, record: IMutableRecord): Promise<IMutableRecord>;
    put(record: IRecord): Promise<void>;
    get(key: string): Promise<IValue>;
    del(key: string): Promise<void>;
    createShardIndex(contract: any): Promise<ShardIndex>;
    createShard(shardId: string, contractId: string): Promise<Shard>;
    getShard(shardId: string): Promise<Shard>;
    getAllShards(): Promise<string[]>;
    addRecordToShard(shardId: string, record: IRecord): Promise<Shard>;
    updateRecordInShard(shardId: string, sizeDelta: number): Promise<Shard>;
    removeRecordFromShard(shardId: string, record: IRecord): Promise<Shard>;
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
