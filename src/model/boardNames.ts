/** Keep the title as text; use a portable filename only at the file boundary. */
export function draftFileName(name: string): string {
    let base=name.trim().replace(/(?:\.draft)+$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'');
    base=Array.from(base).slice(0,180).join('').replace(/[. ]+$/g,'') || '未命名白板';
    if(/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(base))base='_'+base;
    return base+'.draft';
}
