import {CAPABILITIES,STUDIO_URL,cleanTool,parseCommand,toolData,validateState} from './core.js';
import {el,button,renderTool} from './ui.js';
import {cleanNativeAction,parseNativeCommand} from './native.js';

const $=id=>document.getElementById(id);
let state, snapshot, recognition, voiceConsent=false, targetWindows=[];
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
const safely=fn=>async(...args)=>{try{return await fn(...args);}catch(error){status(error.message,true);}};
async function call(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw new Error(result?.error||'The extension could not respond. Reload the extension and reopen Jericho.');return result;}
async function mutate(command){const result=await call({type:'workspace.mutate',command,revision:state.revision});render(result.state);status(result.message);return result;}
function view(name){for(const node of document.querySelectorAll('.view'))node.hidden=node.id!==name;for(const node of document.querySelectorAll('[data-view]'))node.setAttribute('aria-pressed',String(node.dataset.view===name));}
function modal(title,...content){$('modalTitle').textContent=title;$('modalBody').replaceChildren(...content);if(!$('modal').open)$('modal').showModal();}
function close(){if($('modal').open)$('modal').close();}
function labeled(label,input){const wrapper=el('label',undefined,'fieldLabel');wrapper.append(el('span',label),input);return wrapper;}
function actions(...buttons){const row=el('div',undefined,'dialogActions');row.append(...buttons);return row;}
async function navigate(url){const result=await call({type:'navigate',url});status(result.message);}
function render(next){
  const previous=state;state=next;document.body.dataset.theme=state.appearance.theme;document.body.dataset.density=state.appearance.density;document.body.dataset.size=state.appearance.textSize;
  if(!previous||$('goal').value===previous.goal)$('goal').value=state.goal;
  if(!previous||$('notes').value===previous.notes)$('notes').value=state.notes;
  $('stepCount').textContent=`${state.steps.filter(s=>s.done).length} / ${state.steps.length} complete`;
  $('steps').replaceChildren(...state.steps.map(step=>{const node=button('',safely(()=>mutate({type:'step.toggle',id:step.id})),'step'+(step.done?' done':''));node.setAttribute('aria-label',(step.done?'Reopen ':'Complete ')+step.text);node.append(el('span',step.done?'✓':'○'),el('span',step.text));return node;}));
  if(!state.steps.length)$('steps').append(el('p','Turn a large goal into a few concrete next steps.','hint'));
  $('captures').replaceChildren(...state.captures.map(c=>{const item=el('details',undefined,'card');item.append(el('summary',c.title||c.url),el('p',c.url,'url'),el('p',c.text,'pageText'));return item;}));
  if(!state.captures.length)$('captures').append(el('p','No snapshots saved yet.','hint'));
  $('toolList').replaceChildren(...state.tools.map(tool=>renderTool(tool,{save:data=>mutate({type:'tool.data',id:tool.id,data}),navigate,onError:message=>status(message,true)})));
  if(!state.tools.length){const empty=el('div',undefined,'empty');empty.append(el('span','✧'),el('h3','Make room for your own tools'),el('p','Create a checklist, notes panel, link collection or calculator. Import a definition to make it yours.'));$('toolList').append(empty);}
  $('activityList').replaceChildren(...state.activity.map(item=>el('li',item.message)));
}
function previewTool(spec){
  const clean=cleanTool(spec);let data=toolData(clean);
  const area=el('div');const redraw=()=>area.replaceChildren(renderTool({spec:clean,data},{preview:true,save:async next=>{data=toolData(clean,next);redraw();},navigate:async()=>status('Links open after installation.'),onError:message=>status(message,true)}));redraw();
  modal('Preview your tool',el('p','Check the tool before adding it. Preview changes are temporary. The installed tool starts from its definition.','hint'),area,actions(button('Back to definition',()=>editTool(clean)),button('Install tool',safely(async()=>{await mutate({type:'tool.install',spec:clean});close();view('tools');}),'primary')));
}
function editTool(value={schema:1,kind:'checklist',title:'My project checklist',description:'Keep the important steps in view.',items:['Define the outcome','Verify it works','Save the result']}){
  const input=el('textarea',undefined,'spec');input.value=JSON.stringify(value,null,2);input.maxLength=30000;input.setAttribute('aria-label','Tool JSON definition');
  modal('Design a tool',el('p','Edit a definition or paste one created by Jericho. Supported kinds: checklist, notes, links and calculator. Scripts and additional permissions are not supported.','hint'),input,actions(button('Ask Jericho to design it',()=>studio(true)),button('Validate & preview',safely(()=>previewTool(JSON.parse(input.value))),'primary')));
}
function newTool(){
  const title=el('input');title.value='My checklist';title.maxLength=80;
  const kind=el('select');for(const value of ['checklist','notes','links','calculator']){const option=el('option',value);option.value=value;kind.append(option);}
  modal('Create a local tool',labeled('Tool name',title),labeled('Tool type',kind),actions(button('Edit JSON instead',()=>editTool()),button('Preview',safely(()=>previewTool({kind:kind.value,title:title.value,items:[],links:[]})),'primary')));
}
function studio(toolRequest=false){
  const request=el('textarea');request.rows=9;request.maxLength=12000;request.setAttribute('aria-label','Request to share with Jericho Studio');
  request.value=toolRequest?`Create a JSON tool definition for my Jericho browser companion. Goal: ${state.goal||'[describe my goal]'}\nUse schema 1 and one kind: checklist, notes, links, calculator. Include title and description. Checklist uses an items array of strings; links uses a links array of {label,url} with https addresses. No scripts, executable code, HTML or permissions. Return the complete JSON so I can paste it into the extension's tool designer.`:`Help me with this goal: ${state.goal||'[describe my goal]'}\nCreate a useful app, document or proposed next step. State what is implemented and what still needs verification.`;
  modal('Review your Studio request',el('p','Opening Studio shares the text below with your existing Jericho account. Page captures and notes are not added. Opening the tab does not submit a creation job; Studio applies its own sign-in, availability and credit requirements.','hint'),request,actions(button('Cancel',close),button('Open Jericho Studio',safely(async()=>{await navigate(STUDIO_URL+'?prompt='+encodeURIComponent(request.value));close();}),'primary')));
}
async function inspect(){
  status('Reading the page you authorized…');const result=await call({type:'inspect'});snapshot=result.snapshot;
  $('pageEmpty').hidden=true;$('pageResult').hidden=false;$('pageTitle').textContent=snapshot.title||'Untitled page';$('pageUrl').textContent=snapshot.url;$('pageText').textContent=snapshot.text||'No visible text found.';
  $('pageControls').replaceChildren(...snapshot.controls.map(control=>{const row=el('div',undefined,'control');row.append(el('span',control.label),control.kind==='manual'?el('span','Use page','quiet'):button(control.kind==='fill'?'Prepare fill':'Prepare click',()=>prepare(control)));return row;}));
  status('Page inspected. Its content is reference material; it cannot authorize actions.');view('page');
}
function prepare(control){
  const input=el('textarea');input.maxLength=2000;input.rows=3;input.setAttribute('aria-label','Value to enter');
  const review=safely(async()=>{
    const {proposal}=await call({type:'page.propose',id:snapshot.id,index:control.index,value:input.value});
    const description=el('p',`${proposal.kind==='fill'?'Fill':'Click'} “${proposal.label}”`);const target=el('p',proposal.url,'url');const content=[description,target];
    if(proposal.kind==='fill')content.push(el('pre',proposal.value,'pageText'));
    content.push(el('p','Check the target and value. Website handlers can have effects beyond the visible control. Sensitive fields and recognized payment, account, send and destructive controls require direct interaction.','hint'));
    const execute=button('Perform this action',safely(async()=>{execute.disabled=true;try{const result=await call({type:'page.execute',id:proposal.id,confirmed:true});close();snapshot=null;$('pageResult').hidden=true;$('pageEmpty').hidden=false;status(result.message);}finally{execute.disabled=false;}}),'primary');
    modal('Review page action',...content,actions(button('Cancel',safely(async()=>{await call({type:'page.cancel'});close();})),execute));
  });
  if(control.kind==='click')review();else modal('Prepare field value',el('p',control.label),input,actions(button('Review action',review,'primary')));
}
function download(name,value){const url=URL.createObjectURL(new Blob([value],{type:'application/json'}));const anchor=el('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function settings(){
  const controls=el('div');for(const [key,label,values]of [['theme','Theme',['night','day']],['density','Spacing',['comfortable','compact']],['textSize','Text size',['normal','large']]]){const select=el('select');for(const value of values){const option=el('option',value);option.value=value;select.append(option);}select.value=state.appearance[key];select.addEventListener('change',safely(()=>mutate({type:'appearance',patch:{[key]:select.value}})));controls.append(labeled(label,select));}
  const file=el('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Restore workspace backup');
  file.addEventListener('change',safely(async()=>{const selected=file.files[0];if(!selected)return;if(selected.size>2000000)throw new Error('Backup is too large.');const restored=validateState(JSON.parse(await selected.text()));modal('Restore this backup?',el('p','This replaces your current local goal, notes and tools. Export the current workspace first if you want to keep it.','hint'),el('p',`${restored.steps.length} steps · ${restored.tools.length} tools · ${restored.captures.length} page snapshots`),actions(button('Cancel',close),button('Replace with this backup',safely(async()=>{await mutate({type:'restore',workspace:restored});$('goal').value=state.goal;$('notes').value=state.notes;close();}),'primary')));}));
  modal('Make Jericho yours',controls,actions(button('Undo appearance',safely(async()=>{await mutate({type:'appearance.undo'});settings();})),button('Export workspace',()=>modal('Export a readable backup?',el('p','This JSON copy is NOT encrypted. It contains your current goal, notes, tools and snapshots. Save it somewhere private. It does not include the complete encrypted activity history.','hint'),actions(button('Cancel',close),button('Export readable JSON',()=>{download('iabt-master-control-workspace.json',JSON.stringify(state,null,2));close();},'primary'))))),labeled('Restore from a JSON backup',file),el('p','With the Windows companion connected, workspace changes and activity persist in your encrypted computer folder. Otherwise work lasts only for this browser session. Appearance changes affect Master Control’s panel.','footnote'));
}
function help(){const list=el('div',undefined,'stack');for(const [command,effect]of CAPABILITIES){const card=el('div',undefined,'card');card.append(el('strong',command),el('p',effect,'hint'));list.append(card);}modal('Supported commands',el('p','Typed and dictated commands use the same bounded command interpreter. This prototype has no automatic AI planner and cannot complete arbitrary procedures.','hint'),list);}
async function runCommand(value){const target=targetWindows.find(window=>window.id===$('targetWindow').value);const native=parseNativeCommand(value,target?{window:target.id,title:target.title}:undefined);const command=native?null:parseCommand(value);await call({type:'history.record',command:native?.kind==='type'?`type [${native.text.length} characters; value omitted]`:value});if(native)return reviewNative(native);if(command.type==='navigate')return navigate(command.url);if(command.type==='inspect')return inspect();if(command.type==='tool.preview')return previewTool(command.spec);const result=await mutate(command);if(command.type==='goal')$('goal').value=result.state.goal;if(command.type==='note.append')$('notes').value=result.state.notes;}

function vaultState(vault){$('vaultStatus').textContent=vault?.connected?'● Encrypted computer folder connected':'○ Temporary session · encrypted folder not connected';$('vaultStatus').classList.toggle('connected',vault?.connected===true);$('saveMode').textContent=vault?.connected?'Encrypted on this computer':'Temporary browser session';}
async function reviewNative(raw){
  const action=cleanNativeAction(raw);const details=el('pre',JSON.stringify(action,null,2),'pageText');
  const perform=button('Request Windows permission',safely(async()=>{perform.disabled=true;status('Waiting for your Windows permission confirmation…');try{const result=await call({type:'native.perform',action});close();status(result.message||'Action returned. Verify the screen before continuing.');}finally{perform.disabled=false;}}),'primary');
  modal('Review computer action',details,el('p','A separate Windows dialog will ask you to approve this exact action. Native clicks can activate anything at the selected coordinates; check the screen before approving. Keyboard values are omitted from the action log.','hint'),actions(button('Cancel',close),perform));
}
function targetWindow(){const selected=targetWindows.find(window=>window.id===$('targetWindow').value);if(!selected)throw new Error('Load and choose a target window first.');return {window:selected.id,title:selected.title};}
function searchHistory(){const input=el('input');input.placeholder='Search your saved activity…';input.maxLength=100;input.setAttribute('aria-label','History search');const results=el('div',undefined,'stack');const search=button('Search local history',safely(async()=>{const result=await call({type:'history.search',query:input.value});results.replaceChildren(...result.items.map(item=>{const card=el('div',undefined,'card');card.append(el('h3',item.type),el('p',item.timestamp,'quiet'),el('p',item.summary,'hint'));return card;}));if(!result.items.length)results.append(el('p','No matching history found.','hint'));}));modal('Encrypted activity history',el('p','Search runs on your computer. It returns at most 50 recent matches; older encrypted records remain in the folder.','hint'),input,search,results);}
function startVoice(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){status('Speech recognition is unavailable in this browser. Use your operating system’s dictation in the command box, or type.',true);$('command').focus();return;}
  if(recognition){recognition.abort();return;}
  if(!voiceConsent){modal('Enable voice input for this visit?',el('p','Your browser may send microphone audio to its speech recognition service. Jericho does not record audio or send it to an AI provider. Dictation only fills the command box; you review it and press Run.','hint'),actions(button('Use keyboard',close),button('Enable microphone',()=>{voiceConsent=true;close();startVoice();},'primary')));return;}
  recognition=new SpeechRecognition();recognition.lang=navigator.language||'en-US';recognition.continuous=false;recognition.interimResults=true;
  let heard='';recognition.onresult=event=>{heard=Array.from(event.results).map(result=>result[0].transcript).join(' ');$('command').value=heard;$('voiceState').textContent='Transcribing… review before running';};
  recognition.onerror=event=>{status(event.error==='not-allowed'?'Microphone access was denied. Check browser permissions or use keyboard dictation.':'Speech recognition could not finish. Use keyboard or OS dictation; no command was run.',true);};
  recognition.onend=()=>{recognition=null;$('micButton').classList.remove('listening');$('micButton').setAttribute('aria-label','Dictate command');$('voiceState').textContent=heard?'Dictation ready · review, then Run':'Keyboard ready · voice is opt-in';};
  try{recognition.start();$('micButton').classList.add('listening');$('micButton').setAttribute('aria-label','Stop dictation');$('voiceState').textContent='Listening · tap microphone to stop';}catch(error){recognition=null;status('Voice could not start. Use keyboard or OS dictation.',true);}
}
for(const node of document.querySelectorAll('[data-view]'))node.addEventListener('click',()=>view(node.dataset.view));
$('goalForm').addEventListener('submit',safely(async event=>{event.preventDefault();await mutate({type:'goal',text:$('goal').value});}));
$('notesForm').addEventListener('submit',safely(async event=>{event.preventDefault();await mutate({type:'notes',text:$('notes').value});}));
$('stepForm').addEventListener('submit',safely(async event=>{event.preventDefault();await mutate({type:'step.add',text:$('step').value});$('step').value='';}));
$('commandForm').addEventListener('submit',safely(async event=>{event.preventDefault();await runCommand($('command').value);$('command').value='';}));
$('command').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$('commandForm').requestSubmit();}});
$('closeModal').addEventListener('click',close);$('settingsButton').addEventListener('click',settings);$('helpButton').addEventListener('click',help);$('studioButton').addEventListener('click',()=>studio());$('newToolButton').addEventListener('click',newTool);$('importToolButton').addEventListener('click',()=>editTool());$('inspectButton').addEventListener('click',safely(inspect));$('micButton').addEventListener('click',startVoice);
$('captureButton').addEventListener('click',safely(async()=>{if(!snapshot)throw new Error('Inspect a page first.');const result=await call({type:'capture',id:snapshot.id,revision:state.revision});render(result.state);status(result.message);}));
$('readButton').addEventListener('click',()=>{if(!('speechSynthesis'in window)){status('Speech output is unavailable in this browser.',true);return;}const voices=speechSynthesis.getVoices().filter(voice=>voice.localService);if(!voices.length){status('No local speech voice is available. Read the result above.',true);return;}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance($('status').textContent);utterance.voice=voices.find(v=>v.lang===navigator.language)||voices[0];speechSynthesis.speak(utterance);});
window.addEventListener('pagehide',()=>{recognition?.abort();window.speechSynthesis?.cancel();});
$('connectFolder').addEventListener('click',safely(async()=>{const result=await call({type:'native.connect'});vaultState(result.vault);render(result.state);status(result.vault.connected?'Encrypted folder connected. Workspace changes and history now persist on this computer.':result.vault.message,!result.vault.connected);}));
$('readCursor').addEventListener('click',safely(async()=>{const result=await call({type:'native.cursor'});$('cursorX').value=result.x;$('cursorY').value=result.y;status(`Cursor position: ${result.x}, ${result.y}`);}));
for(const node of document.querySelectorAll('[data-pointer]'))node.addEventListener('click',safely(()=>reviewNative({kind:node.dataset.pointer,x:Number($('cursorX').value),y:Number($('cursorY').value)})));
$('listWindows').addEventListener('click',safely(async()=>{const result=await call({type:'native.windows'});targetWindows=result.windows;$('targetWindow').replaceChildren(...targetWindows.map(window=>{const option=el('option',window.title);option.value=window.id;return option;}));status('Choose the exact window that should receive input.');}));
$('typeNative').addEventListener('click',safely(()=>reviewNative({kind:'type',...targetWindow(),text:$('nativeText').value})));
$('keyNative').addEventListener('click',safely(()=>reviewNative({kind:'key',...targetWindow(),key:$('nativeKey').value})));
$('historyButton').addEventListener('click',searchHistory);
await safely(async()=>{const result=await call({type:'workspace.read'});render(result.state);vaultState(result.vault);})();
