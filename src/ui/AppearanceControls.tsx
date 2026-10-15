import { useLayoutEffect, useRef, useState } from 'react';
import { type EdgeRouting, type EdgeStroke, type NodeShape, type Op } from '../model';
import type { EditorApi } from './store';
import { centeredShapeOps } from './shapeChange';

const shapes: [NodeShape, string][] = [['card','普通卡片'],['rectangle','步骤矩形'],['diamond','判断菱形'],['pill','起止圆角']];
export function AppearanceControls({ editor }: { editor: EditorApi }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({left:8,top:8});
  const { state, commit } = editor;
  const nodes = state.file.nodes.filter(n => state.selection.nodes.includes(n.id) && n.type === 'text');
  const edges = state.file.edges.filter(e => state.selection.edges.includes(e.id));
  useLayoutEffect(()=>{
    if(!open || !anchor.current || !panel.current)return;
    const place=()=>{
      const a=anchor.current?.getBoundingClientRect(), p=panel.current?.getBoundingClientRect();
      if(!a || !p)return;
      const left=Math.max(8,Math.min(a.left,window.innerWidth-p.width-8));
      const preferred=a.bottom+8+p.height<=window.innerHeight-8?a.bottom+8:a.top-p.height-8;
      const top=Math.max(8,Math.min(preferred,window.innerHeight-p.height-8));
      setPosition(old=>old.left===left&&old.top===top?old:{left,top});
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,nodes.length,edges.length]);
  if (!nodes.length && !edges.length) return null;
  const disabled = state.replay.active || !!state.editingId;
  const common = <T,>(values: T[]) => values.every(v => v === values[0]) ? values[0] : '__mixed__';
  const setShape = (shape: NodeShape) => {
    try{
      const ops=centeredShapeOps(nodes,shape);
      if(ops.length)commit('设置卡片外形',ops);
    }catch(error){editor.dispatch({type:'commitError',message:error instanceof Error?error.message:String(error)});}
  };
  const setEdge = (key: 'routing' | 'stroke', value: EdgeRouting | EdgeStroke | '') => {
    const ops: Op[] = edges.filter(e => (e[key] ?? '') !== value).map(e => ({op:'setEdgeStyle',edgeId:e.id,before:null,
      after:{routing:e.routing ?? null,stroke:e.stroke ?? null,[key]:value || null}}));
    if (ops.length) commit('设置连线画法',ops);
  };
  return <div ref={anchor} className="appearance-controls" onKeyDown={e=>{if(e.key==='Escape')setOpen(false);e.stopPropagation();}}>
    <button type="button" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>外形与连线 ▾</button>
    {open && <div ref={panel} style={position} className="appearance-popover" role="group" aria-label="外形与连线设置">
      {nodes.length > 0 && <label>卡片外形<select aria-label="卡片外形" disabled={disabled} value={common(nodes.map(n => n.shape ?? 'card'))}
        onChange={e => setShape(e.target.value as NodeShape)}>
        <option value="__mixed__" disabled>多种外形</option>{shapes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
      {edges.length > 0 && <>
        <label>连线画法<select aria-label="连线画法" disabled={disabled} value={common(edges.map(e => e.routing ?? ''))} onChange={e => setEdge('routing',e.target.value as EdgeRouting | '')}>
          <option value="__mixed__" disabled>多种画法</option><option value="">默认曲线</option><option value="curve">自由曲线</option><option value="orthogonal">流程折线</option>
        </select></label>
        <label>线条<select aria-label="线条样式" disabled={disabled} value={common(edges.map(e => e.stroke ?? ''))} onChange={e => setEdge('stroke',e.target.value as EdgeStroke | '')}>
          <option value="__mixed__" disabled>多种线条</option><option value="">默认</option><option value="solid">实线</option><option value="dashed">虚线</option><option value="flowing-dashed">流动虚线</option>
        </select></label>
        {edges.some(e => e.stroke === 'flowing-dashed' && !e.directed) && <p>无箭头的连线保持静态虚线。</p>}
      </>}
      <p>改变呈现，保留核心、备注与关系。</p>
      <button type="button" onClick={() => setOpen(false)}>收起设置</button>
    </div>}
  </div>;
}
