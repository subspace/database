export interface IShard {
    contract: string;
    size: number;
    records: Set<string>;
}
export interface IRecord {
    key: string;
    value: IRecordValue;
}
export interface IRecordValue {
    type: string;
    version: number;
    encoding: string;
    symkey: string;
    content: any;
    createdAt: number;
}
export interface IImmutableRecord extends IRecord {
    value: IImmutableRecordValue;
}
export interface IImmutableRecordValue extends IRecordValue {
    type: 'immutable';
}
export interface IMutableRecord extends IRecord {
    value: IMutableRecordValue;
}
export interface IMutableRecordValue extends IRecordValue {
    type: 'mutable';
    publicKey: string;
    privateKey: string;
    contentHash: string;
    revision: number;
    updatedAt: number;
    recordSig: string;
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
