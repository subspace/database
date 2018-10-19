import { IImmutableRecord, IMutableRecord, IValue, Shard, ShardIndex, ShardMap, IContract, Record, IContractObject, IMutableValue } from './interfaces';
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
    private wallet;
    private tracker;
    constructor(storage: any, wallet: any, tracker: any);
    private encodeValue;
    private decodeValue;
    createRecord(value: any, contract: IContractObject, encrypted: boolean): Promise<IImmutableRecord | IMutableRecord>;
    setRecordType(record: any): IImmutableRecord | IMutableRecord;
    readRecord(record: Record): Promise<IImmutableRecord | IMutableRecord>;
    createImmutableRecord(value: any, contract: IContractObject, encrypted: boolean): Promise<IImmutableRecord>;
    readImmutableRecord(record: IImmutableRecord, contract?: IContract): Promise<IImmutableRecord>;
    createMutableRecord(value: any, contract: IContractObject, encrypted: boolean): Promise<IMutableRecord>;
    readMutableRecord(record: IMutableRecord, contract?: IContract): Promise<IMutableRecord>;
    updateMutableRecord(update: any, record: IMutableRecord): Promise<IMutableRecord>;
    isValidRecord(record: Record, contract?: IContract): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidImmutableRecord(record: IImmutableRecord): {
        valid: boolean;
        reason: string;
    };
    isValidMutableRecord(record: IMutableRecord): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidContractOperation(type: string, record: Record, contract: IContractObject, sizeDelta?: number): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidMutation(value: IMutableValue, update: IMutableValue): {
        valid: boolean;
        reason: string;
    };
    isValidPutRequest(record: Record, contract: IContractObject): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidRevRequest(oldRecord: IMutableRecord, newRecord: IMutableRecord, contract: IContractObject): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidDelRequest(proof: any, record: Record, contract: IContract): Promise<{
        valid: boolean;
        reason: string;
    }>;
    createProofOfReplication(record: Record, nodeId: string): string;
    isValidProofOfReplicaiton(proof: string, record: Record, nodeId: string): boolean;
    put(record: Record): Promise<void>;
    get(key: string): Promise<IValue>;
    del(key: string): Promise<void>;
    createShardIndex(contract: any): Promise<ShardIndex>;
    getOrCreateShard(shardId: string, contractId: string): Promise<any>;
    createShard(shardId: string, contractId: string): Promise<Shard>;
    getShard(shardId: string): Promise<Shard>;
    getAllShards(): Promise<string[]>;
    addRecordToShard(shardId: string, record: Record): Promise<Shard>;
    updateRecordInShard(shardId: string, sizeDelta: number): Promise<Shard>;
    removeRecordFromShard(shardId: string, record: Record): Promise<Shard>;
    deleteShardAndRecords(shardId: string): Promise<void>;
    getAllRecordKeys(): Promise<string[]>;
    getLengthOfAllRecords(): Promise<number>;
    deleteAllShardsAndRecords(): Promise<void>;
    computeShards(contractId: string, contractSize: number): string[];
    getDestinations(): Destination[];
    computeHostsforShards(shardIds: string[], replicationFactor: number): ShardMap[];
    isValidShardForKey(key: string, shardId: string, contractId: string): void;
    computeShardForKey(key: string, contractSize: number): number;
    computeShardAndHostsForKey(key: string, contractId: string, contractSize: number, replicationFactor: number): ShardMap;
    parseKey(key: string): {
        shardId: string;
        recordId: string;
        replicationFactor: number;
    };
}
