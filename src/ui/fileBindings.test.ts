import {expect,it,vi} from 'vitest';
import {createEmptyBoard,serializeBoard} from '../model';
import {fileFingerprint,restoreFileBinding,type SavedFileBinding} from './fileBindings';

async function binding() {
    const file=createEmptyBoard('已记住的白板'),bytes=serializeBoard(file,{});
    const handle={kind:'file',name:'已记住的白板.draft',queryPermission:vi.fn(async()=>'granted'),requestPermission:vi.fn(async()=>'granted'),getFile:vi.fn(async()=>new File([bytes as BlobPart],'已记住的白板.draft'))};
    const record:SavedFileBinding={version:1,boardId:file.board.id,handle:handle as unknown as FileSystemFileHandle,boardName:file.board.name,fingerprint:await fileFingerprint(bytes)};
    return {file,bytes,handle,record};
}
it('restores the exact saved file without asking again when access remains granted',async()=>{
    const b=await binding(),restored=await restoreFileBinding(b.record,b.file.board.id);
    expect(restored.file).toEqual(b.file);expect(b.handle.requestPermission).not.toHaveBeenCalled();
});
it('does not reuse another board’s file or ask for its permissions',async()=>{
    const b=await binding();await expect(restoreFileBinding(b.record,'other-board')).rejects.toThrow('其他白板');
    expect(b.handle.queryPermission).not.toHaveBeenCalled();expect(b.handle.getFile).not.toHaveBeenCalled();
});
it('refuses a remembered file whose saved bytes were changed externally',async()=>{
    const b=await binding(),changed=structuredClone(b.file);changed.board.name='外部改动';
    b.handle.getFile.mockResolvedValue(new File([serializeBoard(changed,{}) as BlobPart],b.handle.name));
    await expect(restoreFileBinding(b.record,b.file.board.id)).rejects.toThrow('外部修改');
});
it('keeps a missing file unbound rather than creating a replacement silently',async()=>{
    const b=await binding();b.handle.getFile.mockRejectedValue(new DOMException('Missing','NotFoundError'));
    await expect(restoreFileBinding(b.record,b.file.board.id)).rejects.toThrow('已移动或删除');
});
it('re-authorizes the remembered folder instead of selecting a new folder',async()=>{
    const b=await binding();let permission:PermissionState='prompt';
    const directory={queryPermission:vi.fn(async()=>permission),requestPermission:vi.fn(async()=>{permission='granted';return permission;})};
    b.record.directory=directory as unknown as FileSystemDirectoryHandle;
    b.handle.queryPermission.mockImplementation(async()=>permission);
    await restoreFileBinding(b.record,b.file.board.id);
    expect(directory.requestPermission).toHaveBeenCalledOnce();expect(b.handle.requestPermission).not.toHaveBeenCalled();
});
it('keeps denied access denied and never reads the file',async()=>{
    const b=await binding();b.handle.queryPermission.mockResolvedValue('prompt');b.handle.requestPermission.mockResolvedValue('denied');
    await expect(restoreFileBinding(b.record,b.file.board.id)).rejects.toThrow('尚未获准');
    expect(b.handle.getFile).not.toHaveBeenCalled();
});
it('fingerprints the saved bytes, including changes outside the title',async()=>{
    expect(await fileFingerprint(new Uint8Array([1,2,3]))).toBe(await fileFingerprint(new Uint8Array([1,2,3])));
    expect(await fileFingerprint(new Uint8Array([1,2,3]))).not.toBe(await fileFingerprint(new Uint8Array([1,2,4])));
});
