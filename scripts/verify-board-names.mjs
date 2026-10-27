import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {launchBrowser,prepareFixtureOpen} from './browser.mjs';
import {commitStep,createEmptyBoard,parseBoard,serializeBoard} from '../dist-model/index.js';
const port=4198;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
let browser;
try{
    for(let i=0;;i++){try{await fetch(`http://127.0.0.1:${port}`);break;}catch{if(i>60)throw new Error('Name preview did not start');await new Promise(r=>setTimeout(r,200));}}
    browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1500,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'networkidle'});
    const empty=createEmptyBoard('施密特数'),node={id:'n_name_test01',type:'text',markdown:'保存名称，不改变内容与历史',x:200,y:240,w:300};
    const committed=commitStep(empty,'合成命名测试','user',[{op:'addNode',node,before:null,after:node}]);assert.equal(committed.ok,true);
    const file=committed.state,bytes=Array.from(serializeBoard(file,{}));
    await prepareFixtureOpen(page);
    await page.evaluate(async bytes=>{
        const root=await navigator.storage.getDirectory(),folder='draft-name-test-'+crypto.randomUUID();
        const directory=await root.getDirectoryHandle(folder,{create:true}),source=await directory.getFileHandle('施密特数.draft',{create:true});
        const writable=await source.createWritable();await writable.write(new Uint8Array(bytes));await writable.close();
        window.__nameDisk={root,folder,directory,source};window.__folderRequests=0;
        window.showOpenFilePicker=async()=>[source];
        window.showDirectoryPicker=async()=>{window.__folderRequests++;return directory;};
    },bytes);
    await page.getByRole('button',{name:'打开',exact:true}).click();
    await page.waitForFunction(id=>window.__state.file.board.id===id,file.board.id);
    const name=page.getByRole('textbox',{name:'白板名称',exact:true});
    for(const zoom of [1,.7]){
        await page.evaluate(zoom=>{document.documentElement.style.zoom=String(zoom);},zoom);
        await name.fill('施');await name.fill('');
        assert.equal(await name.inputValue(),'');assert.equal(await name.getAttribute('placeholder'),'施密特数');
        assert.equal(await page.evaluate(()=>window.__state.file.board.name),'施密特数','empty input keeps the original valid model name');
        mkdirSync('artifacts',{recursive:true});await page.screenshot({path:`artifacts/board-name-empty-${zoom}.png`});
        await name.press('Tab');assert.equal(await name.inputValue(),'施密特数','empty blur silently restores the focus-start name');
    }
    await page.evaluate(()=>{document.documentElement.style.zoom='1';});
    await name.focus();
    await name.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
    await name.fill('数');assert.equal(await page.evaluate(()=>window.__state.file.board.name),'施密特数','unfinished IME stays local');
    await name.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'数'})));
    assert.equal(await page.evaluate(()=>window.__state.file.board.name),'数','one valid character is sufficient');
    await name.fill(' 史密斯数 ');assert.equal(await name.inputValue(),' 史密斯数 ','typing retains spaces/caret until blur');await name.press('Enter');
    assert.equal(await name.inputValue(),'史密斯数');
    await page.waitForFunction(()=>window.__state.saveState==='saved');
    assert.equal(await page.evaluate(()=>window.__folderRequests),0,'autosave never opens a folder permission picker');
    await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.waitForFunction(()=>window.__state.fileHandle.name==='史密斯数.draft' && window.__state.saveState==='saved');
    assert.deepEqual(await page.evaluate(async()=>{const names=[];for await(const key of window.__nameDisk.directory.keys())names.push(key);return names;}),['史密斯数.draft']);
    const saved=await page.evaluate(async()=>Array.from(new Uint8Array(await (await window.__state.fileHandle.getFile()).arrayBuffer())));
    const reloaded=parseBoard(new Uint8Array(saved)).file;
    assert.deepEqual(reloaded.nodes,file.nodes);assert.deepEqual(reloaded.history,file.history);assert.equal(reloaded.board.id,file.board.id);assert.equal(reloaded.board.name,'史密斯数');
    await name.fill('流动数');await name.press('Enter');await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.waitForFunction(()=>window.__state.fileHandle.name==='流动数.draft' && window.__state.saveState==='saved');
    assert.equal(await page.evaluate(()=>window.__folderRequests),1,'later renames reuse the granted folder');
    await page.evaluate(async()=>{const h=await window.__nameDisk.directory.getFileHandle('已占用.draft',{create:true}),w=await h.createWritable();await w.write('occupied');await w.close();});
    await name.fill('已占用');await name.press('Enter');await page.getByRole('button',{name:'保存',exact:true}).click();
    await page.waitForFunction(()=>window.__state.saveState==='error');
    assert.equal(await page.evaluate(async()=>await (await (await window.__nameDisk.directory.getFileHandle('已占用.draft')).getFile()).text()),'occupied');
    assert.equal(await page.evaluate(()=>window.__state.fileHandle.name),'流动数.draft','failed rename preserves the bound original');
    await name.fill('施密特数');await name.press('Enter');
    await page.evaluate(()=>{window.showSaveFilePicker=async options=>{window.__suggestedName=options.suggestedName;throw new DOMException('cancelled','AbortError');};});
    await page.getByRole('button',{name:'另存为',exact:true}).click();
    await page.waitForFunction(()=>window.__suggestedName==='施密特数.draft');
    assert.deepEqual(errors,[]);
    await page.evaluate(async()=>{const {root,folder}=window.__nameDisk;if(!/^draft-name-test-[\da-f-]+$/.test(folder))throw new Error('Unsafe cleanup');await root.removeEntry(folder,{recursive:true});});
    console.log('BOARD NAMES PASS: blank/placeholder/restore, one character and IME, whitespace, 100%/70%; current-title picker suggestion; real FileSystem API rename after autosave, folder reuse, no collision overwrite, identity/content/history preserved.');
}finally{await browser?.close();server.kill();}
