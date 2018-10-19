export interface IRecord {
    kind: 'mutable' | 'immutable';
    key: string;
    value: IValue;
}
export interface IImmutableRecord extends IRecord {
    kind: 'immutable';
    value: IImmutableValue;
}
export interface IMutableRecord extends IRecord {
    kind: 'mutable';
    value: IMutableValue;
}
export declare type Record = IImmutableRecord | IMutableRecord;
export interface IValue {
    version: number;
    encoding: string;
    symkey: string;
    content: string;
    owner: string;
    timestamp: number;
    size: number;
    contract: string;
    contractSignature: string;
}
export interface IImmutableValue extends IValue {
}
export interface IMutableValue extends IValue {
    publicKey: string;
    privateKey: string;
    contentHash: string;
    revision: number;
    recordSignature: string;
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
export interface IContractObject {
    kind: 'contractObject';
    id: string;
    owner: string;
    name: string;
    email: string;
    passphrase: string;
    ttl: number;
    replicationFactor: number;
    spaceReserved: number;
    spaceUsed: number;
    createdAt: number;
    updatedAt: number;
    recordIndex: Set<string>;
    publicKey: string;
    privateKey: string;
    privateKeyObject: any;
}
export interface IContractData {
    kind: 'contractData';
    publicKey: string;
    clientKey: string;
    createdAt: number;
    ttl: number;
    spaceReserved: number;
    replicationFactor: number;
}
export declare type IContract = IContractObject | IContractData;
