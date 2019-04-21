import { IRecord, IRecordValue, IImmutableRecord, IImmutableRecordValue, IMutableRecord, IMutableRecordValue, IContract, IShard } from './interfaces';
import { Destination } from '@subspace/rendezvous-hash';
export { IImmutableRecord, IImmutableRecordValue, IMutableRecord, IMutableRecordValue, IRecord, IRecordValue };
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
    createRecord(content: any, encrypted: boolean): Promise<MutableRecord | ImmutableRecord>;
    loadMutableRecordFromDisk(key: string): Promise<MutableRecord>;
    loadImmutableRecordFromDisk(key: string): Promise<ImmutableRecord>;
    loadRecordFromDisk(key: string): Promise<MutableRecord | ImmutableRecord>;
    loadRecordFromNetwork(recordData: IImmutableRecord & IMutableRecord): Promise<MutableRecord | ImmutableRecord>;
    saveRecord(record: Record, contract: IContract, update?: boolean, sizeDelta?: number): Promise<void>;
    revRecord(key: string, update: any): Promise<MutableRecord | ImmutableRecord>;
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
    isValidMutableContractRequest(txRecord: Record, contractRecord: IMutableRecord): Promise<boolean>;
    isValidGetRequest(record: IRecord, shardId: string, replicationFactor: number): {
        valid: boolean;
        reason: string;
    };
    isValidRevRequest(oldRecord: MutableRecord, newRecord: MutableRecord, contract: IContract, shardId: string, request: any): Promise<{
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
    getShard(shardId: string): IShard;
    delShard(shardId: string): Promise<void>;
    putRecordInShard(shardId: string, record: Record): Promise<void>;
    revRecordInShard(shardId: string, sizeDelta: number): Promise<IShard>;
    delRecordInShard(shardId: string, record: Record): Promise<void>;
    computeShardArray(contractId: string, spaceReserved: number): string[];
    computeShardForKey(key: string, spaceReserved: number): number;
    getDestinations(): Destination[];
    getHostFromId64(hostId64: Uint8Array): any;
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
export declare class Record implements IRecord {
    protected _key: string;
    protected _value: IRecordValue;
    protected _isEncoded: boolean;
    protected _isEncrypted: boolean;
    constructor();
    key: string;
    readonly value: IRecordValue;
    init(value: any, encrypted: boolean, timestamped?: boolean): Promise<void>;
    static loadFromData(recordData: any, privateKeyObject?: any): Promise<MutableRecord | ImmutableRecord>;
    isMutable(): boolean;
    isImmutable(): boolean;
    getSize(): number;
    getData(): {
        key: string;
        value: any;
    };
    getContent(shardId: string, replicationFactor: number, privateKeyObject: any): Promise<{
        key: string;
        value: any;
    }>;
    isValidRecord(sender?: string): Promise<{
        valid: boolean;
        reason: string;
    }>;
    protected encodeContent(): void;
    protected decodeContent(): void;
    protected encryptRecord(publicKey: string, privateKey?: string): Promise<void>;
    protected decryptRecord(privateKeyObject: any): Promise<void>;
}
export declare class ImmutableRecord extends Record {
    constructor();
    _value: IImmutableRecordValue;
    protected setKey(): void;
    value: IImmutableRecordValue;
    static create(content: any, encrypted: boolean, publicKey: string, timestamped?: boolean): Promise<ImmutableRecord>;
    static readPackedImmutableRecord(data: IImmutableRecord, privateKeyObject?: any): Promise<ImmutableRecord>;
    isValid(sender: string): Promise<{
        valid: boolean;
        reason: string;
    }>;
    pack(publicKey: string): Promise<void>;
    unpack(privateKeyObject: any): Promise<void>;
    private encrypt;
    private decrypt;
}
export declare class MutableRecord extends Record {
    constructor();
    _value: IMutableRecordValue;
    protected setKey(): void;
    value: IMutableRecordValue;
    static create(content: any, encrypted: boolean, publicKey: string, timestamped?: boolean): Promise<MutableRecord>;
    static readPackedMutableRecord(data: IMutableRecord, privateKeyObject?: any): Promise<MutableRecord>;
    update(update: any, profile: any): Promise<void>;
    private setContentHash;
    private sign;
    isValid(sender?: string): Promise<{
        valid: boolean;
        reason: string;
    }>;
    isValidUpdate(value: IMutableRecordValue, update: IMutableRecordValue): {
        valid: boolean;
        reason: string;
    };
    pack(publicKey: string): Promise<void>;
    unpack(privateKeyObject: any): Promise<void>;
    private encrypt;
    private decrypt;
}
