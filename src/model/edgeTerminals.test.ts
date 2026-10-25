import { expect, it } from 'vitest';
import { arrowTerminal, ARROW_LENGTH, ARROW_WIDTH } from './edgeTerminals';
import type { Point } from './edgeRouting';

const path={d:'M 0 0 C 60 100, 400 100, 600 200',points:[{x:0,y:0},{x:600,y:200}]};
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const cubic=(p:Point[],t:number):Point=>{const u=1-t;return{x:u*u*u*p[0].x+3*u*u*t*p[1].x+3*u*t*t*p[2].x+t*t*t*p[3].x,y:u*u*u*p[0].y+3*u*u*t*p[1].y+3*u*t*t*p[2].y+t*t*t*p[3].y};};
const values=(d:string)=>d.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
it('attaches a fixed head along the original tangent without adding any curve or straight segment',()=>{
    const g=arrowTerminal(path),a=g.arrow!;
    expect(g.d).toBe(path.d);expect(g.points).toBe(path.points);
    expect(a.tip).toEqual({x:600,y:200});
    expect(distance(a.tip,a.base)).toBeCloseTo(ARROW_LENGTH,5);
    expect(distance(a.left,a.right)).toBeCloseTo(ARROW_WIDTH,5);
    expect((a.tip.x-a.base.x)/(a.tip.y-a.base.y)).toBeCloseTo(2,7);
    const v=values(g.strokeD),join={x:v.at(-2)!,y:v.at(-1)!};
    expect(distance(join,a.base)).toBeLessThan(1);
});
it('trims visible ink only by an exact split of the selected cubic',()=>{
    const g=arrowTerminal(path),v=values(g.strokeD),prefix=Array.from({length:4},(_,i)=>({x:v[i*2],y:v[i*2+1]}));
    const tCut=prefix[1].x/60;
    expect(tCut).toBeGreaterThan(.9);
    for(const t of [.1,.4,.7,1]){
        const a=cubic(prefix,t),b=cubic([{x:0,y:0},{x:60,y:100},{x:400,y:100},{x:600,y:200}],t*tCut);
        expect(distance(a,b)).toBeLessThan(1e-8);
    }
});
it('shrinks a head on a tight legacy curve rather than reshaping its terminal',()=>{
    const d='M 0 0 C 0 60, 600 60, 600 120',g=arrowTerminal({d,points:[]});
    expect(g.d).toBe(d);
    expect(g.arrow!.tip).toEqual({x:600,y:120});
    expect(distance(g.arrow!.base,g.arrow!.tip)).toBeLessThan(10);
});
it('keeps orthogonal routing intact while attaching the head to its endpoint',()=>{
    const d='M 0 0 L 150 0 L 150 150',g=arrowTerminal({d,points:[{x:0,y:0},{x:150,y:0},{x:150,y:150}]});
    expect(g.d).toBe(d);
    expect(g.arrow!.base.x).toBe(150);expect(g.arrow!.tip).toEqual({x:150,y:150});
});
it('keeps every segment of a reciprocal quadratic unchanged',()=>{
    const d='M 0 0 Q 100 -40, 200 0 Q 300 40, 400 0',g=arrowTerminal({d,points:[]});
    expect(g.d).toBe(d);
    expect(g.arrow!.tip).toEqual({x:400,y:0});
});
it('scales a very short arrow to available space and handles zero-length edges',()=>{
    const g=arrowTerminal({d:'M 0 0 C 1 0, 2 0, 3 0',points:[{x:0,y:0},{x:3,y:0}]});
    expect(distance(g.arrow!.base,g.arrow!.tip)).toBeLessThan(3);
    expect(g.strokeD).not.toMatch(/NaN|Infinity/);
    expect(arrowTerminal({d:'M 0 0 C 0 0, 0 0, 0 0',points:[{x:0,y:0}]}).arrow).toBeUndefined();
});
