import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    const page=await browser.newPage({viewport:{width:1800,height:900},deviceScaleFactor:2}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{delete window.showOpenFilePicker;delete window.showSaveFilePicker;});
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
    mkdirSync('artifacts',{recursive:true});
    for(const zoom of [1,.7]) {
        const file=createEmptyBoard('同源曲线有序扇出');
        file.board.view={panX:10,panY:20,zoom};
        file.nodes=[
            {id:'n_fanroot',type:'text',markdown:'一个主题，四个有序分支',caption:'先确定出入口，再生成自然曲线。\n\n连线按目标的左右顺序展开。',x:450,y:70,w:360,captionW:360},
            ...[[6,330],[396,465],[922,405],[1412,330]].map(([x,w],i)=>({id:`n_fanchild${i}`,type:'text',markdown:`分支 ${i+1}`,caption:i===2?Array.from({length:9},(_,j)=>`说明 ${j+1}：长备注也参与实际外框测量。`).join('\n\n'):'保留内容和关系，只调整连线的生成。',x,y:342,w,captionW:w,captionExpanded:true})),
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
            if(zoom===1)writeFileSync("artifacts/natural-curve-geometry.json",JSON.stringify({nodes:current.nodes,geometry,edges:current.edges,paths:[...expected]},null,2));
            for(const edge of current.edges){
                const path=page.locator(`[data-edge-id="${edge.id}"] .edge-path`);
                const actual=await path.getAttribute('d'),numbers=d=>d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
                assert.doesNotMatch(actual,/ [LQ] /);
                assert.equal((actual.match(/ C /g)||[]).length,1,'clear branches stay one continuous cubic');
                const observed=numbers(actual),wanted=numbers(expected.get(edge.id).strokeD ?? expected.get(edge.id).d);
                assert.equal(observed.length,wanted.length,'same curve candidate in renderer and checker');
                // CSS computed-size strings round ResizeObserver's fractional pixels.
                observed.forEach((value,i)=>assert.ok(Math.abs(value-wanted[i])<.02,`${edge.id} coordinate ${i}: ${value} vs ${wanted[i]}`));
                const points=await path.evaluate(el=>Array.from({length:201},(_,i)=>{const p=el.getPointAtLength(el.getTotalLength()*i/200);return{x:p.x,y:p.y};}));
                assert.ok(points.slice(1).every((p,i)=>p.y>=points[i].y-1e-6),'downward branches must not develop upward hooks');
                if(edge.id===current.edges.at(-1).id){
                    const a=points[0],b=points.at(-1),length=Math.hypot(b.x-a.x,b.y-a.y);
                    const bend=Math.max(...points.map(p=>Math.abs((p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x))/length));
                    assert.ok(bend>8,'outer branch keeps a broad curve rather than collapsing to a straight escape');
                }
                const head=expected.get(edge.id).arrow;
                const actualHead=numbers(await page.locator(`[data-edge-id="${edge.id}"] .edge-arrow`).getAttribute('d'));
                [head.left.x,head.left.y,head.tip.x,head.tip.y,head.right.x,head.right.y].forEach((v,i)=>assert.ok(Math.abs(v-actualHead[i])<.02,'same arrow geometry in renderer and checker'));
                const last=points.at(-1),v={x:head.tip.x-head.base.x,y:head.tip.y-head.base.y};
                const depth=((head.tip.x-last.x)*v.x+(head.tip.y-last.y)*v.y)/10;
                const offset=Math.abs((last.x-head.tip.x)*v.y-(last.y-head.tip.y)*v.x)/10;
                assert.ok(depth>0 && depth<10 && offset<3.5*depth/10,'ink joins inside the filled head');
                const target=current.nodes.find(n=>n.id===edge.to),r=geometry[target.id];
                const centre={x:target.x+r.w/2,y:target.y+r.h/2};
                assert.ok(Math.abs(v.x*(centre.y-head.tip.y)-v.y*(centre.x-head.tip.x))<.1,'arrow points at actual card centre');

            }
            assert.deepEqual(readabilityConflicts(current,geometry),[],'actual browser dimensions leave paths clear');
            assert.equal(current.board.contentVersion,file.board.contentVersion,'derived paths add no history');
        };
        await verify();
        await page.getByRole('button',{name:'结构视图',exact:true}).click();await verify();
        await page.getByRole('button',{name:'显示备注',exact:true}).click();await verify();
        const targetId=file.edges.at(-1).id,head=page.locator(`[data-edge-id="${targetId}"] .edge-arrow`),body=page.locator(`[data-edge-id="${targetId}"] .edge-path`);
        const beforeHead=await head.getAttribute('d'),beforeBody=await body.getAttribute('d'),beforeBox=await head.boundingBox();
        const target=await body.evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()*.6),m=el.getScreenCTM();return{x:m.a*p.x+m.c*p.y+m.e,y:m.b*p.x+m.d*p.y+m.f};});
        await page.mouse.click(target.x,target.y);
        await page.waitForFunction(id=>window.__state.selection.edges.includes(id),targetId);
        assert.equal(await head.getAttribute('d'),beforeHead,'selection does not enlarge or reshape the head');
        assert.equal(await body.getAttribute('d'),beforeBody,'selection does not alter the curve');
        const afterBox=await head.boundingBox();
        assert.ok(Math.abs(afterBox.width-beforeBox.width)<.01 && Math.abs(afterBox.height-beforeBox.height)<.01,'arrow size stays fixed when the line thickens');
        await page.mouse.click(1700,820);await verify();
        const crop=await head.boundingBox();
        await page.screenshot({path:`artifacts/arrow-terminal-${zoom}.png`,clip:{x:Math.floor(crop.x-80),y:Math.floor(crop.y-80),width:160,height:140}});
        await page.screenshot({path:`artifacts/curve-branches-${zoom}.png`,fullPage:true});
        if(zoom===1){
            const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'导出 PNG',exact:true}).click()]);
            assert.ok(readFileSync(await download.path()).length>1000);
        }
    }
    assert.deepEqual(errors,[]);
    console.log('CURVE BRANCHES PASS: single smooth cubics, oblique centre-facing arrows and ordered branches; fixed head size on selection; actual dimensions, long captions, structure view, 100%/70% zoom, shared geometry, PNG and no history changes.');
} finally { await browser?.close();server.kill(); }
