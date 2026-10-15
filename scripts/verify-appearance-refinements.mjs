import assert from 'node:assert/strict';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launchBrowser,prepareFixtureOpen } from './browser.mjs';
import { commitStep,createEmptyBoard,parseBoard,serializeBoard,segmentTouchesRect } from '../dist-model/index.js';
const port=4195;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
let browser;
try{
 for(let i=0;;i++){try{await fetch(`http://127.0.0.1:${port}`);break;}catch{if(i>60)throw new Error('Appearance preview did not start');await new Promise(r=>setTimeout(r,200));}}
 browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[];
 await page.addInitScript(()=>{delete window.showOpenFilePicker;delete window.showSaveFilePicker;});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
 mkdirSync('artifacts',{recursive:true});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const open=async(file)=>{await prepareFixtureOpen(page);const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'打开',exact:true}).click()]);await chooser.setFiles({name:'appearance-test.draft',mimeType:'application/octet-stream',buffer:Buffer.from(serializeBoard(file,{}))});await page.waitForFunction(id=>window.__state.file.board.id===id,file.board.id);await page.evaluate(()=>document.fonts.ready);await settle();};
 const card=id=>page.locator(`[data-node-id="${id}"]`);
 const model=id=>page.evaluate(id=>window.__state.file.nodes.find(n=>n.id===id),id);
 const select=async(id,multi=false)=>{await card(id).locator('.core-stage').click({modifiers:multi?['Control']:[]});await settle();};
 const center=id=>card(id).evaluate(el=>{const s=getComputedStyle(el);return{x:parseFloat(s.left)+parseFloat(s.width)/2,y:parseFloat(s.top)+parseFloat(s.height)/2};});
 const sameCenter=(a,b,reason)=>{assert.ok(Math.abs(a.x-b.x)<.05&&Math.abs(a.y-b.y)<.05,`${reason}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);};
 const setShape=async(shape)=>{const entry=page.getByRole('button',{name:'外形与连线 ▾',exact:true});if(await entry.getAttribute('aria-expanded')!=='true')await entry.click();await page.getByRole('combobox',{name:'卡片外形',exact:true}).selectOption(shape);await settle();assert.equal(await page.evaluate(()=>window.__state.saveError),null);};
 for(const zoom of [1,.7]){
  const file=createEmptyBoard('固定中心切换外形');file.board.view={panX:0,panY:0,zoom};
  file.nodes=[
   {id:'n_center01',type:'text',markdown:'条件是否清楚？',x:220,y:260,w:240},
   {id:'n_center02',type:'text',markdown:'保留证据与未定项',caption:Array.from({length:6},(_,i)=>`依据 ${i+1}：说明条件与不确定性。`).join('\n\n'),captionExpanded:true,captionW:300,x:720,y:160,w:240},
   {id:'n_center03',type:'text',markdown:'$$F=ma$$',caption:'符号、单位和适用条件仍放在备注。',captionW:300,x:1220,y:260,w:240},
   {id:'n_center04',type:'text',markdown:'$$\\frac{a+b}{c}$$',x:1220,y:620,w:240},
  ];
  await open(file);
  for(const n of file.nodes){
   await select(n.id);const original=await center(n.id);
   for(const shape of ['diamond','pill','rectangle','card']){
    const before=await model(n.id),steps=await page.evaluate(()=>window.__state.file.history.length);
    await setShape(shape);sameCenter(original,await center(n.id),`${n.id} ${shape} zoom=${zoom}`);
    const changed=await model(n.id);assert.equal(changed.markdown,before.markdown);assert.equal(changed.caption,before.caption);
    assert.equal(await page.evaluate(()=>window.__state.file.history.length),steps+1,'shape and position form one undoable step');
    await page.getByRole('button',{name:'撤销',exact:true}).click();await select(n.id);
    assert.deepEqual(await model(n.id),before);sameCenter(original,await center(n.id),'undo restores center');
    await page.getByRole('button',{name:'重做',exact:true}).click();await select(n.id);
    assert.deepEqual(await model(n.id),changed);sameCenter(original,await center(n.id),'redo retains center');
   }
  }
  await select(file.nodes[0].id);await select(file.nodes[1].id,true);
  const before=await page.evaluate(()=>window.__state.file),centers=await Promise.all(file.nodes.slice(0,2).map(n=>center(n.id)));
  await setShape('diamond');
  assert.equal(await page.evaluate(()=>window.__state.file.history.length),before.history.length+1);
  for(let i=0;i<2;i++)sameCenter(centers[i],await center(file.nodes[i].id),'multi-card center');
  await page.screenshot({path:`artifacts/center-anchoring-${zoom}.png`});
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__state.file.nodes),before.nodes,'one undo restores every selected node');
  await select(file.nodes[0].id);await page.getByRole('button',{name:'结构视图',exact:true}).click();await settle();
  const structure=await center(file.nodes[0].id);await setShape('pill');sameCenter(structure,await center(file.nodes[0].id),'structure view center');
  await page.getByRole('button',{name:'显示备注',exact:true}).click();await settle();
  const saved=await page.evaluate(()=>window.__state.file);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'保存',exact:true}).click()]);
  assert.deepEqual(parseBoard(readFileSync(await download.path())).file.nodes,saved.nodes);
 }
 const file=createEmptyBoard('自由曲线与流程折线');
 const nodes=[],edges=[];
 for(const [prefix,y,routing,label] of [['curve',160,'curve','自由曲线：平滑绕行'],['ortho',520,'orthogonal','流程折线：清楚的转折']]){
  nodes.push({id:`n_${prefix}from`,type:'text',markdown:label,x:100,y,w:240},
   {id:`n_${prefix}to00`,type:'text',markdown:'到达这里',x:1050,y,w:240},
   {id:`n_${prefix}block`,type:'text',markdown:'需要避开的卡片',caption:'连线应绕过这张卡片及其备注区域。',captionW:300,x:530,y:y-40,w:240});
  edges.push({id:`e_${prefix}route`,kind:'association',from:`n_${prefix}from`,to:`n_${prefix}to00`,directed:true,routing,stroke:'solid',label:routing==='curve'?'平滑曲线':'流程折线'});
 }
 const seeded=commitStep(file,'合成绕障对照','agent',[...nodes.map(node=>({op:'addNode',node,before:null,after:node})),...edges.map(edge=>({op:'addEdge',edge,before:null,after:edge}))]);assert.equal(seeded.ok,true);
 await open(seeded.state);await page.getByRole('button',{name:'适应视图',exact:true}).click();await settle();
 const paths=await page.locator('[data-edge-id] .edge-path').evaluateAll(els=>els.map(el=>({id:el.parentElement.dataset.edgeId,d:el.getAttribute('d'),points:Array.from({length:241},(_,i)=>{const p=el.getPointAtLength(el.getTotalLength()*i/240);return{x:p.x,y:p.y};})})));
 assert.match(paths.find(p=>p.id==='e_curveroute').d,/ C /);assert.doesNotMatch(paths.find(p=>p.id==='e_curveroute').d,/ [LQ] /);
 assert.match(paths.find(p=>p.id==='e_orthoroute').d,/ L /);assert.doesNotMatch(paths.find(p=>p.id==='e_orthoroute').d,/ C /);
 const geometry=await page.locator('.node-card').evaluateAll(els=>els.map(el=>{const s=getComputedStyle(el);return{id:el.dataset.nodeId,x:parseFloat(s.left),y:parseFloat(s.top),w:parseFloat(s.width),h:parseFloat(s.height)};}));
 for(const path of paths){const edge=edges.find(e=>e.id===path.id);for(const n of geometry.filter(n=>![edge.from,edge.to].includes(n.id)))assert.equal(path.points.slice(1).some((p,i)=>segmentTouchesRect(path.points[i],p,{x:n.x-10,y:n.y-10,w:n.w+20,h:n.h+20})),false,`${path.id} avoids ${n.id}`);}
 await page.screenshot({path:'artifacts/curve-flow-comparison.png'});
 writeFileSync('artifacts/curve-flow-comparison.draft',serializeBoard(seeded.state,{}));
 const [png]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出 PNG',exact:true}).click()]);assert.ok(readFileSync(await png.path()).length>1000);
 assert.deepEqual(errors,[]);
 console.log('APPEARANCE REFINEMENTS PASS: center-preserving text/formula/notes, multi-select, undo/redo, structure view, zoom, ZIP and PNG; smooth obstacle detours visibly distinct from flow elbows.');
}finally{await browser?.close();server.kill();}
