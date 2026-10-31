import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyBoard, draftFileName, parseBoard, serializeBoard } from '../model';
import { saveDraft } from './persistence';

afterEach(()=>vi.unstubAllGlobals());
function disk() {
    const file=createEmptyBoard('施密特数'),bytes=serializeBoard(file,{}),entries=new Map<string,ReturnType<typeof entry>>();
    let duringWrite:(()=>void)|undefined,removeFailure=false;
    function entry(name:string,data:Uint8Array){
        return {name,kind:'file',data,mtime:1,
            async isSameEntry(other:unknown){return other===this;},
            async getFile(){return new File([this.data as BlobPart],this.name,{lastModified:this.mtime});},
            async createWritable(){let staged:Uint8Array;const target=this;return {
                async write(value:Uint8Array){staged=value;duringWrite?.();},
                async close(){target.data=staged;target.mtime++;},async abort(){},
            };},
        };
    }
    const source=entry('施密特数.draft',bytes);entries.set(source.name,source);
    const directory={
        async resolve(handle:unknown){return [...entries].find(([,value])=>value===handle)?.slice(0,1)??null;},
        async getFileHandle(name:string,options?:{create?:boolean}){
            if(!entries.has(name)){if(!options?.create)throw new DOMException('Missing','NotFoundError');entries.set(name,entry(name,new Uint8Array()));}
            return entries.get(name)!;
        },
        async removeEntry(name:string){if(removeFailure && name===source.name)throw new DOMException('Denied','NotAllowedError');entries.delete(name);},
    };
    vi.stubGlobal('window',{showDirectoryPicker:vi.fn(async()=>directory)});
    const next=structuredClone(file);next.board.name='史密斯数';
    return {file,next,source,entries,directory,
        state:{file:next,blobs:{},fileHandle:source as unknown as FileSystemFileHandle,fileName:source.name},
        changeDuringWrite:(callback:()=>void)=>{duringWrite=callback;},
        refuseRemoval:()=>{removeFailure=true;},
    };
}
it('suggests the current board name even when an imported or hosted filename is stale',async()=>{
    const file=createEmptyBoard('施密特数'),picker=vi.fn(async(_options?:{suggestedName?:string})=>{throw new DOMException('Cancel','AbortError');});
    vi.stubGlobal('window',{showSaveFilePicker:picker});
    expect(await saveDraft({file,blobs:{},fileHandle:null,fileName:'未命名白板.draft'})).toEqual({status:'cancelled'});
    expect(picker.mock.calls[0][0]).toMatchObject({suggestedName:'施密特数.draft'});
});
it('renames only after the new draft is written and verified, preserving board identity and history',async()=>{
    const d=disk(),result=await saveDraft(d.state,{renameFile:true,expectedFile:d.file,expectedBlobs:{}});
    expect(result.status).toBe('saved');expect([...d.entries.keys()]).toEqual(['史密斯数.draft']);
    const actual=parseBoard(d.entries.get('史密斯数.draft')!.data).file;
    expect(actual).toEqual(d.next);expect(actual.history).toEqual(d.file.history);
});
it('reuses an authorized folder without prompting again',async()=>{
    const d=disk();await saveDraft(d.state,{renameFile:true,directory:d.directory as unknown as FileSystemDirectoryHandle});
    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
});
it('keeps both the old file and an occupied target intact',async()=>{
    const d=disk(),occupied=await d.directory.getFileHandle('史密斯数.draft',{create:true});occupied.data=new Uint8Array([1,2,3]);
    await expect(saveDraft(d.state,{renameFile:true})).rejects.toThrow('已有');
    expect(d.entries.get(d.source.name)).toBe(d.source);expect(occupied.data).toEqual(new Uint8Array([1,2,3]));
});
it('leaves the original alone when folder authorization is cancelled or unrelated',async()=>{
    const d=disk();window.showDirectoryPicker=async()=>{throw new DOMException('Cancel','AbortError');};
    expect(await saveDraft(d.state,{renameFile:true})).toEqual({status:'cancelled'});
    window.showDirectoryPicker=async()=>({...d.directory,resolve:async()=>null}) as unknown as FileSystemDirectoryHandle;
    await expect(saveDraft(d.state,{renameFile:true})).rejects.toThrow('原草稿所在');
    expect([...d.entries.keys()]).toEqual([d.source.name]);
});
it('refuses concurrent source changes during staging and cleans up its own new file',async()=>{
    const d=disk();d.changeDuringWrite(()=>{const other=structuredClone(d.file);other.board.name='外部修改';d.source.data=serializeBoard(other,{});});
    await expect(saveDraft(d.state,{renameFile:true,expectedFile:d.file})).rejects.toThrow('外部修改');
    expect([...d.entries.keys()]).toEqual([d.source.name]);expect(parseBoard(d.source.data).file.board.name).toBe('外部修改');
});
it('does not delete the source if a verified replacement cannot complete the rename',async()=>{
    const d=disk();d.refuseRemoval();
    await expect(saveDraft(d.state,{renameFile:true})).rejects.toThrow();
    expect([...d.entries.keys()]).toEqual([d.source.name]);expect(parseBoard(d.source.data).file.board.name).toBe('施密特数');
});
it('autosave can persist a title without renaming or requesting folder permission',async()=>{
    const d=disk();await saveDraft(d.state,{renameFile:false,expectedFile:d.file});
    expect(window.showDirectoryPicker).not.toHaveBeenCalled();expect([...d.entries.keys()]).toEqual([d.source.name]);
    expect(parseBoard(d.source.data).file.board.name).toBe('史密斯数');
});
it.each([['CON','_CON.draft'],['a/b:c','a_b_c.draft'],['...','未命名白板.draft'],['施密特数.draft.draft','施密特数.draft']])('makes a portable filename without changing the title: %s',(name,expected)=>{
    expect(draftFileName(name)).toBe(expected);
});
