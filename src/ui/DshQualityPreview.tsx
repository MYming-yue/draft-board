import { useEffect, useRef, useState } from "react";
import { parseBoard, visibleEdges, type DraftBundle, type LayoutGeometry, type Rect } from "../model";
import { NodeCard } from "./NodeCard";
import { EdgeLayer } from "./EdgeLayer";

interface Job { id: string; before: string; data: string }
interface Measurement { geometry: LayoutGeometry; labels: Record<string, Rect> }
const decode = (data: string) => parseBoard(Uint8Array.from(atob(data), c=>c.charCodeAt(0)));
const noop = () => {};
async function api(body?: object) {
  const response=await fetch('/api/dsh-board/quality',body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {cache:'no-store'});
  if(!response.ok)throw new Error('布局检查连接暂不可用');
  return response.json();
}

function Preview({bundle, report}:{bundle:DraftBundle;report:(value:Measurement)=>void}) {
  const root=useRef<HTMLDivElement>(null);
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [geometry,setGeometry]=useState<LayoutGeometry>({});
  useEffect(()=>{
    const next=Object.fromEntries(bundle.file.assets.map(a=>[a.id,URL.createObjectURL(new Blob([new Uint8Array(bundle.blobs[a.id])],{type:a.mime}))]));
    setUrls(next);
    return ()=>Object.values(next).forEach(url=>URL.revokeObjectURL(url));
  },[bundle]);
  useEffect(()=>{
    let stopped=false,stable='',count=0;
    const timer=setInterval(()=>{
      const el=root.current;
      if(stopped || !el || document.fonts.status==='loading' || bundle.file.assets.some(a=>!urls[a.id]))return;
      if([...el.querySelectorAll('img')].some(img=>!img.complete || !img.naturalWidth))return;
      const next:LayoutGeometry={};
      for(const card of el.querySelectorAll<HTMLElement>('.node-card[data-node-id]')) {
        const style=getComputedStyle(card);
        next[card.dataset.nodeId!]={w:parseFloat(style.width),h:parseFloat(style.height)};
      }
      if(!bundle.file.nodes.every(n=>next[n.id]?.w>0 && next[n.id]?.h>0))return;
      const signature=JSON.stringify(next);
      if(signature!==JSON.stringify(geometry)){setGeometry(next);stable='';count=0;return;}
      const labels:Record<string,Rect>={};
      for(const text of el.querySelectorAll<SVGGraphicsElement>('[data-edge-id] .edge-label')) {
        const b=text.getBBox(),id=text.closest('[data-edge-id]')!.getAttribute('data-edge-id')!;
        labels[id]={x:b.x,y:b.y,w:b.width,h:b.height};
      }
      if(visibleEdges(bundle.file.edges).some(e=>e.label && !labels[e.id]))return;
      const current=JSON.stringify({geometry:next,labels});
      count=current===stable?count+1:0;stable=current;
      if(count>=2){report({geometry:next,labels});stopped=true;}
    },80);
    return ()=>{stopped=true;clearInterval(timer);};
  },[bundle,urls,geometry,report]);
  return <div ref={root} className="canvas" style={{position:'relative',width:1600,height:1000}}><div className="world">
    <EdgeLayer nodes={bundle.file.nodes} edges={bundle.file.edges} heights={Object.fromEntries(Object.entries(geometry).map(([id,g])=>[id,g.h]))}
      widths={Object.fromEntries(Object.entries(geometry).map(([id,g])=>[id,g.w]))} selectedEdgeIds={[]} connect={null} editingLabelId={null} readOnly
      onSelectEdge={noop} onLabelDoubleClick={noop} onCommitLabel={noop} onCancelLabel={noop}/>
    {bundle.file.nodes.map(node=><NodeCard key={node.id} node={node} hideCaptions={false} selected={true} front={false} editing={false} readOnly
      blobUrl={node.assetId?urls[node.assetId]:undefined} dragDelta={null} connectSourceId={null}
      onCardPointerDown={noop} onCardPointerUp={noop} onStartConnect={noop} onCommitText={noop} onStartEdit={noop} onCancelEdit={noop}
      onResizeTextEnd={noop} onResizeCaptionWidth={noop} onImageAspect={noop} onResizeImageEnd={noop}/>)}</div></div>;
}

/** Separate read-only DOM: candidates never reach the user's editor or history. */
export function DshQualityPreview() {
  const [job,setJob]=useState<{id:string;before:DraftBundle;after:DraftBundle}|null>(null);
  const active=useRef<string|null>(null),measurements=useRef<{before?:Measurement;after?:Measurement}>({});
  const reports=useRef({before:(m:Measurement)=>{measurements.current.before=m;},after:(m:Measurement)=>{measurements.current.after=m;}});
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{
      try {
        const next=await api() as {job:Job|null};
        if(stopped)return;
        if(next.job?.id!==active.current) {
          active.current=next.job?.id ?? null;measurements.current={};
          setJob(next.job?{id:next.job.id,before:decode(next.job.before),after:decode(next.job.data)}:null);
        } else if(next.job && measurements.current.before && measurements.current.after) {
          await api({id:next.job.id,before:measurements.current.before,after:measurements.current.after});
          active.current=null;measurements.current={};if(!stopped)setJob(null);
        }
      } catch { /* A transport error never becomes a successful measurement; the host times out safely. */ }
      finally {if(!stopped)timer=setTimeout(tick,200);}
    };
    void tick();return ()=>{stopped=true;clearTimeout(timer);};
  },[]);
  return job ? <><Preview key={job.id+'before'} bundle={job.before} report={reports.current.before}/><Preview key={job.id+'after'} bundle={job.after} report={reports.current.after}/></> : null;
}
