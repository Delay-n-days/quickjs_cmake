import { CFunction } from './quickjs-ffi.js'

console.log('step 1: imported')

let add = new CFunction('./myadd.dll', 'add', null, 'int', 'int', 'int');
console.log('step 2: CFunction created')

let result = add.invoke(3, 5);
console.log('step 3: result =', result);

add.free();
console.log('step 4: done')