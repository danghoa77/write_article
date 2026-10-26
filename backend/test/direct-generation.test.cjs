const {test}=require('node:test');const a=require('node:assert/strict');
const {ContentConfigService}=require('../dist/modules/content/content-config.service.js');
test('context pipeline retains the original n8n writing rules without deleting editorial constraints',()=>{
 const d=new ContentConfigService().defaults();
 for(const text of ['0. CHARACTER STATUS','1C. ROLE-CATEGORY','7B. FORCED FICTIONAL','11. Caption and content MUST match','14. Image Placeholders','20. Current Roster'])a.ok(d.prompt.includes(text));
 a.ok(d.contextWriterPolicy.includes('priority'));a.ok(d.pipelinePrompts.contextAnalysis.includes('hasIndividualFocus'));
});
