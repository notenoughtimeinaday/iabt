function clean(value: unknown, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return clean(value, 500)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleFor(requestText: string, spec: any) {
  const explicit = clean(spec?.title || spec?.name, 90);
  if (explicit) return explicit;
  const request = clean(requestText, 90);
  if (/piano/i.test(request)) return "Keyboard Piano";
  if (/merch|store|shop|e-?commerce/i.test(request)) return "IABT Store";
  return request || "IABT Application";
}

function textComponent(value: string) {
  return { type: "Text", props: { value } };
}

function buttonComponent(label: string, to?: string) {
  return { type: "Button", props: { label, ...(to ? { to } : {}) } };
}

export function createFallbackAppDefinition(requestText: string, spec: any = {}) {
  const title = titleFor(requestText, spec);
  const lower = (requestText + " " + JSON.stringify(spec || {})).toLowerCase();
  const piano = /piano|keyboard instrument|web audio|musical keyboard/.test(lower);
  const commerce = /merch|store|shop|e-?commerce|shopping cart|sell products/.test(lower);

  if (piano) {
    return {
      app: { name: title, description: "A playable browser piano controlled by the computer keyboard, pointer, or touch." },
      theme: { primary: "#7c3aed", background: "#090b14", surface: "#171b2b", text: "#f8fafc", radius: 18 },
      pages: [{
        name: "Piano",
        route: "/",
        layout: "column",
        components: [
          textComponent("Keyboard Piano"),
          textComponent("Enable audio, then play with A W S E D F T G Y H U J K. Use the octave controls to shift pitch."),
          buttonComponent("Enable audio"),
          buttonComponent("Octave down"),
          buttonComponent("Octave up"),
        ],
      }],
      data: [{ name: "PianoState", description: "Ephemeral instrument state.", fields: ["octave", "activeNotes", "audioEnabled"] }],
      workflows: [
        { name: "Start audio", trigger: "User selects Enable audio", steps: ["Create or resume AudioContext", "Set a safe master gain", "Enable controls"] },
        { name: "Play note", trigger: "Mapped keyboard, pointer, or touch input", steps: ["Calculate note frequency", "Start oscillator", "Highlight key"] },
        { name: "Release note", trigger: "Input release, blur, or hidden page", steps: ["Ramp gain down", "Stop oscillator", "Clear active state"] },
      ],
      integrations: ["Browser Web Audio API"],
      permissions: ["No microphone permission", "No network access"],
      implementation_notes: ["Audio begins only after a deliberate user gesture.", "Repeated keydown events are ignored.", "Master output is kept at a conservative level."],
    };
  }

  if (commerce) {
    return {
      app: { name: title, description: "A responsive advertising website with a functional merchandise catalog and cart." },
      theme: { primary: "#7c3aed", background: "#0b1020", surface: "#151c30", text: "#f8fafc", radius: 18 },
      pages: [
        { name: "Home", route: "/", layout: "column", components: [textComponent(title), textComponent("Create, present, and deliver with IABT."), buttonComponent("Shop merchandise", "/store"), buttonComponent("Contact us", "/contact")] },
        { name: "Store", route: "/store", layout: "column", components: [textComponent("Merchandise"), textComponent("Browse products, add items to the cart, and review totals."), buttonComponent("View cart", "/cart")] },
        { name: "Cart", route: "/cart", layout: "column", components: [textComponent("Shopping cart"), textComponent("Change quantities, remove products, and review the subtotal."), buttonComponent("Continue to checkout")] },
        { name: "Contact", route: "/contact", layout: "column", components: [textComponent("Contact"), { type: "Input", props: { placeholder: "Email address" } }, { type: "Input", props: { placeholder: "How can we help?" } }, buttonComponent("Send inquiry")] },
      ],
      data: [
        { name: "Product", description: "Merchandise catalog item.", fields: ["id", "name", "description", "priceCents", "category"] },
        { name: "CartItem", description: "Product and selected quantity.", fields: ["productId", "quantity"] },
      ],
      workflows: [
        { name: "Add to cart", trigger: "Customer selects Add", steps: ["Find product", "Increase quantity", "Recalculate subtotal"] },
        { name: "Update cart", trigger: "Customer changes quantity or removes an item", steps: ["Validate quantity", "Update cart", "Recalculate subtotal"] },
        { name: "Checkout handoff", trigger: "Customer selects checkout", steps: ["Validate non-empty cart", "Prepare server-owned order", "Open approved Stripe Checkout when connected"] },
      ],
      integrations: ["Stripe Checkout connection contract (server-side activation required)"],
      permissions: ["Public catalog read", "Customer controls their cart", "Payment credentials never stored in the browser"],
      implementation_notes: ["The preview simulates checkout and does not charge a card.", "Connect Stripe server-side before accepting live orders."],
    };
  }

  const featureList = Array.isArray(spec?.features) ? spec.features.map((item: unknown) => clean(item, 120)).filter(Boolean).slice(0, 6) : [];
  return {
    app: { name: title, description: clean(spec?.creative_prompt || requestText, 500) || "Interactive IABT application." },
    theme: { primary: "#7c3aed", background: "#0b1020", surface: "#151c30", text: "#f8fafc", radius: 18 },
    pages: [
      { name: "Home", route: "/", layout: "column", components: [textComponent(title), textComponent(clean(spec?.creative_prompt || requestText, 300)), buttonComponent("Get started", "/workspace")] },
      { name: "Workspace", route: "/workspace", layout: "column", components: [textComponent("Workspace"), { type: "Input", props: { placeholder: "Add an item" } }, buttonComponent("Add item")] },
      { name: "About", route: "/about", layout: "column", components: [textComponent("About"), textComponent("Generated by IABT from the approved request.")] },
    ],
    data: [{ name: "WorkspaceItem", description: "A user-created workspace item.", fields: ["id", "title", "completed", "createdAt"] }],
    workflows: [{ name: "Create item", trigger: "User submits the workspace form", steps: ["Validate input", "Add item", "Render the updated list"] }],
    integrations: [],
    permissions: ["Local preview data only"],
    implementation_notes: featureList.length ? featureList : ["Responsive browser-native implementation.", "No external network dependency in the preview."],
  };
}

function pianoHtml(title: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#090b14;color:#f8fafc}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,#312e81 0,transparent 40%),#090b14}.shell{width:min(980px,calc(100% - 28px));margin:auto;padding:34px 0 56px}.top{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:24px}h1{font-size:clamp(2.1rem,7vw,4.7rem);letter-spacing:-.055em;margin:0}p{color:#cbd5e1;font-size:1.05rem;line-height:1.6}.panel{background:rgba(18,23,39,.88);border:1px solid #343c56;border-radius:24px;padding:24px;box-shadow:0 28px 80px #0008}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:22px}button{border:1px solid #6d5ce8;border-radius:12px;background:#7c3aed;color:white;padding:12px 16px;font-weight:800;cursor:pointer}button.secondary{background:#171b2b;border-color:#475569}.status{margin-left:auto;color:#c4b5fd;font-weight:700}.keyboard{display:flex;height:260px;overflow-x:auto;padding-bottom:6px;touch-action:none}.key{position:relative;flex:1 0 68px;border:1px solid #525b70;border-radius:0 0 12px 12px;background:linear-gradient(#fff,#dbe2ef);color:#121827;display:flex;align-items:end;justify-content:center;padding:0 4px 15px;font-weight:900;cursor:pointer;user-select:none}.key.black{height:62%;min-width:48px;flex:.68 0 48px;margin:0 -24px;z-index:2;background:linear-gradient(#252b3a,#05070c);color:#fff;border-color:#090b14}.key.active{background:linear-gradient(#c4b5fd,#8b5cf6);color:#fff;transform:translateY(3px);box-shadow:0 0 28px #8b5cf688}.key span{display:block;text-align:center}.key small{display:block;opacity:.65;margin-top:5px}.hint{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:18px;color:#94a3b8}@media(max-width:650px){.top{display:block}.keyboard{height:220px}.status{width:100%;margin:4px 0}.panel{padding:16px}}
</style></head><body><main class="shell"><div class="top"><div><p>Interactive browser instrument</p><h1>${escapeHtml(title)}</h1></div><p>Play with your computer keyboard, mouse, or touch.</p></div><section class="panel"><div class="controls"><button id="start">Enable audio</button><button class="secondary" id="down" aria-label="Lower octave">− Octave</button><button class="secondary" id="up" aria-label="Raise octave">+ Octave</button><span class="status" id="status">Octave 4 · Audio off</span></div><div class="keyboard" id="keyboard" aria-label="Piano keyboard"></div><div class="hint"><span>A W S E D F T G Y H U J K</span><span>Audio stops on release or when the page loses focus.</span></div></section></main>
<script>
(function(){
"use strict";
var mapping=[["a",0,"C",0],["w",1,"C♯",1],["s",2,"D",0],["e",3,"D♯",1],["d",4,"E",0],["f",5,"F",0],["t",6,"F♯",1],["g",7,"G",0],["y",8,"G♯",1],["h",9,"A",0],["u",10,"A♯",1],["j",11,"B",0],["k",12,"C",0]];
var octave=4,context=null,master=null,active=new Map(),keyboard=document.getElementById("keyboard"),status=document.getElementById("status");
mapping.forEach(function(item){var key=document.createElement("button");key.type="button";key.className="key"+(item[3]?" black":"");key.dataset.key=item[0];key.innerHTML="<span>"+item[2]+"<small>"+item[0].toUpperCase()+"</small></span>";keyboard.appendChild(key);key.addEventListener("pointerdown",function(event){event.preventDefault();startNote(item[0]);key.setPointerCapture(event.pointerId)});key.addEventListener("pointerup",function(){stopNote(item[0])});key.addEventListener("pointercancel",function(){stopNote(item[0])})});
function refresh(){status.textContent="Octave "+octave+" · "+(context&&context.state==="running"?"Audio ready":"Audio off")}
function enable(){if(!context){var AudioEngine=window.AudioContext||window.webkitAudioContext;context=new AudioEngine();master=context.createGain();master.gain.value=.16;master.connect(context.destination)}context.resume();refresh()}
function frequency(semitone){var midi=12*(octave+1)+semitone;return 440*Math.pow(2,(midi-69)/12)}
function startNote(code){if(active.has(code))return;enable();var item=mapping.find(function(row){return row[0]===code});if(!item)return;var oscillator=context.createOscillator(),gain=context.createGain(),now=context.currentTime;oscillator.type="triangle";oscillator.frequency.value=frequency(item[1]);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.85,now+.025);oscillator.connect(gain);gain.connect(master);oscillator.start();active.set(code,{oscillator:oscillator,gain:gain});var el=keyboard.querySelector('[data-key="'+code+'"]');if(el)el.classList.add("active")}
function stopNote(code){var voice=active.get(code);if(!voice)return;var now=context.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(Math.max(.0001,voice.gain.gain.value),now);voice.gain.gain.exponentialRampToValueAtTime(.0001,now+.12);voice.oscillator.stop(now+.14);active.delete(code);var el=keyboard.querySelector('[data-key="'+code+'"]');if(el)el.classList.remove("active")}
function stopAll(){Array.from(active.keys()).forEach(stopNote)}
document.getElementById("start").addEventListener("click",enable);
document.getElementById("down").addEventListener("click",function(){octave=Math.max(2,octave-1);stopAll();refresh()});
document.getElementById("up").addEventListener("click",function(){octave=Math.min(6,octave+1);stopAll();refresh()});
window.addEventListener("keydown",function(event){var target=event.target;if(target&&(/INPUT|TEXTAREA|SELECT/.test(target.tagName)||target.isContentEditable))return;if(event.repeat||!mapping.some(function(row){return row[0]===event.key.toLowerCase()}))return;event.preventDefault();startNote(event.key.toLowerCase())});
window.addEventListener("keyup",function(event){var code=event.key.toLowerCase();if(mapping.some(function(row){return row[0]===code})){event.preventDefault();stopNote(code)}});
window.addEventListener("blur",stopAll);document.addEventListener("visibilitychange",function(){if(document.hidden)stopAll()});refresh();
}());
</script></body></html>`;
}

function commerceHtml(title: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f6f7fb;color:#17142a}header{padding:18px max(20px,5vw);display:flex;justify-content:space-between;align-items:center;background:#fff;border-bottom:1px solid #e4e7ef;position:sticky;top:0}nav button,.cta,.add{border:0;border-radius:10px;padding:11px 15px;font-weight:800;cursor:pointer}.brand{font-weight:950}.cta,.add{background:#7c3aed;color:#fff}nav button{background:transparent}.hero{padding:72px max(20px,8vw);background:linear-gradient(135deg,#17142a,#4c1d95);color:#fff}h1{font-size:clamp(2.5rem,7vw,5.4rem);line-height:1;margin:0;max-width:820px}.hero p{font-size:1.2rem;color:#ddd6fe;max-width:650px}.section{padding:48px max(20px,8vw)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}.card,.cart{background:#fff;border:1px solid #e3e6ee;border-radius:18px;padding:20px;box-shadow:0 14px 40px #2d245512}.product-art{height:150px;border-radius:13px;background:linear-gradient(145deg,#ede9fe,#c4b5fd);display:grid;place-items:center;font-size:3rem}.row{display:flex;justify-content:space-between;gap:12px;align-items:center}.cart{position:fixed;right:18px;top:82px;width:min(390px,calc(100% - 36px));max-height:75vh;overflow:auto;z-index:5}.hidden{display:none}.cart-line{padding:12px 0;border-bottom:1px solid #e5e7eb}.muted{color:#667085}.qty button{border:1px solid #d0d5dd;background:#fff;border-radius:8px;width:30px;height:30px;cursor:pointer}.checkout{width:100%;margin-top:16px}.notice{padding:12px;border-radius:10px;background:#fef3c7;color:#7c2d12;margin-top:12px}</style></head><body><header><span class="brand">${escapeHtml(title)}</span><nav><button data-scroll="about">About</button><button data-scroll="store">Store</button><button id="cartButton">Cart (<span id="count">0</span>)</button></nav></header><main><section class="hero"><h1>Create boldly. Wear the idea.</h1><p>An advertising site and working merchandise-store preview generated by IABT.</p><button class="cta" data-scroll="store">Shop merchandise</button></section><section class="section" id="about"><h2>Built around the IABT mission</h2><p class="muted">Clear tools, tangible deliverables, and merchandise for the people building what comes next.</p></section><section class="section" id="store"><h2>Merchandise</h2><div class="grid" id="products"></div></section></main><aside class="cart hidden" id="cart" aria-label="Shopping cart"><div class="row"><h2>Your cart</h2><button id="closeCart">Close</button></div><div id="cartLines"></div><div class="row"><strong>Subtotal</strong><strong id="subtotal">$0.00</strong></div><button class="cta checkout" id="checkout">Continue to checkout</button><div class="notice hidden" id="notice">Preview only. Connect an approved server-side Stripe Checkout session before accepting payment.</div></aside><script>
(function(){"use strict";var products=[{id:"tee",name:"IABT Builder Tee",price:2800,icon:"◫"},{id:"mug",name:"JERICHO Studio Mug",price:1800,icon:"◉"},{id:"cap",name:"Creator Cap",price:2400,icon:"⌁"}],cart={};var list=document.getElementById("products"),panel=document.getElementById("cart"),lines=document.getElementById("cartLines");function money(cents){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100)}function renderProducts(){products.forEach(function(product){var card=document.createElement("article");card.className="card";card.innerHTML='<div class="product-art">'+product.icon+'</div><h3>'+product.name+'</h3><div class="row"><strong>'+money(product.price)+'</strong><button class="add" data-add="'+product.id+'">Add to cart</button></div>';list.appendChild(card)})}function renderCart(){var total=0,count=0;lines.innerHTML="";Object.keys(cart).forEach(function(id){var qty=cart[id],product=products.find(function(item){return item.id===id});if(!product||qty<1)return;total+=product.price*qty;count+=qty;var row=document.createElement("div");row.className="cart-line row";row.innerHTML="<div><strong>"+product.name+"</strong><div class=muted>"+money(product.price)+" each</div></div><div class=qty><button data-change='"+id+"' data-delta='-1'>−</button> <strong>"+qty+"</strong> <button data-change='"+id+"' data-delta='1'>+</button></div>";lines.appendChild(row)});if(!count)lines.innerHTML='<p class="muted">Your cart is empty.</p>';document.getElementById("count").textContent=String(count);document.getElementById("subtotal").textContent=money(total)}document.addEventListener("click",function(event){var add=event.target.closest("[data-add]"),change=event.target.closest("[data-change]"),scroll=event.target.closest("[data-scroll]");if(add){cart[add.dataset.add]=(cart[add.dataset.add]||0)+1;renderCart();panel.classList.remove("hidden")}if(change){var id=change.dataset.change;cart[id]=Math.max(0,(cart[id]||0)+Number(change.dataset.delta));renderCart()}if(scroll)document.getElementById(scroll.dataset.scroll).scrollIntoView({behavior:"smooth"})});document.getElementById("cartButton").addEventListener("click",function(){panel.classList.remove("hidden")});document.getElementById("closeCart").addEventListener("click",function(){panel.classList.add("hidden")});document.getElementById("checkout").addEventListener("click",function(){document.getElementById("notice").classList.remove("hidden")});renderProducts();renderCart()}());
</script></body></html>`;
}

function genericHtml(title: string, requestText: string) {
  const description = escapeHtml(requestText);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b1020;color:#f8fafc}.shell{width:min(900px,calc(100% - 32px));margin:auto;padding:52px 0}h1{font-size:clamp(2.5rem,7vw,5rem);line-height:1;margin:0}.lead{color:#cbd5e1;font-size:1.15rem;line-height:1.7}.panel{margin-top:30px;padding:24px;border:1px solid #334155;border-radius:20px;background:#151c30}form{display:flex;gap:10px}input{flex:1;min-width:0;padding:13px;border-radius:10px;border:1px solid #475569;background:#0f172a;color:#fff}button{padding:13px 18px;border:0;border-radius:10px;background:#7c3aed;color:#fff;font-weight:800;cursor:pointer}li{margin:10px 0;padding:13px;border-radius:10px;background:#202940}small{color:#94a3b8}@media(max-width:560px){form{display:grid}}</style></head><body><main class="shell"><small>Generated interactive preview</small><h1>${escapeHtml(title)}</h1><p class="lead">${description}</p><section class="panel"><h2>Workspace</h2><form id="form"><input id="item" aria-label="New item" placeholder="Add an item" required><button>Add</button></form><ul id="list"><li>Start with the approved objective.</li></ul><p id="error" role="alert"></p></section></main><script>(function(){"use strict";var form=document.getElementById("form"),input=document.getElementById("item"),list=document.getElementById("list"),error=document.getElementById("error");form.addEventListener("submit",function(event){event.preventDefault();var value=input.value.trim();if(!value){error.textContent="Enter an item first.";return}error.textContent="";var row=document.createElement("li");row.textContent=value;list.appendChild(row);input.value="";input.focus()})}());</script></body></html>`;
}

export function createFallbackInteractiveApp(requestText: string, spec: any = {}, definition: any = {}) {
  const lower = (requestText + " " + JSON.stringify(spec || {})).toLowerCase();
  const title = clean(definition?.app?.name || titleFor(requestText, spec), 100);
  if (/piano|keyboard instrument|web audio|musical keyboard/.test(lower)) {
    return {
      implementation_summary: "IABT deterministic recovery created a playable Web Audio piano with computer-keyboard, pointer, touch, octave, focus-loss, and safe-volume controls.",
      preview_html: pianoHtml(title),
      test_cases: [
        "Select Enable audio and verify the readiness label changes.",
        "Press and release A, W, S, and E and verify each mapped key sounds and highlights.",
        "Change the octave and verify pitch changes while the displayed octave remains within 2–6.",
        "Hold a note, then change tabs or blur the window and verify the note stops.",
      ],
      generation_strategy: "iabt_deterministic_recovery",
    };
  }
  if (/merch|store|shop|e-?commerce|shopping cart|sell products/.test(lower)) {
    return {
      implementation_summary: "IABT deterministic recovery created a responsive advertising site with a functional product catalog, cart quantities, totals, and a safe checkout handoff notice.",
      preview_html: commerceHtml(title),
      test_cases: [
        "Add each merchandise product and verify the cart count and subtotal update.",
        "Increase and decrease quantities and verify totals remain accurate.",
        "Open checkout and verify the preview clearly states that live Stripe activation is required.",
        "Use the navigation controls at desktop and mobile widths.",
      ],
      generation_strategy: "iabt_deterministic_recovery",
    };
  }
  return {
    implementation_summary: "IABT deterministic recovery created a responsive interactive workspace directly from the approved objective.",
    preview_html: genericHtml(title, clean(spec?.creative_prompt || requestText, 500)),
    test_cases: [
      "Submit a valid workspace item and verify it appears.",
      "Submit an empty item and verify validation prevents it.",
      "Verify the layout at desktop and mobile widths.",
    ],
    generation_strategy: "iabt_deterministic_recovery",
  };
}
