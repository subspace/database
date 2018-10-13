export interface ImmutableRecord {
    key: string;
    value: ImmutableValue;
}
export interface ImmutableValue {
    version: number;
    encoding: string;
    symkey: string;
    content: string;
    owner: string;
    timestamp: number;
    size: number;
    contract: string;
}
export interface MutableRecord {
    key: string;
    value: MutableValue;
}
export interface MutableValue extends ImmutableValue {
    pubkey: string;
    privkey: string;
    contentHash: string;
    revision: number;
    signature: string;
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
