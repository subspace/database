import { IDataBase, IRecord, IValue, IContract, IShards, IRequest } from './interfaces';
import { Destination } from '@subspace/rendezvous-hash';
export { IRecord, IValue };
/**
 * Size of one shard in bytes (100M)
 */
export declare const SHARD_SIZE = 100000000;
/**
 * Pledge size in bytes (100 shards or 10G)
 */
export declare const PLEDGE_SIZE: number;
export declare class DataBase implements IDataBase {
    private wallet;
    private storage;
    private tracker;
    constructor(wallet: any, storage: any, tracker: any);
    shards: IShards;
    createMutableContract(): Promise<void>;
    createImmutableContract(): Promise<void>;
    createRecord(content: any, encrypted: boolean): Promise<Record>;
    getRecord(key: string): Promise<Record>;
    loadRecord(recordObject: IRecord): Record;
    saveRecord(record: IRecord, contract: IContract, update?: boolean, sizeDelta?: number): Promise<void>;
    revRecord(key: string, update: any): Promise<Record>;
    delRecord(record: IRecord, shardId: string): Promise<void>;
    parseRecordKey(key: string): {
        shardId: string;
        recordId: string;
        replicationFactor: number;
    };
    isValidRequest(record: IRecord, hosts: string[]): {
        valid: boolean;
        reason: string;
    };
    isValidContractOp(record: IRecord, contract: IContract, shardMap: any, request: IRequest, sizeDelta?: number): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidPutRequest(record: IRecord, contract: IContract, request: IRequest): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidGetRequest(record: IRecord, contract: IContract, shardId: string): {
        valid: boolean;
        reason: string;
    };
    isValidRevRequest(oldRecord: IRecord, newRecord: IRecord, contract: IContract, shardId: string, request: IRequest): Promise<any>;
    isValidDelRequest(record: IRecord, contract: IContract, shardId: string, request: IRequest): Promise<{
        valid: boolean;
        reason: string;
    }>;
    createShard(shardId: string, contractId: string): Promise<{
        contract: string;
        size: number;
        records: Set<any>;
    }>;
    getShard(shardId: string): import("src/interfaces").IShard;
    delShard(shardId: string): Promise<void>;
    putRecordInShard(shardId: string, record: IRecord): Promise<void>;
    revRecordInShard(shardId: string, sizeDelta: number): Promise<import("src/interfaces").IShard>;
    delRecordInShard(shardId: string, record: IRecord): Promise<void>;
    computeShardArray(contract: IContract): string[];
    computeShardForKey(key: string, spaceReserved: number): number;
    getDestinations(): Destination[];
    computeHostsforShards(shardIds: string[], replicationFactor: number): {
        id: string;
        hosts: string[];
    }[];
    getShardAndHostsForKey(key: string, contract: IContract): {
        id: string;
        hosts: string[];
    };
    getShardForKey(key: string, contract: IContract): string;
    getHosts(key: string, contract: IContract): string[];
}
export declare class Record {
    key: string;
    value: IValue;
    constructor(key?: string, value?: IValue);
    encodeContent(content: any): void;
    decodeContent(): void;
    createPoR(nodeId: string): string;
    isValidPoR(nodeId: string, proof: string): boolean;
    createPoD(nodeId: string): string;
    isValidPoD(nodeId: string, proof: string): boolean;
    isValid(sender?: string): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidUpdate(value: IValue, update: IValue): {
        valid: boolean;
        reason: string;
    };
    decrypt(privateKeyObject: any): Promise<void>;
    getSize(): number;
    getRecord(): {
        key: string;
        value: IValue;
    };
    getContent(shardId: string, replicationFactor: number, privateKeyObject: any): Promise<{
        key: string;
        value: any;
    }>;
    serialize(): void;
    deserialize(): void;
}
