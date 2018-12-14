import { IRecord, IValue, IContract, IShard } from './interfaces';
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
export declare class DataBase {
    private wallet;
    private storage?;
    private tracker?;
    constructor(wallet: any, storage?: any, tracker?: any);
    shards: {
        map: Map<string, IShard>;
        save: () => Promise<void>;
        load: () => Promise<void>;
    };
    createRecord(content: any, encrypted: boolean): Promise<Record>;
    getRecord(key: string): Promise<Record>;
    loadPackedRecord(recordObject: IRecord): Record;
    loadUnpackedRecord(recordObject: IRecord): Record;
    saveRecord(record: Record, contract: IContract, update?: boolean, sizeDelta?: number): Promise<void>;
    revRecord(key: string, update: any): Promise<Record>;
    delRecord(record: Record, shardId: string): Promise<void>;
    parseRecordKey(key: string): {
        shardId: string;
        recordId: string;
        replicationFactor: number;
    };
    isValidRequest(record: IRecord, hosts: string[]): {
        valid: boolean;
        reason: string;
    };
    isValidContractOp(record: Record, contract: IContract, shardMap: any, request: any, sizeDelta?: number): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidPutRequest(record: Record, contract: IContract, request: any): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidMutableContractRequest(txRecord: Record, contractRecord: Record): Promise<boolean>;
    isValidGetRequest(record: IRecord, shardId: string, replicationFactor: number): {
        valid: boolean;
        reason: string;
    };
    isValidRevRequest(oldRecord: Record, newRecord: Record, contract: IContract, shardId: string, request: any): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidDelRequest(record: Record, contract: IContract, shardId: string, request: any): Promise<{
        valid: boolean;
        reason: string;
    }>;
    createShard(shardId: string, contractId: string): Promise<{
        contract: string;
        size: number;
        records: Set<any>;
    }>;
    getShard(shardId: string): any;
    delShard(shardId: string): Promise<void>;
    putRecordInShard(shardId: string, record: Record): Promise<void>;
    revRecordInShard(shardId: string, sizeDelta: number): Promise<IShard>;
    delRecordInShard(shardId: string, record: Record): Promise<void>;
    computeShardArray(contractId: string, spaceReserved: number): string[];
    computeShardForKey(key: string, spaceReserved: number): number;
    getDestinations(): Destination[];
    getHostFromId64(hostId64: string): any;
    computeHostsforShards(shardIds: string[], replicationFactor: number): {
        id: string;
        hosts: any[];
    }[];
    getShardAndHostsForKey(key: string, contract: IContract): {
        id: string;
        hosts: any[];
    };
    getShardForKey(key: string, contract: IContract): string;
    getHosts(key: string, contract: IContract): any[];
}
export declare class Record {
    private _key;
    private _value;
    private _encoded;
    private _encrypted;
    constructor(_key: string, _value: IValue);
    readonly key: string;
    readonly value: IValue;
    readonly encoded: boolean;
    readonly encrypted: boolean;
    static createImmutable(content: any, encrypted: boolean, publicKey: string, timestamped?: boolean): Promise<Record>;
    static createMutable(content: any, encrypted: boolean, publicKey: string): Promise<Record>;
    static readUnpacked(key: string, value: IValue): Record;
    static readPacked(key: string, value: IValue): Record;
    update(update: any, profile: any): Promise<void>;
    pack(publicKey: string): Promise<void>;
    unpack(privateKeyObject: any): Promise<void>;
    getSize(): number;
    getRecord(): {
        key: string;
        value: any;
    };
    getContent(shardId: string, replicationFactor: number, privateKeyObject: any): Promise<{
        key: string;
        value: any;
    }>;
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
    private encodeContent;
    private decodeContent;
    private encrypt;
    private decrypt;
    private sign;
    private setContentHash;
    private setKey;
}
