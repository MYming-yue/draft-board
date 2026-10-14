import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launchBrowser } from './browser.mjs';
import { commitStep, createEmptyBoard, parseBoard, serializeBoard, edgeGeometry, segmentTouchesRect } from '../dist-model/index.js';

const port=4194;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
let browser;
try {
  for(let i=0;;i++){try{await fetch(`http://127.0.0.1:${port}`);break;}catch{if(i>50)throw new Error('Flow preview did not start');await new Promise(r=>setTimeout(r,200));}}
  browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1500,height:1050}});
  await page.addInitScript(()=>{delete window.showOpenFilePicker;delete window.showSaveFilePicker;});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
  const n=(id,markdown,x,y,shape='rectangle',caption)=>({id:`n_${id}`,type:'text',markdown,x,y,w:240,...shape?{shape}:{},...caption?{caption}:{}});
  const nodes=[
    n('flowstart','提出问题',510,20,'pill'),
    n('flowfacts','收集事实',100,190),n('flowassume','梳理假设',510,190),n('flowoptions','列出选项',900,190),
    n('flowcompare','比较依据与代价',500,350),n('flowdecision','条件足够清楚？',440,490,'diamond'),
    n('flowrevise','继续补充',100,690),n('flowchoose','由人选择',900,690),n('flowend','记录决定',870,860,'pill'),
    n('flowknowledge','保留待定项',1210,230,null,'尚未确认的假设与取舍保留在草稿。'),
    n('flowformula','$$F=ma$$',1250,480,'pill','符号与适用条件仍放在独立备注里。'),
  ];
  const pairs=[['flowstart','flowfacts'],['flowstart','flowassume'],['flowstart','flowoptions'],['flowfacts','flowcompare'],['flowassume','flowcompare'],['flowoptions','flowcompare'],['flowcompare','flowdecision'],['flowdecision','flowrevise','仍有疑问'],['flowdecision','flowchoose','已厘清'],['flowchoose','flowend'],['flowrevise','flowcompare','补充后再看']];
  const edges=pairs.map(([from,to,label],i)=>({id:`e_flowtest${i}`,kind:'association',from:`n_${from}`,to:`n_${to}`,directed:true,routing:'orthogonal',stroke:'solid',...label?{label}:{}}));
  const seed=commitStep(createEmptyBoard('理解与决策草稿'), '合成流程示例','agent',[...nodes.map(node=>({op:'addNode',node,before:null,after:node})),...edges.map(edge=>({op:'addEdge',edge,before:null,after:edge}))]);assert.equal(seed.ok,true);
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'打开',exact:true}).click()]);
  await chooser.setFiles({name:'synthetic-flow.draft',mimeType:'application/octet-stream',buffer:Buffer.from(serializeBoard(seed.state,{}))});
  await page.waitForFunction(()=>window.__state?.file.nodes.length===11);await page.evaluate(()=>document.fonts.ready);
  await page.getByRole('button',{name:'适应视图',exact:true}).click();
  const card=id=>page.locator(`[data-node-id="n_${id}"]`);
  await card('flowformula').locator('.katex').waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-node-id="n_flowdecision"] .node-shape-content')?.clientHeight>0);
  mkdirSync('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/flow-appearance.png'});
  const metrics=await page.evaluate(()=>({file:window.__state.file,geometry:Object.fromEntries([...document.querySelectorAll('.node-card')].map(el=>[el.dataset.nodeId,{w:parseFloat(getComputedStyle(el).width),h:parseFloat(getComputedStyle(el).height)}]))}));
  for(const e of metrics.file.edges){const g=edgeGeometry(e,metrics.file.nodes,Object.fromEntries(Object.entries(metrics.geometry).map(([id,v])=>[id,v.h])),Object.fromEntries(Object.entries(metrics.geometry).map(([id,v])=>[id,v.w])),metrics.file.edges);assert.ok(g);for(const other of metrics.file.nodes.filter(n=>![e.from,e.to].includes(n.id))){const box={x:other.x,y:other.y,...metrics.geometry[other.id]};assert.equal(g.points.slice(1).some((p,i)=>segmentTouchesRect(g.points[i],p,box)),false,`flow hits ${other.id}`);}}
  const safe=await card('flowdecision').evaluate(el=>{const outer=el.getBoundingClientRect(),inner=el.querySelector('.node-shape-content').getBoundingClientRect();const cx=outer.x+outer.width/2,cy=outer.y+outer.height/2;return [inner.left,inner.right].every(x=>[inner.top,inner.bottom].every(y=>Math.abs(x-cx)/(outer.width/2)+Math.abs(y-cy)/(outer.height/2)<1));});assert.equal(safe,true,'diamond content fits inside its silhouette');
  await card('flowknowledge').locator('.concept-core').click();
  const open=async()=>{const button=page.getByRole('button',{name:'外形与连线 ▾',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();};await open();
  await page.getByRole('combobox',{name:'卡片外形',exact:true}).selectOption('diamond');
  await page.waitForFunction(()=>window.__state.file.nodes.find(n=>n.id==='n_flowknowledge').shape==='diamond');
  assert.equal(await card('flowknowledge').locator('.node-caption').innerText(),'尚未确认的假设与取舍保留在草稿。');
  const beforeKeys=await page.evaluate(()=>window.__state.file.board.view);
  await page.getByRole('combobox',{name:'卡片外形',exact:true}).focus();await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>window.__state.file.nodes.find(n=>n.id==='n_flowknowledge').shape==='pill');
  assert.deepEqual(await page.evaluate(()=>window.__state.file.board.view),beforeKeys,'menu arrow keys do not pan the canvas');
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.waitForFunction(()=>!window.__state.file.nodes.find(n=>n.id==='n_flowknowledge').shape);
  await card('flowdecision').locator('.concept-core').dblclick();
  const core=card('flowdecision').getByRole('textbox',{name:'卡片正文',exact:true});
  await core.dispatchEvent('compositionstart');await core.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(await core.isVisible(),true);
  await core.dispatchEvent('compositionend');await core.fill('条件足够清楚？\n还有哪些不确定性？');await core.press('Control+Enter');
  await card('flowdecision').locator('.node-shape-outline').waitFor();
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  const e=page.locator('[data-edge-id="e_flowtest6"] .edge-hit');
  const selectEdge=async()=>{const at=await e.evaluate(path=>{const p=path.getPointAtLength(path.getTotalLength()/2),matrix=path.getScreenCTM();const q=new DOMPoint(p.x,p.y).matrixTransform(matrix);return{x:q.x,y:q.y};});await page.mouse.click(at.x,at.y);};await selectEdge();
  await open();await page.getByRole('combobox',{name:'线条样式',exact:true}).selectOption('dashed');
  await page.waitForFunction(()=>window.__state.file.edges.find(e=>e.id==='e_flowtest6').stroke==='dashed');
  assert.ok((await page.locator('[data-edge-id="e_flowtest6"] .edge-path').getAttribute('class')).includes('edge-stroke-dashed'));
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await selectEdge();await open();
  await page.getByRole('combobox',{name:'连线画法',exact:true}).selectOption('curve');
  await page.waitForFunction(()=>window.__state.file.edges.find(e=>e.id==='e_flowtest6').routing==='curve');
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await selectEdge();await open();
  await page.getByRole('button',{name:'收起设置',exact:true}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'保存',exact:true}).click()]);await download.saveAs('artifacts/synthetic-flow-roundtrip.draft');
  const saved=parseBoard(readFileSync('artifacts/synthetic-flow-roundtrip.draft')).file;assert.equal(saved.formatVersion,'3.0');assert.equal(saved.nodes.find(n=>n.id==='n_flowdecision').shape,'diamond');assert.equal(saved.edges.find(e=>e.id==='e_flowtest6').routing,'orthogonal');
  const [png]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出 PNG',exact:true}).click()]);await png.saveAs('artifacts/flow-appearance-export.png');
  await page.getByRole('button',{name:'结构视图',exact:true}).click();await page.getByRole('button',{name:'适应视图',exact:true}).click();await page.screenshot({path:'artifacts/flow-structure.png'});
  const canvas=page.locator('.canvas');await canvas.hover();await page.keyboard.down('Control');await page.mouse.wheel(0,350);await page.keyboard.up('Control');await page.screenshot({path:'artifacts/flow-zoom.png'});
  assert.deepEqual(errors,[]);
  console.log('FLOW UI PASS: shapes, formulas/notes, geometry, appearance undo, IME, curve/orthogonal strokes, file roundtrip, PNG and non-100% zoom.');
} finally {await browser?.close();server.kill();}
