import {parseBoard} from '../model';

export interface SavedFileBinding {
    version:1;
    boardId:string;
    handle:FileSystemFileHandle;
    directory?:FileSystemDirectoryHandle;
    boardName:string;
    fingerprint:string;
}
const DATABASE='draft-board-file-bindings',STORE='bindings';
async function database():Promise<IDBDatabase> {
    return new Promise((resolve,reject)=>{
        const request=indexedDB.open(DATABASE,1);
        request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'boardId'});
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(new Error('浏览器文件绑定存储暂不可用'));
    });
}
export async function readFileBinding(boardId:string):Promise<SavedFileBinding|null> {
    const db=await database();
    try{return await new Promise((resolve,reject)=>{
        const transaction=db.transaction(STORE,'readonly'),request=transaction.objectStore(STORE).get(boardId);
        transaction.oncomplete=()=>{
            const value=request.result as SavedFileBinding|undefined;
            resolve(value?.version===1 && value.boardId===boardId && value.handle?.kind==='file' && typeof value.boardName==='string' && value.boardName.trim() && /^[a-f0-9]{64}$/.test(value.fingerprint)?value:null);
        };
        transaction.onabort=()=>reject(transaction.error);
        transaction.onerror=()=>reject(transaction.error);
    });}finally{db.close();}
}
export async function writeFileBinding(value:SavedFileBinding,canWrite=()=>true):Promise<void> {
    const db=await database();
    try{if(!canWrite())return;await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction(STORE,'readwrite');
        transaction.objectStore(STORE).put(value);
        transaction.oncomplete=()=>resolve();
        transaction.onabort=()=>reject(transaction.error);
        transaction.onerror=()=>reject(transaction.error);
    });}finally{db.close();}
}
export async function removeFileBinding(boardId:string,canWrite=()=>true):Promise<void> {
    const db=await database();
    try{if(!canWrite())return;await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction(STORE,'readwrite');transaction.objectStore(STORE).delete(boardId);
        transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>reject(transaction.error);
    });}finally{db.close();}
}
export async function fileFingerprint(bytes:Uint8Array):Promise<string> {
    const digest=await crypto.subtle.digest('SHA-256',bytes as BufferSource);
    return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
interface PermissionHandle extends FileSystemHandle {
    queryPermission?:(options:{mode:'readwrite'})=>Promise<PermissionState>;
    requestPermission?:(options:{mode:'readwrite'})=>Promise<PermissionState>;
}
/** Call only from an explicit save; never request permissions during startup. */
export async function requestBindingPermission(handle:FileSystemHandle):Promise<void> {
    const permission=handle as PermissionHandle,options={mode:'readwrite'} as const;
    if(!permission.queryPermission)return; // OPFS or an older host may not expose it.
    if(await permission.queryPermission(options)==='granted')return;
    if(await permission.requestPermission?.(options)!=='granted')throw new Error('记住的文件位置尚未获准访问，请重新允许访问，或通过“打开／另存为”选择文件。');
}
export const sameFileEntry=async(a:FileSystemFileHandle,b:FileSystemFileHandle)=>a===b || await a.isSameEntry(b);

export async function matchingDirectory(directory:FileSystemDirectoryHandle|undefined,handle:FileSystemFileHandle):Promise<FileSystemDirectoryHandle|undefined> {
    if(!directory)return undefined;
    try{
        const relative=await directory.resolve(handle);
        if(!relative?.length)return undefined;
        for(const part of relative.slice(0,-1))directory=await directory.getDirectoryHandle(part);
        return directory;
    }catch{return undefined;}
}

export async function restoreFileBinding(binding:SavedFileBinding,boardId:string) {
    if(binding.boardId!==boardId)throw new Error('记住的文件属于其他白板，已停止保存。');
    if(binding.directory)await requestBindingPermission(binding.directory);
    await requestBindingPermission(binding.handle);
    let disk:File;
    try{disk=await binding.handle.getFile();}catch(error){
        if((error as DOMException).name==='NotFoundError')throw new Error('记住的文件已移动或删除，请重新打开该文件或另存为。');
        throw error;
    }
    const bytes=new Uint8Array(await disk.arrayBuffer()),bundle=parseBoard(bytes);
    if(bundle.file.board.id!==boardId || await fileFingerprint(bytes)!==binding.fingerprint)
        throw new Error('记住的文件已被外部修改，原文件未覆盖；请先打开该文件，或另存为。');
    return bundle;
}
