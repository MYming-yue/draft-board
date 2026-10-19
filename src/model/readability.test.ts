import { expect, it } from 'vitest';
import { createEmptyBoard, readabilityConflicts, type BoardFile, type BoardNode } from './index';
const card=(id:string,x:number,y:number):BoardNode=>({id,type:'text',markdown:id,x,y,w:100,h:70});
const board=(nodes:BoardNode[]):BoardFile=>({...createEmptyBoard(),nodes});
it('detects disjoint collection envelopes even while their member cards do not overlap',()=>{
  const file=board([card('n_group01',0,0),card('n_group02',150,0)]);
  file.collections=file.nodes.map((n,i)=>({id:`g_group0${i}`,name:'分组',shape:'rectangle',nodeIds:[n.id],x:n.x,y:n.y}));
  const issues=readabilityConflicts(file,{});
  expect(issues.some(c=>c.kind==='card')).toBe(false);
  expect(issues.some(c=>c.kind==='collection-overlap' && c.collectionIds?.length===2)).toBe(true);
  file.collections[1].nodeIds.push(file.nodes[0].id);
  expect(readabilityConflicts(file,{}).some(c=>c.kind==='collection-overlap')).toBe(false);
});
it('detects independent crossing paths and actual multilingual label rectangles',()=>{
  const file=board([card('n_cross01',0,0),card('n_cross02',800,600),card('n_cross03',800,0),card('n_cross04',0,600)]);
  file.edges=[{id:'e_cross01',kind:'association',from:'n_cross01',to:'n_cross02',directed:true,label:'长中文标签'},
    {id:'e_cross02',kind:'association',from:'n_cross03',to:'n_cross04',directed:true,label:'另一说明'}];
  expect(readabilityConflicts(file,{}).some(c=>c.kind==='edge-crossing')).toBe(true);
  const labels={e_cross01:{x:400,y:260,w:180,h:20},e_cross02:{x:410,y:265,w:180,h:20}};
  expect(readabilityConflicts(file,{},labels).some(c=>c.kind==='label-overlap')).toBe(true);
});
it('keeps deliberate shared flow trunks while rejecting colliding labels',()=>{
  const file=board([card('n_trunk01',300,0),card('n_trunk02',0,400),card('n_trunk03',600,400)]);
  file.edges=file.nodes.slice(1).map((n,i)=>({id:`e_trunk0${i}`,kind:'association',from:file.nodes[0].id,to:n.id,directed:true,routing:'orthogonal',label:'条件'}));
  const labels=Object.fromEntries(file.edges.map(e=>[e.id,{x:300,y:200,w:70,h:20}]));
  const issues=readabilityConflicts(file,{},labels);
  expect(issues.some(c=>c.kind==='edge-overlap' || c.kind==='edge-crossing')).toBe(false);
  expect(issues.some(c=>c.kind==='label-overlap')).toBe(true);
});
