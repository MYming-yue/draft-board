import { parseBoard, type BoardFile } from '../model';
import { sameDraftAssets, sameDraftContent } from './externalChanges';

interface RenameOptions {
    source: FileSystemFileHandle;
    name: string;
    bytes: Uint8Array;
    expectedFile?: BoardFile;
    expectedBlobs?: Record<string,Uint8Array>;
    directory?: FileSystemDirectoryHandle;
}
const sameEntry=async(a:FileSystemFileHandle,b:FileSystemFileHandle)=>a===b || await a.isSameEntry(b);

/** Only the user-selected source is removed, after its replacement is verified.
 * The folder handle is needed because local file handles cannot rename alone. */
export async function renameDraftFile(options:RenameOptions):Promise<{handle:FileSystemFileHandle;directory:FileSystemDirectoryHandle}> {
    const {source,name,bytes}=options;
    if(!options.directory && !window.showDirectoryPicker)throw new Error('此浏览器不支持文件夹授权，请用“另存为”保存新名称；原文件保持。');
    let directory=options.directory ?? await window.showDirectoryPicker!({mode:'readwrite',startIn:source,id:'draft-rename'});
    const relative=await directory.resolve(source);
    if(!relative?.length)throw new Error('请选择原草稿所在的文件夹；原文件保持。');
    for(const part of relative.slice(0,-1))directory=await directory.getDirectoryHandle(part);
    const oldName=relative.at(-1)!;
    const checkSourceEntry=async()=>{
        if(!await sameEntry(await directory.getFileHandle(oldName),source))throw new Error('原文件已被替换，已停止改名。');
    };
    await checkSourceEntry();
    try {
        await directory.getFileHandle(name);
        throw new Error(`文件夹内已有“${name}”，未覆盖或改名；请换一个白板名称。`);
    } catch(error) { if((error as DOMException).name!=='NotFoundError')throw error; }
    const readSource=async()=>parseBoard(new Uint8Array(await (await source.getFile()).arrayBuffer()));
    const baseline=await readSource();
    const expectedFile=options.expectedFile??baseline.file,expectedBlobs=options.expectedBlobs??baseline.blobs;
    const checkSource=async()=>{
        await checkSourceEntry();
        const disk=await readSource();
        if(!sameDraftContent(disk.file,expectedFile) || !sameDraftAssets(disk.blobs,expectedBlobs))throw new Error('磁盘已有外部修改，已停止改名；原文件和当前内容保持。');
    };
    await checkSource();
    const target=await directory.getFileHandle(name,{create:true}),empty=await target.getFile();
    if(empty.size!==0)throw new Error('同名文件刚被创建，已停止保存，未覆盖该文件。');
    let written=false;
    const stillOurTarget=async()=>{
        if(!await sameEntry(await directory.getFileHandle(name),target))return false;
        const file=await target.getFile();
        if(!written)return file.size===0 && file.lastModified===empty.lastModified;
        const actual=new Uint8Array(await file.arrayBuffer());
        return actual.length===bytes.length && actual.every((v,i)=>v===bytes[i]);
    };
    try {
        const writable=await target.createWritable();
        try {
            await writable.write(bytes as FileSystemWriteChunkType);
            await checkSource();
            if(!await stillOurTarget())throw new Error('新文件在写入期间发生变化，已停止覆盖。');
            await writable.close();written=true;
        }catch(error){try{await writable.abort();}catch{/* Preserve save failure. */}throw error;}
        if(!await stillOurTarget())throw new Error('新文件校验失败，原文件保持。');
        await checkSource();
        await directory.removeEntry(oldName);
        return {handle:target,directory};
    }catch(error){
        try{if(await stillOurTarget())await directory.removeEntry(name);}catch{
            throw new Error(`改名未完成，原文件保持；“${name}”可能已生成，请检查文件夹。`);
        }
        throw error;
    }
}
