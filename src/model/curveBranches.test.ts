import { expect, it } from 'vitest';
import { edgeGeometries, edgeGeometry, segmentTouchesRect } from './edgeRouting';
import { createEmptyBoard } from './index';
import { readabilityConflicts } from './layoutChecks';
import type { BoardEdge, BoardNode } from './types';

// Synthetic reproduction of a wide row where the outer branch used to cross
// its neighbour and acquire upward hooks when the default side port hit a card.
const boxes = [[300,39,238,85],[4,228,219,86],[264,228,310,86],[615,235,270,72],[941,228,220,86]];
function scene(turns=0) {
    const nodes:BoardNode[]=boxes.map(([x,y,w,h],i)=>{
        for(let turn=0;turn<turns;turn++)[x,y,w,h]=[-y-h,x,h,w];
        return {id:`n_branch0${i}`,type:'text',markdown:`Card ${i}`,x:x*1.5,y:y*1.5,w:w*1.5,h:h*1.5};
    });
    const edges:BoardEdge[]=nodes.slice(1).map((n,i)=>({id:`e_branch0${i}`,kind:'parentChild',from:nodes[0].id,to:n.id,directed:true}));
    return {nodes,edges};
}
function assertClear(nodes:BoardNode[],edges:BoardEdge[]) {
    const geometries=edgeGeometries(edges,nodes,{});
    for(const edge of edges){
        const g=geometries.get(edge.id)!;
        for(const n of nodes.filter(n=>n.id!==edge.from && n.id!==edge.to)){
            const r={x:n.x-12,y:n.y-12,w:n.w+24,h:n.h!+24};
            expect(g.points.slice(1).some((p,i)=>segmentTouchesRect(g.points[i],p,r)),`${edge.id} hits ${n.id}`).toBe(false);
        }
    }
    return geometries;
}
it.each([0,1,2,3])('orders sibling curves without crossing, re-entry or reverse hooks (rotation %s)',turns=>{
    const {nodes,edges}=scene(turns),before=structuredClone(nodes);
    const geometries=assertClear(nodes,edges),axis=turns%2?'x':'y',sign=turns===0||turns===3?1:-1;
    for(const edge of edges){
        const g=geometries.get(edge.id)!;
        expect(g.routed).toBe(false);
        expect(g.points.slice(1).every((p,i)=>sign*(p[axis]-g.points[i][axis])>=-1e-8)).toBe(true);
        expect(g.d).not.toMatch(/ [LQ] /);
    }
    const file={...createEmptyBoard(),nodes,edges};
    expect(readabilityConflicts(file,{})).toEqual([]);
    expect(nodes).toEqual(before);
    const shuffled=edgeGeometries([...edges].reverse(),[...nodes].reverse(),{});
    for(const edge of edges){
        expect(shuffled.get(edge.id)!.d).toBe(geometries.get(edge.id)!.d);
        expect(edgeGeometry(edge,nodes,{},undefined,edges)!.d).toBe(geometries.get(edge.id)!.d);
    }
});
it('still routes around a real blocker instead of allowing ordered branches to hit cards',()=>{
    const {nodes,edges}=scene();
    nodes.push({id:'n_blocker1',type:'text',markdown:'Obstacle',x:850,y:235,w:100,h:65});
    const geometries=assertClear(nodes,edges);
    expect([...geometries.values()].some(g=>g.routed)).toBe(true);
});
it('uses actual outer dimensions and re-derives curves after movement or caption expansion',()=>{
    const {nodes,edges}=scene();
    const heights=Object.fromEntries(nodes.map(n=>[n.id,n.h!])),widths=Object.fromEntries(nodes.map(n=>[n.id,n.w]));
    const smaller=nodes.map(n=>({...n,w:80,h:40}));
    const original=edgeGeometries(edges,nodes,{}),measured=edgeGeometries(edges,smaller,heights,widths);
    for(const edge of edges)expect(measured.get(edge.id)!.d).toBe(original.get(edge.id)!.d);
    heights[nodes[0].id]+=35;
    expect(edgeGeometries(edges,smaller,heights,widths).get(edges[0].id)!.d).not.toBe(original.get(edges[0].id)!.d);
    nodes[4].x+=120;
    expect(edgeGeometries(edges,nodes,{}).get(edges[3].id)!.d).not.toBe(original.get(edges[3].id)!.d);
});
it('keeps smooth detours within a forward corridor instead of overshooting its corners',()=>{
    const nodes:BoardNode[]=[{id:'n_a',type:'text',x:0,y:0,w:100,h:70},{id:'n_b',type:'text',x:500,y:0,w:100,h:70},{id:'n_c',type:'text',x:240,y:-40,w:120,h:150}];
    const edge:BoardEdge={id:'e_a',kind:'association',from:'n_a',to:'n_b',directed:true};
    const g=edgeGeometry(edge,nodes,{})!;
    expect(g.routed).toBe(true);
    expect(g.points.slice(1).every((p,i)=>p.x>=g.points[i].x-1e-8)).toBe(true);
    expect(g.points.slice(1).some((p,i)=>segmentTouchesRect(g.points[i],p,{x:228,y:-52,w:144,h:174}))).toBe(false);
});
it.each(['rectangle','diamond','pill'] as const)('keeps %s endpoint outlines outside the curve',shape=>{
    const {nodes,edges}=scene();nodes[0].shape=shape;
    const geometries=assertClear(nodes,edges),r=nodes[0];
    for(const g of geometries.values())for(const p of g.points){
        const dx=Math.abs(p.x-r.x-r.w/2),dy=Math.abs(p.y-r.y-r.h!/2);
        if(shape==='diamond')expect(dx/(r.w/2)+dy/(r.h!/2)).toBeGreaterThanOrEqual(1);
        else expect(dx>=r.w/2 || dy>=r.h!/2).toBe(true);
    }
});
