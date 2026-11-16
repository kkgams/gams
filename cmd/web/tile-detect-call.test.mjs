import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTileDetectCall } from './tile-detect-call.ts';
const config={'source-data':[],'tile-w':16,'tile-h':16,tolerance:0,'skip-nth-pixel':1};
const output=hash=>({tilebank:[{id:1,'source-index':0,hash}],tilemap:{width:1,height:1,'tile-w':16,'tile-h':16,data:[1]}});

test('Tile Detect supports exactly four known method arities and requires own WIT fields',()=>{
  for(const [method,arity] of [['detect-size',3],['extract',1],['export-tileset',1],['to-tilemap',1]]){
    for(const args of [[],Array(arity+1),null])assert.throws(()=>prepareTileDetectCall(method,args),/arguments/);
  }
  for(const method of ['unknown','toString','constructor','extract-file'])assert.throws(()=>prepareTileDetectCall(method,[]),/Unsupported/);
  for(const record of [null,[],new Date(),Object.create(config),{}])assert.throws(()=>prepareTileDetectCall('extract',[record]),/record/);
  assert.deepEqual(prepareTileDetectCall('extract',[Object.assign(Object.create(null),config)]),[{sourceData:new Uint8Array(),tileW:16,tileH:16,tolerance:0,skipNthPixel:1}]);
});
test('Tile Detect checks byte and u32 ranges before typed-array coercion, including sparse lists',()=>{
  for(const value of [-1,1.5,NaN,Infinity,'1',null,4294967296]){
    assert.throws(()=>prepareTileDetectCall('detect-size',[[],value,128]));
    assert.throws(()=>prepareTileDetectCall('to-tilemap',[{...output(1),tilemap:{...output(1).tilemap,data:[value]}}]));
  }
  for(const value of [[-1],[256],[1.5],[NaN],['1'],[null],Array(1),new Uint16Array([1])])assert.throws(()=>prepareTileDetectCall('detect-size',[value,4,128]));
  assert.throws(()=>prepareTileDetectCall('to-tilemap',[{...output(1),tilemap:{...output(1).tilemap,data:Array(1)}}]));
  const bytes=Uint8Array.of(0,128,255);
  assert.equal(prepareTileDetectCall('detect-size',[bytes,0,4294967295])[0],bytes);
});
test('Tile Detect hash conversion preserves full u64 range and rejects rounded numbers',()=>{
  for(const hash of [0,Number.MAX_SAFE_INTEGER,0n,18446744073709551615n,'18446744073709551615']){
    const [converted]=prepareTileDetectCall('to-tilemap',[output(hash)]);
    assert.equal(converted.tilebank[0].hash,BigInt(hash));
    assert.deepEqual(converted.tilemap.data,Uint32Array.of(1));
  }
  for(const hash of [-1,-1n,9007199254740992,18446744073709551616n,'18446744073709551616','1.0','-1','',null,true,{},NaN])assert.throws(()=>prepareTileDetectCall('to-tilemap',[output(hash)]),/hash/);
});
