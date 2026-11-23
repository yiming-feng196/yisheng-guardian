const test=require('node:test');
const assert=require('node:assert/strict');
const Endpoint=require('../../../backend/src/main/resources/static/voice-endpoint.js');
test('silence without speech cancels instead of uploading a blank recording',()=>{
 const e=new Endpoint();for(let t=0;t<8000;t+=100)assert.equal(e.update(0,t),null);
 assert.equal(e.update(0,8000),'cancel');assert.equal(e.update(.2,9000),null);
});
test('a brief sound does not become a conversation turn',()=>{
 const e=new Endpoint();e.update(.2,0);for(let t=100;t<8000;t+=100)assert.equal(e.update(0,t),null);
 assert.equal(e.update(0,8000),'cancel');
});
test('normal pauses preserve the turn and the trailing pause submits once',()=>{
 const e=new Endpoint();for(let t=0;t<=600;t+=100)assert.equal(e.update(.1,t),null);
 for(let t=700;t<2400;t+=100)assert.equal(e.update(0,t),null);
 assert.equal(e.update(0,2400),'submit');assert.equal(e.update(0,2500),null);
});
test('speaking again restarts the trailing-silence timer',()=>{
 const e=new Endpoint();for(let t=0;t<=500;t+=100)e.update(.1,t);
 for(let t=600;t<1500;t+=100)assert.equal(e.update(0,t),null);
 e.update(.1,1500);assert.equal(e.update(0,3000),null);assert.equal(e.update(0,3300),'submit');
});
test('continuous speech is bounded to avoid an unattended recording',()=>{
 const e=new Endpoint();for(let t=0;t<45000;t+=100)assert.equal(e.update(.1,t),null);
 assert.equal(e.update(.1,45000),'submit');
});
