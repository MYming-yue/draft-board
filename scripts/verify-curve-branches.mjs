import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { launchBrowser, prepareFixtureOpen } from './browser.mjs';
import { createEmptyBoard, edgeGeometries, readabilityConflicts, serializeBoard } from '../dist-model/index.js';

const port=4197;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
let browser;
try {
    for(let i=0;;i++){
        try { await fetch(`http://127.0.0.1:${port}`);break; }
        catch { if(i>60)throw new Error('Curve preview did not start');await new Promise(r=>setTimeout(r,200)); }
    }
    browser=await launchBrowser();
    const page=await browser.newPage({viewport:{width:1800,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{delete window.showOpenFilePicker;delete window.showSaveFilePicker;});
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
    mkdirSync('artifacts',{recursive:true});
    for(const zoom of [1,.7]) {
        const file=createEmptyBoard('同源曲线有序扇出');
        file.board.view={panX:10,panY:20,zoom};
        file.nodes=[
            {id:'n_fanroot',type:'text',markdown:'一个主题，四个有序分支',caption:'先确定出入口，再生成自然曲线。\n\n连线按目标的左右顺序展开。',x:450,y:70,w:360,captionW:360},
            ...[[6,330],[396,465],[922,405],[1412,330]].map(([x,w],i)=>({id:`n_fanchild${i}`,type:'text',markdown:`分支 ${i+1}`,caption:i===2?Array.from({length:9},(_,j)=>`说明 ${j+1}：长备注也参与实际外框测量。`).join('\n\n'):'保留内容和关系，只调整连线的生成。',x,y:500,w,captionW:w,captionExpanded:true})),
        ];
        file.edges=file.nodes.slice(1).map((n,i)=>({id:`e_fanedge${i}`,kind:'parentChild',from:file.nodes[0].id,to:n.id,directed:true}));
        await prepareFixtureOpen(page);
        const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'打开',exact:true}).click()]);
        await chooser.setFiles({name:'curve-branches.draft',mimeType:'application/octet-stream',buffer:Buffer.from(serializeBoard(file,{}))});
        await page.waitForFunction(id=>window.__state.file.board.id===id,file.board.id);
        await page.evaluate(()=>document.fonts.ready);
        const verify=async()=>{
            await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
            const geometry=await page.locator('.node-card').evaluateAll(els=>Object.fromEntries(els.map(el=>{const s=getComputedStyle(el);return[el.dataset.nodeId,{w:parseFloat(s.width),h:parseFloat(s.height)}];})));
            const current=await page.evaluate(()=>window.__state.file);
            const heights=Object.fromEntries(Object.entries(geometry).map(([id,r])=>[id,r.h])),widths=Object.fromEntries(Object.entries(geometry).map(([id,r])=>[id,r.w]));
            const expected=edgeGeometries(current.edges,current.nodes,heights,widths);
            for(const edge of current.edges){
                const path=page.locator(`[data-edge-id="${edge.id}"] .edge-path`);
                const actual=await path.getAttribute('d'),numbers=d=>d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
                assert.doesNotMatch(actual,/ [LQ] /);
                const observed=numbers(actual),wanted=numbers(expected.get(edge.id).d);
                assert.equal(observed.length,wanted.length,'same curve candidate in renderer and checker');
                // CSS computed-size strings round ResizeObserver's fractional pixels.
                observed.forEach((value,i)=>assert.ok(Math.abs(value-wanted[i])<.02,`${edge.id} coordinate ${i}: ${value} vs ${wanted[i]}`));
                const points=await path.evaluate(el=>Array.from({length:201},(_,i)=>{const p=el.getPointAtLength(el.getTotalLength()*i/200);return{x:p.x,y:p.y};}));
                assert.ok(points.slice(1).every((p,i)=>p.y>=points[i].y-1e-6),'downward branches must not develop upward hooks');
            }
            assert.deepEqual(readabilityConflicts(current,geometry),[],'actual browser dimensions leave paths clear');
            assert.equal(current.board.contentVersion,file.board.contentVersion,'derived paths add no history');
        };
        await verify();
        await page.getByRole('button',{name:'结构视图',exact:true}).click();await verify();
        await page.getByRole('button',{name:'显示备注',exact:true}).click();await verify();
        await page.screenshot({path:`artifacts/curve-branches-${zoom}.png`,fullPage:true});
        if(zoom===1){
            const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出 PNG',exact:true}).click()]);
            assert.ok(readFileSync(await download.path()).length>1000);
        }
    }
    assert.deepEqual(errors,[]);
    console.log('CURVE BRANCHES PASS: four ordered branches, actual dimensions, long captions, structure view, 100%/70% zoom, shared check/render geometry, PNG and no history changes.');
} finally { await browser?.close();server.kill(); }
