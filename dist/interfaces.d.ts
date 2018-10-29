export interface IDataBase {
    shards: IShards;
}
export interface IShards {
    map: Map<string, IShard>;
    save(): void;
    load(): void;
}
export interface IShard {
    contract: string;
    size: number;
    records: Set<string>;
}
export interface IRecord {
    key: string;
    value: IValue;
}
export interface IValue {
    immutable: boolean;
    version: number;
    encoding: string;
    symkey: string;
    content: any;
    createdAt: number;
    publicKey?: string;
    privateKey?: string;
    contentHash?: string;
    revision?: number;
    updatedAt?: number;
    recordSig?: string;
}
export interface IContract {
    id: string;
    createdAt: number;
    spaceReserved: number;
    replicationFactor: number;
    ttl: number;
    contractSig: string;
}
export interface IRequest {
    record: IRecord;
    contractKey: string;
    timestamp: number;
    signature: string;
}
