# Subspace Database Module

Connects network with local storage of mutable and immutable records for subspace DB.

## Usage as a module

Install this module as a dependency into another project

```
$ yarn add 'github:subspace/database'
```

Require this module inside a script

```typescript
import Database from '@subspace/database'
const db = new Database(profile, storage)

```

## API
### database.createImmutableRecord(value: any, contract: string) :  record: object
Stores a value as an immutable record under a given data contract.

* `value` - any value type, database will encode properly
* `contract` - contract id data will be stored under

Returns the encoded & encrypted object as it will be stored on subspace.

### database.readImmutableRecord(record: object) :  record: object
Takes an encoded & encrypted reocrd object and converts to a plain text object. Assuming the node has appropriate permissions.

* `record` - an encoded & encrypted immutable record

Returns the decoded & decrypted object.

### database.createMutableRecord(value: any, contract: string) :  record: object
Stores a value as an mutable record under a given data contract.

* `value` - any value type, database will encode properly
* `contract` - contract id data will be stored under

Returns the encoded & encrypted object as it will be stored on subspace.

### database.readMutableRecord(record: object) :  record: object
Takes an encoded & encrypted reocrd object and converts to a plain text object. Assuming the node has appropriate permissions.

* `record` - an encoded & encrypted mutable record

Returns the decoded & decrypted object.

### database.updateMutableRecord(update: any, record: object) :  record: object
Updates an exisiting mutable record to a new value.

* `update` - any value type, database will encode properly
* `record` - decoded and decrypted mutable record that update will be applied to.

Returns the encoded & encrypted update mutable object as it will be stored on subspace.

### database.create(record: object) :  Error
Adds a new record to the local database. 

* `record` - a new ImmutableRecord or MutableRecord

Optionally returns an error.

### database.read(key: string) :  Value: Object | Error
Gets an existing record from the local database. 

* `key` - string encoded 32 btye record key

Returns the value of the corresponsing mutable or immutable record. Optionally returns an error

### database.update(record: object) :  Error
Updates an existing mutable record in the local database. 

* `record` - updated version of existing MutableRecord

Optionally returns an error.

### database.delete(key: string) :  Error
Removes an existing record from the local database.

* `key` - string encoded 32 btye record key

Optionally returns an error.



## Development usage

Clone and install the repo locally   

```
$ git clone https://www.github.com/subspace/database.git
$ cd crypto
$ yarn
```

Edit code in src/main.ts

Build manually:  

```
$ npm run build
```

Watch for file changes:

```
$ npm run watch
```

[Instructions](https://code.visualstudio.com/docs/languages/typescript#_step-2-run-the-typescript-build) to automate with visual studio code.

Run tests with

```
$ npx jest
```
