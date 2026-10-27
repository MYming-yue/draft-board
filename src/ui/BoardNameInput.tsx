import { useEffect, useRef, useState } from 'react';
import type { EditorApi } from './store';

export function BoardNameInput({editor}:{editor:EditorApi}) {
    const {state,dispatch}=editor;
    const [editing,setEditing]=useState(false),[draft,setDraft]=useState(state.file.board.name);
    const original=useRef(state.file.board.name),composing=useRef(false);
    useEffect(()=>{setEditing(false);setDraft(state.file.board.name);original.current=state.file.board.name;composing.current=false;},[state.sessionId]);
    const commit=(text:string)=>dispatch({type:'rename',name:text.trim() || original.current});
    return <input className="board-name" title="白板名称" aria-label="白板名称"
        value={editing?draft:state.file.board.name} placeholder={original.current}
        onFocus={()=>{original.current=state.file.board.name;setDraft(state.file.board.name);setEditing(true);}}
        onChange={event=>{setDraft(event.target.value);if(!composing.current)commit(event.target.value);}}
        onCompositionStart={()=>{composing.current=true;}}
        onCompositionEnd={event=>{composing.current=false;commit(event.currentTarget.value);}}
        onBlur={event=>{commit(event.currentTarget.value);composing.current=false;setEditing(false);}}
        onKeyDown={event=>{if(event.key==='Enter' && !composing.current){event.preventDefault();event.currentTarget.blur();}}}/>
}
