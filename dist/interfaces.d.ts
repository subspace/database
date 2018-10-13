export interface IValue {
    version: number;
    encoding: string;
    symkey: string;
    content: string;
    owner: string;
    timestamp: number;
    size: number;
    contract: string;
}
export interface IImmutableValue extends IValue {
}
export interface IMutableValue extends IValue {
    pubkey: string;
    privkey: string;
    contentHash: string;
    revision: number;
    signature: string;
}
export interface IRecord {
    key: string;
    value: IValue;
}
export interface IImmutableRecord extends IRecord {
    value: IImmutableValue;
}
export interface IMutableRecord extends IRecord {
    value: IMutableValue;
}
export interface ShardIndex {
    contract: string;
    size: number;
    count: number;
    shards: string[];
}
export interface Shard {
    id: string;
    contract: string;
    size: number;
    records: string[];
}
export interface ShardMap {
    id: string;
    hosts: string[];
}
