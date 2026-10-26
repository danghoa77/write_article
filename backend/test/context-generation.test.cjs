const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ContentModule}=require('../dist/modules/content/content.module.js');
test('active Nest module registers rotation and no character analyzer or picker',()=>{
 const names=Reflect.getMetadata('providers',ContentModule).map(provider=>provider.name);
 assert.ok(names.includes('CharacterRotationService'));
 assert.ok(!names.includes('ContextPlanService'));
 assert.ok(!names.includes('CharacterSelectionService'));
});
