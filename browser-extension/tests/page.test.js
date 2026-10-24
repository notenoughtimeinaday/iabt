import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {inspectDocument,performDocumentAction} from '../page.js';
function fixture(html) {
  const dom=new JSDOM(html,{url:'https://example.test/work',pretendToBeVisual:true});const w=dom.window;
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;},set(value){this.textContent=value;}});
  for(const key of ['document','location','NodeFilter','HTMLInputElement','HTMLTextAreaElement','Event'])Object.defineProperty(globalThis,key,{value:w[key],configurable:true});
  globalThis.getComputedStyle=w.getComputedStyle.bind(w);w.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{}];};return dom;
}
function request(snapshot,control,value){return {...control,url:snapshot.url,documentId:snapshot.documentId,value};}
test('inspection excludes input values, scripts, hidden and editable text',()=>{fixture('<p>Visible context</p><input value="SECRET"><textarea>PRIVATE</textarea><script>BAD</script><div hidden>HIDDEN</div><div contenteditable>EDITING</div>');const snapshot=inspectDocument();assert.match(snapshot.text,/Visible context/);assert.doesNotMatch(snapshot.text,/SECRET|PRIVATE|BAD|HIDDEN|EDITING/);});
test('reviewed fill uses native value setter and does not submit',()=>{const dom=fixture('<label for="q">Search</label><input id="q" type="search"><form><button>Submit</button></form>');let submits=0;dom.window.document.querySelector('form').addEventListener('submit',()=>submits++);const snap=inspectDocument();const result=performDocumentAction(request(snap,snap.controls[0],'oak trees'));assert.equal(result.performed,true);assert.equal(document.querySelector('#q').value,'oak trees');assert.equal(submits,0);});
test('changed document or label invalidates an approved action',()=>{fixture('<button type="button">Expand details</button>');const snap=inspectDocument();assert.throws(()=>performDocumentAction({...request(snap,snap.controls[0]),documentId:'old'}),/changed/);document.querySelector('button').textContent='Pay';assert.throws(()=>performDocumentAction(request(snap,snap.controls[0])),/changed/);});
test('recognized sensitive fields and consequential controls require manual use',()=>{fixture('<input name="password" type="password"><button type="button">Pay invoice</button><button>Continue</button>');const snap=inspectDocument();assert.equal(snap.controls[0].kind,'manual');assert.throws(()=>performDocumentAction({...request(snap,snap.controls[0],'secret'),kind:'fill'}),/sensitive/);assert.throws(()=>performDocumentAction(request(snap,snap.controls[1])),/directly/);assert.throws(()=>performDocumentAction(request(snap,snap.controls[2])),/directly/);});
test('safe button clicks run only the selected current element',()=>{fixture('<button type="button">Expand details</button><button type="button">Other</button>');let clicks=0;document.querySelector('button').addEventListener('click',()=>clicks++);const snap=inspectDocument();performDocumentAction(request(snap,snap.controls[0]));assert.equal(clicks,1);});
test('newly hidden controls invalidate actions',()=>{fixture('<button type="button">Expand details</button>');const snap=inspectDocument();document.querySelector('button').hidden=true;assert.throws(()=>performDocumentAction(request(snap,snap.controls[0])),/changed/);});
