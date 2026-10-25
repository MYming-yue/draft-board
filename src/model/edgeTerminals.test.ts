import { expect, it } from 'vitest';
import { arrowTerminal, ARROW_LENGTH, ARROW_WIDTH } from './edgeTerminals';
import type { Point } from './edgeRouting';

const path={d:'M 0 0 C 0 60, 600 60, 600 120',points:[{x:0,y:0},{x:600,y:120}]};
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const cubic=(p:Point[],t:number):Point=>{const u=1-t;return{x:u*u*u*p[0].x+3*u*u*t*p[1].x+3*u*t*t*p[2].x+t*t*t*p[3].x,y:u*u*u*p[0].y+3*u*u*t*p[1].y+3*u*t*t*p[2].y+t*t*t*p[3].y};};
const values=(d:string)=>d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
it('joins a shallow curve to a straight shaft at the centre of a smaller head',()=>{
    const g=arrowTerminal(path,()=>true),v=values(g.d),end=v.slice(-6),a=g.arrow!;
    expect(g.d).not.toBe(path.d);
    expect(end[0]).toBe(600);expect(end[2]).toBe(600);expect(end[4]).toBe(600);
    expect(a.tip).toEqual({x:600,y:120});
    expect(distance(a.tip,a.base)).toBeCloseTo(ARROW_LENGTH,5);
    expect(distance(a.left,a.right)).toBeCloseTo(ARROW_WIDTH,5);
    expect(values(g.strokeD).slice(-2)[0]).toBeCloseTo(a.base.x,7);
    expect(values(g.strokeD).slice(-2)[1]).toBeCloseTo(a.base.y,7);
    expect(g.points.slice(1).every((p,i)=>p.y>=g.points[i].y-1e-8)).toBe(true);
});
it('preserves the original cubic body exactly up to the local tail split',()=>{
    const g=arrowTerminal(path,()=>true),v=values(g.d),prefix=Array.from({length:4},(_,i)=>({x:v[i*2],y:v[i*2+1]}));
    const tCut=prefix[1].y/60;
    expect(tCut).toBeGreaterThan(.8);
    for(const t of [.1,.4,.7,1]){
        const a=cubic(prefix,t),b=cubic([{x:0,y:0},{x:0,y:60},{x:600,y:60},{x:600,y:120}],t*tCut);
        expect(distance(a,b)).toBeLessThan(1e-8);
    }
});
it('rejects an unsafe terminal without rerouting or altering the original body',()=>{
    const g=arrowTerminal(path,()=>false);
    expect(g.d).toBe(path.d);
    expect(g.arrow!.tip).toEqual({x:600,y:120});
    expect(distance(g.arrow!.base,g.arrow!.tip)).toBeCloseTo(10,5);
});
it('keeps orthogonal routing intact while attaching the head to its endpoint',()=>{
    const d='M 0 0 L 150 0 L 150 150',g=arrowTerminal({d,points:[{x:0,y:0},{x:150,y:0},{x:150,y:150}]},()=>true,false);
    expect(g.d).toBe(d);
    expect(g.arrow!.base.x).toBe(150);expect(g.arrow!.tip).toEqual({x:150,y:150});
});
it('supports a reciprocal quadratic without replacing its earlier curve',()=>{
    const g=arrowTerminal({d:'M 0 0 Q 100 -40, 200 0 Q 300 40, 400 0',points:[]},()=>true);
    expect(g.d).toMatch(/^M 0 0 Q 100 -40, 200 0 Q /);
    expect(g.arrow!.tip).toEqual({x:400,y:0});
});
it('scales a very short arrow to available space and handles zero-length edges',()=>{
    const g=arrowTerminal({d:'M 0 0 C 1 0, 2 0, 3 0',points:[{x:0,y:0},{x:3,y:0}]},()=>true);
    expect(distance(g.arrow!.base,g.arrow!.tip)).toBeLessThan(3);
    expect(g.strokeD).not.toMatch(/NaN|Infinity/);
    expect(arrowTerminal({d:'M 0 0 C 0 0, 0 0, 0 0',points:[{x:0,y:0}]},()=>true).arrow).toBeUndefined();
});
