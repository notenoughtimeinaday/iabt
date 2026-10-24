import {calculate,navigateInput} from './core.js';
export function el(tag,text,className) {const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
export function button(text,action,className='secondary') {const node=el('button',text,className);node.type='button';node.addEventListener('click',action);return node;}
export function renderTool(tool,{save,navigate,onError,preview=false}) {
  const root=el('section',undefined,'card tool');root.setAttribute('aria-label',tool.spec.title);
  const header=el('header');header.append(el('h3',tool.spec.title),el('span',tool.spec.kind,'quiet'));root.append(header);
  if(tool.spec.description)root.append(el('p',tool.spec.description,'hint'));
  const guarded=fn=>async()=>{try{await fn();}catch(e){onError(e.message);}};
  if(tool.spec.kind==='checklist') {
    const items=tool.data.items;
    items.forEach((item,index)=>{const control=button('',guarded(()=>save({...tool.data,items:items.map((v,i)=>i===index?{...v,done:!v.done}:v)})),'step'+(item.done?' done':''));control.setAttribute('aria-label',(item.done?'Reopen ':'Complete ')+item.text);control.append(el('span',item.done?'✓':'○'),el('span',item.text));root.append(control);});
    const form=el('form',undefined,'inline'),input=el('input');input.placeholder='Add a task…';input.maxLength=300;input.required=true;input.setAttribute('aria-label','New task for '+tool.spec.title);const add=el('button','＋','icon');add.setAttribute('aria-label','Add task');form.append(input,add);
    form.addEventListener('submit',e=>{e.preventDefault();guarded(async()=>{if(!input.value.trim())return;await save({items:[...items,{text:input.value,done:false}]});input.value='';})();});root.append(form);
  } else if(tool.spec.kind==='notes') {
    const input=el('textarea');input.rows=5;input.maxLength=20000;input.value=tool.data.text||'';input.placeholder='Make this space useful…';input.setAttribute('aria-label',tool.spec.title);root.append(input,button('Save note',guarded(()=>save({text:input.value}))));
  } else if(tool.spec.kind==='calculator') {
    const form=el('form'),input=el('input'),output=el('output');input.placeholder='(125 × 4) + 60';input.maxLength=200;input.setAttribute('aria-label','Calculator expression');form.append(input,button('Calculate',()=>{try{output.value=String(calculate(input.value.replaceAll('×','*').replaceAll('÷','/')));}catch(e){onError(e.message);}}),output);form.addEventListener('submit',e=>{e.preventDefault();try{output.value=String(calculate(input.value));}catch(err){onError(err.message);}});root.append(form);
  } else if(tool.spec.kind==='links') {
    const links=el('div',undefined,'linkList');for(const link of tool.spec.links)links.append(button(link.label,guarded(()=>navigate(navigateInput(link.url)))));if(!tool.spec.links.length)links.append(el('p','Add links in the JSON tool definition.','hint'));root.append(links);
  }
  if(preview)root.prepend(el('span','PREVIEW · NOT INSTALLED','previewTag'));
  return root;
}
