import {sha256} from 'js-sha256';
export function createHash(name) {
 if(name!=='sha256')throw Error('Unsupported hash');
 const hash=sha256.create();
 return {update(value){hash.update(value);return this;},digest(format){if(format!=='hex')throw Error('Unsupported hash output');return hash.hex();}};
}
