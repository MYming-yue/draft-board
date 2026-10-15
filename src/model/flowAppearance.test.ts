import { describe, expect, it } from 'vitest';
import { applyBatch, applyOps, commitStep, contentEqual, createEmptyBoard, duplicateGroup, invertOps, parseBoard, replayTo, serializeBoard, stripHistory, validateEdgeShape, validateNodeShape, type BoardEdge, type BoardFile, type BoardNode, type Op } from './index';
import { edgeGeometry, segmentTouchesRect } from './edgeRouting';
const node=(id:string,x=0,y=0):BoardNode=>({id,type:'text',markdown:'条件是否满足？',caption:'依据保留在备注中。',x,y,w:140,h:90});
const a=node('n_flow001'),b=node('n_flow002',300,300);
const edge:BoardEdge={id:'e_flow001',kind:'association',from:a.id,to:b.id,directed:true,label:'满足'};
function commit(file:BoardFile,ops:Op[]){const r=commitStep(file,'外形变化','agent',ops);if(!r.ok)throw new Error(r.error.message);return r;}
function fixture(){return commit(createEmptyBoard(),[{op:'addNode',node:a,before:null,after:a},{op:'addNode',node:b,before:null,after:b},{op:'addEdge',edge,before:null,after:edge}]).state;}
describe('flow appearance is optional, portable and reversible',()=>{
  it('flowing dashes survive agent batches, reversing direction, copy, undo/redo and portable history',()=>{
    const old=fixture();
    const batch={batchVersion:'1.0' as const,boardId:old.board.id,baseContentVersion:old.board.contentVersion,actor:'agent' as const,label:'流动关系',ops:[
      {op:'setEdgeStyle' as const,edgeId:edge.id,before:{routing:null,stroke:'solid' as const},after:{routing:'curve' as const,stroke:'flowing-dashed' as const}},
    ]};
    const result=applyBatch(old,batch);expect(result.result.ok).toBe(true);if(!result.file)throw new Error('batch failed');
    const flow=result.file;
    expect(flow.edges[0]).toEqual({...edge,routing:'curve',stroke:'flowing-dashed'});
    expect(flow.history.at(-1)!.ops[0].before).toEqual({routing:null,stroke:null});
    expect(flow.board.contentVersion).toBe(old.board.contentVersion+1);
    expect(flow.history).toHaveLength(old.history.length+1);
    expect(flow.formatVersion).toBe('3.0');
    for(const f of [flow,stripHistory(flow)])expect(parseBoard(serializeBoard(f,{})).file).toEqual(f);
    expect(contentEqual(replayTo(flow),flow)).toBe(true);
    let serial=0;
    const copies=duplicateGroup(flow,[a.id,b.id],kind=>`${kind==='edge'?'e':'n'}_flowcopy${++serial}`);
    expect(copies.filter(o=>o.op==='addEdge')[0].edge.stroke).toBe('flowing-dashed');
    const restored=commit(flow,invertOps(flow.history.at(-1)!.ops)).state;
    expect(restored.edges).toEqual(old.edges);
    const redone=commit(restored,batch.ops).state;expect(redone.edges).toEqual(flow.edges);
    const reversed=commit(redone,[{op:'updateEdge',edgeId:edge.id,before:null,after:{from:b.id,to:a.id,directed:true,label:'返回'}}]).state;
    expect(reversed.edges[0]).toEqual({...flow.edges[0],from:b.id,to:a.id,label:'返回'});
    const undirected=commit(reversed,[{op:'updateEdge',edgeId:edge.id,before:null,after:{from:b.id,to:a.id,directed:false}}]).state;
    expect(undirected.edges[0].stroke).toBe('flowing-dashed');
    const added={...edge,id:'e_flowadd0',kind:'parentChild' as const,stroke:'flowing-dashed' as const};
    expect(commit(old,[{op:'addEdge',edge:added,before:null,after:added}]).state.edges.at(-1)).toEqual(added);
  });
  it('unknown dash styles reject the whole operation and invalid files instead of accepting partial changes',()=>{
    const f=fixture(),before=structuredClone(f);
    for(const stroke of ['flow','animated',false,{},undefined]){
      const bad=applyOps(f,[{op:'setEdgeStyle',edgeId:edge.id,before:null,after:{routing:'curve',stroke:'flowing-dashed'}},
        {op:'setEdgeStyle',edgeId:edge.id,before:null,after:{routing:'curve',stroke}} as Op]);
      expect(bad.ok).toBe(false);expect(f).toEqual(before);
      expect(validateEdgeShape({...edge,stroke:stroke===undefined?'animated':stroke})).not.toBe(null);
    }
    const invalid=structuredClone(f);invalid.edges[0].stroke='animated' as never;
    expect(()=>parseBoard(serializeBoard(invalid,{}))).toThrow(/stroke/);
  });
  it('changes appearance without replacing identity, content or relation; undo/replay/copy/roundtrip preserve it',()=>{
    const old=fixture();
    const changed=commit(old,[{op:'setNodeShape',nodeId:a.id,before:{shape:'pill'},after:{shape:'diamond'}},{op:'setEdgeStyle',edgeId:edge.id,before:{routing:'orthogonal',stroke:'solid'},after:{routing:'orthogonal',stroke:'solid'}}]);
    expect(changed.state.nodes[0]).toEqual({...a,shape:'diamond'});
    expect(changed.state.edges[0]).toEqual({...edge,routing:'orthogonal',stroke:'solid'});
    expect(changed.step.ops[0].before).toEqual({shape:null});
    expect(changed.state.formatVersion).toBe('3.0');
    expect(contentEqual(replayTo(changed.state),changed.state)).toBe(true);
    expect(parseBoard(serializeBoard(changed.state,{})).file).toEqual(changed.state);
    expect(parseBoard(serializeBoard(stripHistory(changed.state),{})).file.nodes[0].shape).toBe('diamond');
    let serial=0;
    const copies=duplicateGroup(changed.state,[a.id,b.id],kind=>`${kind==='edge'?'e':'n'}_copy00${++serial}`);
    expect(copies.filter(o=>o.op==='addNode').some(o=>o.node.shape==='diamond')).toBe(true);
    expect(copies.filter(o=>o.op==='addEdge')[0].edge.routing).toBe('orthogonal');
    const restored=commit(changed.state,invertOps(changed.step.ops)).state;
    expect(restored.nodes).toEqual(old.nodes);expect(restored.edges).toEqual(old.edges);
    expect(restored.formatVersion).toBe('3.0');
    expect(contentEqual(replayTo(restored),restored)).toBe(true);
  });
  it('invalid appearance or a later failing operation leaves the entire input intact',()=>{
    const f=fixture(),before=structuredClone(f);
    for(const op of [
      {op:'setNodeShape',nodeId:a.id,before:null,after:{shape:'triangle'}},
      {op:'setNodeShape',nodeId:a.id,before:null,after:{shape:'diamond',markdown:'越界修改'}},
      {op:'setEdgeStyle',edgeId:edge.id,before:null,after:{routing:'spline',stroke:'solid'}},
      {op:'setEdgeStyle',edgeId:'e_missing0',before:null,after:{routing:'orthogonal',stroke:'solid'}},
    ]){expect(applyOps(f,[{op:'setNodeShape',nodeId:a.id,before:null,after:{shape:'diamond'}},op as Op]).ok).toBe(false);expect(f).toEqual(before);}
    expect(validateNodeShape({...a,type:'image',assetId:'a_test001',shape:'diamond'})).not.toBe(null);
  });
  it('older files retain their version; adding collections never downgrades a flow file',()=>{
    const f=fixture();expect(parseBoard(serializeBoard(f,{})).file.formatVersion).toBe('1.0');
    const flow=commit(f,[{op:'setNodeShape',nodeId:a.id,before:null,after:{shape:'rectangle'}}]).state;
    const c={id:'g_flow001',name:'阶段',shape:'rectangle' as const,nodeIds:[a.id],x:0,y:0};
    const grouped=commit(flow,[{op:'addCollection',collection:c,before:null,after:c}]).state;
    expect(grouped.formatVersion).toBe('3.0');expect(parseBoard(serializeBoard(grouped,{})).file.formatVersion).toBe('3.0');
  });
});
describe('flow routing',()=>{
  it('uses shared trunks for a fan-out and shape boundaries for diagonal curves',()=>{
    const n=[node(a.id,300,0),node(b.id,0,300),node('n_flow003',600,300)];
    const edges=[{...edge,routing:'orthogonal' as const},{...edge,id:'e_flow002',to:n[2].id,routing:'orthogonal' as const}];
    const paths=edges.map(e=>edgeGeometry(e,n,{})!);
    expect(paths[0].d.startsWith('M 370 92 L 370')).toBe(true);expect(paths[1].d.startsWith('M 370 92 L 370')).toBe(true);
    expect(paths[0].points[1]).toEqual(paths[1].points[1]);
    const g=edgeGeometry(edge,[{...a,shape:'diamond'},b],{})!;
    const dx=Math.abs(g.fromPt.x-a.w/2),dy=Math.abs(g.fromPt.y-a.h!/2);
    expect(dx/(a.w/2+2)+dy/(a.h!/2+2)).toBeCloseTo(1,6);
  });
  it('feedback travels outside the intervening cards and obstacles remain avoided',()=>{
    const n=[node(a.id,0,400),node(b.id,0,0),node('n_flow003',100,180)];
    const g=edgeGeometry({...edge,routing:'orthogonal'},n,{})!;
    expect(Math.max(...g.points.map(p=>p.x))).toBeGreaterThan(240);
    expect(g.points.slice(1).some((p,i)=>segmentTouchesRect(g.points[i],p,{x:90,y:170,w:160,h:110}))).toBe(false);
    expect(g.d).not.toContain(' C ');
  });
});
