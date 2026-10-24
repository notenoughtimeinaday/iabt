import {Workspace} from './state.js';
import {bounded,webURL} from './core.js';
import {inspectDocument,performDocumentAction} from './page.js';
import {createVault,cleanNativeAction} from './native.js';

export function createController(api,clock=()=>Date.now()) {
  const vault=createVault(api);const workspace=new Workspace(vault.storage);const inspections=new Map();const proposals=new Map();
  const pageAddress=url=>{const value=new URL(url);return value.origin+value.pathname;};
  const active=async()=>{const [tab]=await api.tabs.query({active:true,lastFocusedWindow:true});if(!tab?.id)throw new Error('Open a web page and click the Jericho toolbar icon.');return tab;};
  const inspect=async()=>{
    const tab=await active();let result;
    try{[result]=await api.scripting.executeScript({target:{tabId:tab.id},func:inspectDocument});}catch{throw new Error('Click the Jericho toolbar icon on this page to grant temporary access. Browser settings, store pages and some documents cannot be inspected.');}
    if(!result?.result)throw new Error('No page content was available.');
    const snapshot=result.result;webURL(snapshot.url);const id=crypto.randomUUID();
    inspections.clear();proposals.clear();inspections.set(id,{...snapshot,tabId:tab.id,expires:clock()+120000});
    return {id,...snapshot};
  };
  async function handle(message,sender) {
    const panelURL=api.runtime.getURL('panel.html');
    if(sender.id!==api.runtime.id||sender.url?.split('?')[0]!==panelURL)throw new Error('Only the Jericho panel can request actions.');
    if(!message||typeof message.type!=='string')throw new Error('Invalid request.');
    switch(message.type) {
      case 'workspace.read':{const state=await workspace.read();return {state,vault:await vault.status()};}
      case 'workspace.mutate':return workspace.mutate(message.command,message.revision);
      case 'native.status':return {vault:await vault.connect()};
      case 'native.connect':{
        const temporary=await api.storage.session.get('workspace');const connected=await vault.connect();
        if(connected.connected){const current=await vault.rpc({type:'workspace.read'});if(!current.workspace&&temporary.workspace)await vault.rpc({type:'workspace.write',workspace:temporary.workspace});}
        return {vault:connected,state:await workspace.read()};
      }
      case 'native.cursor':return vault.rpc({type:'cursor.read'});
      case 'native.windows':return vault.rpc({type:'windows.list'});
      case 'native.perform':return vault.rpc({type:'control.perform',id:crypto.randomUUID(),action:cleanNativeAction(message.action)});
      case 'history.search':return vault.rpc({type:'history.search',query:bounded(message.query||'',100)});
      case 'history.record':await vault.history({type:'command',command:bounded(message.command,12000)});return {};
      case 'navigate':{const url=webURL(message.url);await vault.history({type:'tab.open_requested',url:pageAddress(url)});await api.tabs.create({url});await vault.history({type:'tab.opened',url:pageAddress(url)});return {message:'Opened in a new tab.'};}
      case 'inspect':{const snapshot=await inspect();await vault.history({type:'page.inspected',url:pageAddress(snapshot.url)});return {snapshot};}
      case 'capture':{const snapshot=inspections.get(message.id);if(!snapshot)throw new Error('Inspect the page first.');return workspace.mutate({type:'capture',capture:{url:snapshot.url,title:snapshot.title,text:snapshot.text}},message.revision);}
      case 'page.propose':{
        const snapshot=inspections.get(message.id);const tab=await active();
        if(!snapshot||snapshot.expires<clock()||snapshot.tabId!==tab.id)throw new Error('Page access expired or the active tab changed. Inspect again.');
        const control=snapshot.controls.find(c=>c.index===message.index);if(!control||control.kind==='manual')throw new Error('Use this control directly on the page.');
        const id=crypto.randomUUID();const value=control.kind==='fill'?bounded(message.value,2000):undefined;
        const proposal={...control,value,url:snapshot.url,documentId:snapshot.documentId,tabId:tab.id,expires:clock()+60000};
        proposals.clear();proposals.set(id,proposal);
        await vault.history({type:'page.action_proposed',id,kind:control.kind,label:control.label,url:pageAddress(snapshot.url)});
        return {proposal:{id,label:control.label,kind:control.kind,url:snapshot.url,value}};
      }
      case 'page.cancel':proposals.clear();await vault.history({type:'page.action_cancelled'});return {message:'Action cancelled.'};
      case 'page.execute':{
        const proposal=proposals.get(message.id);proposals.delete(message.id);
        if(!proposal||proposal.expires<clock()||message.confirmed!==true)throw new Error('Review and confirm this specific action again.');
        if((await active()).id!==proposal.tabId)throw new Error('The active tab changed. Inspect it again.');
        await vault.history({type:'page.action_approved',id:message.id,kind:proposal.kind,label:proposal.label,url:pageAddress(proposal.url)});
        try {
          const [result]=await api.scripting.executeScript({target:{tabId:proposal.tabId},func:performDocumentAction,args:[proposal]});
          inspections.clear();if(!result?.result?.performed)throw new Error('The page did not confirm the action.');
          await vault.history({type:'page.action_dispatched',id:message.id,kind:proposal.kind});return result.result;
        } catch(error) {await vault.history({type:'page.action_unconfirmed',id:message.id,kind:proposal.kind});throw error;}
      }
      default:throw new Error('Unknown browser capability.');
    }
  }
  return {handle};
}

if(typeof chrome!=='undefined'&&chrome.runtime?.onMessage) {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
  chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
  const controller=createController(chrome);
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    controller.handle(message,sender).then(data=>reply({ok:true,...data}),error=>reply({ok:false,error:error.message||'The action could not be completed.'}));return true;
  });
}
