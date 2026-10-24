// These fixed, reviewed functions are serialized by chrome.scripting. Page text
// never becomes code, a command, a permission grant, or a provider request.
export function inspectDocument() {
  const visible=el=>{const s=getComputedStyle(el);return el.getClientRects().length>0&&s.display!=='none'&&s.visibility!=='hidden'&&!el.closest('[hidden],[aria-hidden="true"],dialog:not([open])');};
  const label=el=>(el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.getAttribute('placeholder')||el.getAttribute('title')||el.name||el.tagName).replace(/\s+/g,' ').trim().slice(0,160);
  const fingerprint=el=>JSON.stringify([el.tagName,el.getAttribute('type'),label(el),el.getAttribute('href'),el.getAttribute('name'),el.form?.getAttribute('action')||'']);
  const elements=[...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"]')];
  const controls=elements.map((el,index)=>({el,index})).filter(({el})=>visible(el)&&!el.disabled).slice(0,100).map(({el,index})=>{
    const type=(el.getAttribute('type')||'text').toLowerCase();
    const sensitive=/password|credit|card.?number|cvc|cvv|security.?code|otp|one.?time|social.?security|ssn|token|api.?key/i.test([type,el.name,el.id,el.autocomplete,label(el)].join(' '));
    const kind=el.tagName==='TEXTAREA'||(el.tagName==='INPUT'&&['text','search','email','tel','url','number'].includes(type))?'fill':['A','BUTTON'].includes(el.tagName)||el.getAttribute('role')==='button'?'click':'manual';
    return {index,label:label(el),kind:sensitive?'manual':kind,fingerprint:fingerprint(el)};
  });
  // Walk rendered text nodes instead of serializing DOM or form values. This also
  // excludes scripts, passwords, editable content, hidden sections and SVG code.
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;const parts=[];let length=0;
  while((node=walker.nextNode())&&length<12000){const el=node.parentElement;if(!el||el.closest('script,style,noscript,input,textarea,select,[contenteditable],svg')||!visible(el))continue;const value=node.textContent.replace(/\s+/g,' ').trim();if(value){parts.push(value);length+=value.length+1;}}
  return {url:location.href,title:document.title.slice(0,300),text:parts.join('\n').slice(0,12000),documentId:String(performance.timeOrigin),controls};
}

export function performDocumentAction(request) {
  if(location.href!==request.url||String(performance.timeOrigin)!==request.documentId)throw new Error('The page changed. Inspect it again.');
  const elements=[...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"]')];const el=elements[request.index];
  if(!el)throw new Error('The control no longer exists.');
  const label=(el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.getAttribute('placeholder')||el.getAttribute('title')||el.name||el.tagName).replace(/\s+/g,' ').trim().slice(0,160);
  const fingerprint=JSON.stringify([el.tagName,el.getAttribute('type'),label,el.getAttribute('href'),el.getAttribute('name'),el.form?.getAttribute('action')||'']);
  const style=getComputedStyle(el);
  if(fingerprint!==request.fingerprint||el.disabled||el.getClientRects().length===0||style.display==='none'||style.visibility==='hidden'||el.closest('[hidden],[aria-hidden="true"]'))throw new Error('The control changed. Inspect it again.');
  if(/password|credit|card.?number|cvc|cvv|security.?code|otp|one.?time|social.?security|ssn|token|api.?key/i.test([el.type,el.name,el.id,el.autocomplete,label].join(' ')))throw new Error('Enter sensitive information directly on the page.');
  if(request.kind==='fill') {
    if(!((el.tagName==='INPUT'&&['text','search','email','tel','url','number'].includes(el.type))||el.tagName==='TEXTAREA')||el.readOnly)throw new Error('This field requires direct interaction.');
    if(typeof request.value!=='string'||request.value.length>2000)throw new Error('Invalid field value.');
    const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,request.value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    return {performed:el.value===request.value,message:'Field updated. No submit action was performed.'};
  }
  if(request.kind!=='click'||!(['A','BUTTON'].includes(el.tagName)||el.getAttribute('role')==='button'))throw new Error('Unsupported page action.');
  if(/\b(pay|buy|purchase|order|transfer|delete|remove|send|submit|publish|post|agree|accept|sign|authorize|connect|install|confirm|checkout|unsubscribe)\b/i.test(label)||el.type==='submit'||el.tagName==='A'&&!/^https?:$/.test(new URL(el.href,location.href).protocol))throw new Error('Complete this consequential action directly on the page.');
  el.click();return {performed:true,message:'Click dispatched. Check the page to verify its outcome.'};
}
