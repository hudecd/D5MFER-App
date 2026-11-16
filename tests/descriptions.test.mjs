import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPhotoDisclosures } from '../lib/descriptions.mjs';
test('generated copy retains replica and reference-photo disclosures',()=>{
  const input={name:'Sivá mikina',description:'Sivá mikina na zips s kapucňou.',category:'hoodies',colorLabel:'Sivá'};
  const output=applyPhotoDisclosures(input,{replica:true,referenceImage:true});assert.match(output.description,/Replika, nie originálny/);assert.match(output.description,/nie fotografiou konkrétneho/);assert.equal(input.description,'Sivá mikina na zips s kapucňou.');
  assert.equal(applyPhotoDisclosures(input,{replica:false,referenceImage:false}).description,input.description);
  assert.throws(()=>applyPhotoDisclosures({...input,description:''}));
});
