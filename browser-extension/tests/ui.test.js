import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {renderTool} from '../ui.js';
import {cleanTool,toolData} from '../core.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('installed checklist adds and completes tasks through the actual rendered controls',async()=>{
  const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
  const spec=cleanTool({kind:'checklist',title:'Garden plan',items:['Choose trees']});let data=toolData(spec);
  const render=()=>document.querySelector('main').replaceChildren(renderTool({spec,data},{save:async value=>{data=toolData(spec,value);render();},navigate:async()=>{},onError:message=>{throw new Error(message);}}));
  render();document.querySelector('.step').click();await tick();assert.equal(data.items[0].done,true);
  document.querySelector('input').value='Schedule delivery';document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();
  assert.equal(data.items[1].text,'Schedule delivery');assert.match(document.body.textContent,/Schedule delivery/);
});
test('tool names and saved text render as text, never as executable markup',()=>{
  const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
  const spec=cleanTool({kind:'notes',title:'<img src=x onerror=alert(1)>',description:'<script>bad()</script>'});
  document.body.append(renderTool({spec,data:toolData(spec,{text:'<svg onload=bad()>'})},{save:async()=>{},navigate:async()=>{},onError:()=>{}}));
  assert.equal(document.querySelector('script,img,svg'),null);assert.match(document.body.textContent,/<script>/);assert.match(document.querySelector('textarea').value,/<svg/);
});
test('every panel binding exists and the page has no inline execution or remote resources',async()=>{
  const html=await readFile(new URL('../panel.html',import.meta.url),'utf8');const js=await readFile(new URL('../panel.js',import.meta.url),'utf8');
  const dom=new JSDOM(html);const ids=[...dom.window.document.querySelectorAll('[id]')].map(el=>el.id);assert.equal(ids.length,new Set(ids).size);
  for(const match of js.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1]),'Missing UI element '+match[1]);
  assert.equal(dom.window.document.querySelector('[onclick],[onload],script:not([src])'),null);
  for(const el of dom.window.document.querySelectorAll('[src]'))assert.doesNotMatch(el.getAttribute('src'),/^https?:/);
});
