export const VERSION = 1;
export const STUDIO_URL = 'https://jericho-studio.onrender.com/#/studio';
export const DEFAULT_APPEARANCE = Object.freeze({theme:'night',density:'comfortable',textSize:'normal'});
export const LIMITS = Object.freeze({goals:2000,notes:12000,steps:100,tools:20,captures:50});
export const TOOL_KINDS = Object.freeze(['checklist','notes','links','calculator']);
export const CAPABILITIES = Object.freeze([
  ['open <address>', 'Open a web page or search in a new tab'],
  ['goal <your objective>', 'Remember your explicit goal on this device'],
  ['step <next action>', 'Add a step to your goal'],
  ['note <text>', 'Add a private workspace note'],
  ['inspect page', 'Read visible page text and available controls'],
  ['move cursor to 400, 300', 'Review a physical cursor movement; Windows companion required'],
  ['click at 400, 300', 'Review one desktop click; a Windows confirmation is required'],
  ['type <text> / press ENTER', 'Review typing in the window selected under Control'],
  ['scroll down 3 at 400, 300', 'Review scrolling at a physical desktop coordinate'],
  ['use light mode', 'Change Jericho’s appearance'],
  ['use compact layout', 'Adjust panel spacing'],
  ['use large text', 'Increase text size'],
  ['build a checklist', 'Create a customizable local tool'],
  ['undo', 'Restore the previous appearance'],
]);
export function bounded(value,max=12000) {
  if(typeof value!=='string'||value.length>max) throw new Error(`Text must be at most ${max} characters.`);
  return value.replaceAll('\u0000','').trim();
}
export function webURL(input) {
  const value=bounded(input,4096);
  if(!/^https?:\/\//i.test(value)) throw new Error('Use an http or https web address.');
  const url=new URL(value);
  if(url.username||url.password) throw new Error('Addresses cannot include credentials.');
  return url.href;
}
export function navigateInput(input) {
  const value=bounded(input,4096);
  if(!value) throw new Error('Enter an address or search words.');
  if(/^https?:\/\//i.test(value)) return webURL(value);
  if(/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^localhost:\d+/.test(value)) throw new Error('Unsupported address type.');
  if(/^(localhost|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(value)) return webURL('https://'+value);
  return 'https://duckduckgo.com/?q='+encodeURIComponent(value);
}
export function cleanAppearance(value) {
  if(!value||!['night','day'].includes(value.theme)||!['comfortable','compact'].includes(value.density)||!['normal','large'].includes(value.textSize)) throw new Error('Invalid appearance settings.');
  return {theme:value.theme,density:value.density,textSize:value.textSize};
}
export function cleanTool(raw) {
  if(!raw||typeof raw!=='object'||!TOOL_KINDS.includes(raw.kind)) throw new Error('Tool kind must be checklist, notes, links or calculator.');
  const title=bounded(raw.title,80); if(!title) throw new Error('A tool needs a title.');
  const tool={schema:1,title,kind:raw.kind,description:bounded(raw.description||'',300)};
  if(raw.kind==='checklist') {
    if(!Array.isArray(raw.items)||raw.items.length>50) throw new Error('A checklist supports up to 50 starting items.');
    tool.items=raw.items.map(item=>bounded(item,300)).filter(Boolean);
  }
  if(raw.kind==='links') {
    if(!Array.isArray(raw.links)||raw.links.length>30) throw new Error('A link tool supports up to 30 links.');
    tool.links=raw.links.map(link=>({label:bounded(link.label,80),url:webURL(link.url)}));
  }
  return tool; // Unknown fields (including scripts/permissions) never survive validation.
}
export function toolData(spec,input={}) {
  if(spec.kind==='checklist') {
    const items=input.items||spec.items.map(text=>({text,done:false}));
    if(!Array.isArray(items)||items.length>100) throw new Error('A tool supports up to 100 tasks.');
    return {items:items.map(item=>({text:bounded(item.text,300),done:item.done===true}))};
  }
  if(spec.kind==='notes') return {text:bounded(input.text||'',20000)};
  return {};
}
export function initialState() {
  return {schema:VERSION,revision:0,goal:'',notes:'',steps:[],captures:[],tools:[],appearance:{...DEFAULT_APPEARANCE},undo:[],activity:[]};
}
export function validateState(raw) {
  if(!raw||raw.schema!==VERSION) throw new Error('Unknown workspace version. Original data has been preserved.');
  const list=(value,max)=>{if(!Array.isArray(value)||value.length>max)throw new Error('Invalid workspace data.');return value;};
  const id=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(value))throw new Error('Invalid item ID.');return value;};
  if(!Number.isSafeInteger(raw.revision)||raw.revision<0)throw new Error('Invalid workspace revision.');
  return {
    schema:VERSION,revision:raw.revision,goal:bounded(raw.goal,2000),notes:bounded(raw.notes),appearance:cleanAppearance(raw.appearance),
    steps:list(raw.steps,100).map(s=>({id:id(s.id),text:bounded(s.text,500),done:s.done===true})),
    captures:list(raw.captures,50).map(c=>({id:id(c.id),title:bounded(c.title,300),url:webURL(c.url),text:bounded(c.text),created:bounded(c.created,50)})),
    tools:list(raw.tools,20).map(t=>{const spec=cleanTool(t.spec);return {id:id(t.id),spec,data:toolData(spec,t.data)};}),
    undo:list(raw.undo,10).map(cleanAppearance),
    activity:list(raw.activity,40).map(a=>({message:bounded(a.message,300),created:bounded(a.created,50)})),
  };
}
export function parseCommand(input) {
  const value=bounded(input);let m;
  if((m=value.match(/^\/?(?:open|go to)\s+(.+)$/i)))return {type:'navigate',url:navigateInput(m[1])};
  if((m=value.match(/^\/?search(?: for)?\s+(.+)$/i)))return {type:'navigate',url:'https://duckduckgo.com/?q='+encodeURIComponent(m[1])};
  if((m=value.match(/^\/?(?:goal|my goal is|set my goal to)\s+(.+)$/i)))return {type:'goal',text:bounded(m[1],2000)};
  if((m=value.match(/^\/?(?:step|add a step)\s+(.+)$/i)))return {type:'step.add',text:bounded(m[1],500)};
  if((m=value.match(/^\/?(?:note|remember)\s+(.+)$/i)))return {type:'note.append',text:bounded(m[1])};
  if(/^\/?(?:inspect|inspect page|read this page)$/i.test(value))return {type:'inspect'};
  if((m=value.match(/^\/?(?:theme\s+|use\s+|switch to\s+)(night|day|dark|light)(?: mode)?$/i)))return {type:'appearance',patch:{theme:['night','dark'].includes(m[1].toLowerCase())?'night':'day'}};
  if((m=value.match(/^\/?(?:density\s+|use\s+)(comfortable|compact)(?: layout)?$/i)))return {type:'appearance',patch:{density:m[1].toLowerCase()}};
  if((m=value.match(/^\/?use (large|normal) text$/i)))return {type:'appearance',patch:{textSize:m[1].toLowerCase()}};
  if(/^\/?undo$/i.test(value))return {type:'appearance.undo'};
  if((m=value.match(/^\/?(?:build|create) (?:a |an )?(checklist|task tracker|notes|notepad|links|calculator)$/i))) {
    const kind=({'task tracker':'checklist',notepad:'notes'})[m[1].toLowerCase()]||m[1].toLowerCase();
    return {type:'tool.preview',spec:cleanTool({kind,title:{checklist:'My checklist',notes:'My notes',links:'My links',calculator:'Calculator'}[kind],items:[],links:[]})};
  }
  throw new Error('This prototype understands the commands in Help. Custom app creation opens in Jericho Studio; arbitrary website procedures are not yet supported.');
}
export function calculate(source) {
  const value=bounded(source,200).replace(/\s+/g,'');
  if(!value||!/^[\d.()+*/-]+$/.test(value))throw new Error('Use numbers, parentheses and + − × ÷.');
  const tokens=value.match(/\d+(?:\.\d*)?|\.\d+|[()+*/-]/g)||[];
  if(tokens.join('')!==value||tokens.length>100)throw new Error('Invalid expression.');
  let index=0;
  const atom=()=>{const token=tokens[index++];if(token==='-')return -atom();if(token==='+')return atom();if(token==='('){const v=expression();if(tokens[index++]!==')')throw new Error('Close the parentheses.');return v;}if(token===undefined||!/^(?:\d|\.)/.test(token))throw new Error('Expected a number.');return Number(token);};
  const product=()=>{let v=atom();while(['*','/'].includes(tokens[index])){const op=tokens[index++],right=atom();v=op==='*'?v*right:v/right;}return v;};
  const expression=()=>{let v=product();while(['+','-'].includes(tokens[index])){const op=tokens[index++],right=product();v=op==='+'?v+right:v-right;}return v;};
  const result=expression();if(index!==tokens.length||!Number.isFinite(result))throw new Error('The expression has no finite result.');return result;
}
