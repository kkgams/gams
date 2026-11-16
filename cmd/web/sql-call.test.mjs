import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSqlCall,sqlHostValue} from './sql-call.ts';

test('SQL cell variants use Native case/value with lossless integers and binary lists',()=>{
  const variants=[['int32',-2147483648],['int64',-9223372036854775808n],['uint32',4294967295],['uint64',18446744073709551615n],['float',1.25],['double',2.5],['str','café ✓'],['boolean',true],['date','2026-11-16'],['time','12:34'],['timestamp','2026-11-16T12:34:00Z'],['binary',new Uint8Array([0,128,255])],['null']];
  const cells=variants.map(([tag,val])=>({fieldName:tag,value:tag==='null'?{tag}:{tag,val}}));
  assert.deepEqual(sqlHostValue('query',cells),variants.map(([tag,val])=>({'field-name':tag,value:{case:tag,value:tag==='null'?null:typeof val==='bigint'?val.toString():val instanceof Uint8Array?Array.from(val):val}})));
  assert.deepEqual(sqlHostValue('query',[{fieldName:'small',value:{tag:'int64',val:42n}}]),[{'field-name':'small',value:{case:'int64',value:42}}]);
  assert.deepEqual(sqlHostValue('query',[]),[]);
});
test('SQL malformed output never becomes a guessed cell or variant',()=>{
  for(const cells of [null,{},[null],[{}],[{fieldName:'x',value:{tag:'unknown',val:1}}],[{fieldName:'x',value:{tag:'str'}}],[{fieldName:'x',value:{tag:'double',val:Infinity}}]])assert.throws(()=>sqlHostValue('query',cells));
});
test('SQL static calls preserve receiver and input strings, method calls borrow actual error',()=>{
  const seen=[];class Connection{static open(name){assert.equal(this,Connection);seen.push(name);return 'connection';}}
  const borrow=()=>assert.fail('static call borrowed a resource');
  for(const name of ['memory',':memory:','nested/data.sqlite',''])assert.equal(prepareSqlCall('sql/types','[static]connection.open',[name],borrow).call({Connection}),'connection');
  assert.deepEqual(seen,['memory',':memory:','nested/data.sqlite','']);
  const error={trace(){assert.equal(this,error);return 'trace';}};
  assert.equal(prepareSqlCall('sql/types','[method]error.trace',[{id:'e'}],(ref,kind)=>{assert.deepEqual(ref,{id:'e'});assert.equal(kind,'error');return error;}).call({}),'trace');
  assert.throws(()=>prepareSqlCall('sql/types','[static]connection.open',['memory'],borrow).call({}),/Missing SQL resource class/);
});
