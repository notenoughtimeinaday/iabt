import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanNativeAction,parseNativeCommand,createVault,HOST} from '../native.js';

test('native actions accept a fixed vocabulary and strip arbitrary instructions',()=>{
  assert.deepEqual(cleanNativeAction({kind:'click',x:1,y:-20,script:'anything'}),{kind:'click',x:1,y:-20});
  assert.throws(()=>cleanNativeAction({kind:'shell',command:'whoami'}),/Unsupported/);
  assert.throws(()=>cleanNativeAction({kind:'click',x:NaN,y:2}),/integer/);
  assert.throws(()=>cleanNativeAction({kind:'type',text:'hello'}),/target window/);
  assert.throws(()=>cleanNativeAction({kind:'key',window:'22',key:'CTRL+ALT+DELETE'}),/Unsupported/);
  assert.throws(()=>cleanNativeAction({kind:'scroll',x:2,y:3,amount:100}),/Scroll/);
});
test('typed computer commands parse only explicit physical coordinates',()=>{
  assert.deepEqual(parseNativeCommand('double click at 120, 450'),{kind:'doubleClick',x:120,y:450});
  assert.deepEqual(parseNativeCommand('move cursor to -20 60'),{kind:'move',x:-20,y:60});
  assert.equal(parseNativeCommand('pay this bill and accept everything'),null);
  assert.deepEqual(parseNativeCommand('type Hello world',{window:'42',title:'Untitled'}),{kind:'type',text:'Hello world',window:'42',title:'Untitled'});
  assert.throws(()=>parseNativeCommand('type Hello world'),/target window/);
  assert.deepEqual(parseNativeCommand('scroll down 3 at 100, 200'),{kind:'scroll',x:100,y:200,amount:-3});
  assert.equal(parseNativeCommand('press ctrl+a',{window:'42',title:'Untitled'}).key,'CTRL+A');
});
test('without companion the workspace is temporary session storage',async()=>{
  let saved;
  const vault=createVault({runtime:{sendNativeMessage:async()=>{throw new Error('not installed');}},storage:{session:{get:async()=>({workspace:saved}),set:async value=>{saved=value.workspace;}}}});
  await vault.storage.set({workspace:{goal:'temporary'}});
  assert.deepEqual(await vault.storage.get(),{workspace:{goal:'temporary'}});
  assert.equal((await vault.status()).connected,false);
});
test('connected vault uses native messaging; write errors never fall back to plaintext',async()=>{
  let stored,fail=false;const events=[];
  const api={runtime:{sendNativeMessage:async(host,message)=>{
    assert.equal(host,HOST);
    if(fail)throw new Error('disk full');
    if(message.type==='workspace.write')stored=message.workspace;
    if(message.type==='history.append')events.push(message.event);
    return {ok:true,workspace:stored};
  }},storage:{session:{get:()=>{throw new Error('unexpected fallback');},set:()=>{throw new Error('unexpected fallback');}}}};
  const vault=createVault(api);await vault.storage.set({workspace:{goal:'encrypted host'}});
  assert.equal((await vault.storage.get()).workspace.goal,'encrypted host');
  await vault.history({type:'approved'});assert.deepEqual(events,[{type:'approved'}]);
  fail=true;await assert.rejects(vault.storage.set({workspace:{goal:'changed'}}),/disk full/);
  assert.equal(stored.goal,'encrypted host');assert.equal((await vault.status()).connected,true);
});
