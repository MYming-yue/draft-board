import type { Point } from './edgeRouting';

export interface ArrowHead {
    tip: Point;
    base: Point;
    left: Point;
    right: Point;
}
type Segment = { command: 'L' | 'Q' | 'C'; points: Point[] };
type Path = { d: string; points: Point[] };
export const ARROW_LENGTH = 10;
export const ARROW_WIDTH = 7;
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
const mix = (a: Point,b: Point,t: number): Point => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function unit(a: Point,b: Point): Point {
    const length=distance(a,b);
    return {x:(b.x-a.x)/(length||1),y:(b.y-a.y)/(length||1)};
}
function split(points: Point[],t: number): [Point[],Point[]] {
    const left=[points[0]],right=[points.at(-1)!];
    let row=points;
    while(row.length>1){row=row.slice(1).map((p,i)=>mix(row[i],p,t));left.push(row[0]);right.unshift(row.at(-1)!);}
    return [left,right];
}
function parse(d: string): Segment[] {
    const segments:Segment[]=[];
    let start:Point={x:0,y:0};
    for(const match of d.matchAll(/([MLQC])\s*([^MLQC]+)/g)){
        const values=match[2].match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
        if(match[1]==='M'){start={x:values[0],y:values[1]};continue;}
        const points=[start];
        for(let i=0;i<values.length;i+=2)points.push({x:values[i],y:values[i+1]});
        segments.push({command:match[1] as Segment['command'],points});start=points.at(-1)!;
    }
    return segments;
}
function samples(segment: Segment): Point[] {
    return Array.from({length:segment.command==='L'?2:49},(_,i)=>split(segment.points,i/(segment.command==='L'?1:48))[0].at(-1)!);
}
function describe(segments: Segment[]): Path {
    const start=segments[0].points[0],points=[start];
    let d=`M ${start.x} ${start.y}`;
    for(const segment of segments){
        d+=` ${segment.command} ${segment.points.slice(1).map(p=>`${p.x} ${p.y}`).join(', ')}`;
        points.push(...samples(segment).slice(1));
    }
    return {d,points};
}
function lengths(segments: Segment[]): number[] {
    return segments.map(s=>{const p=samples(s);return p.slice(1).reduce((n,q,i)=>n+distance(p[i],q),0);});
}
/** Decorate the existing terminal tangent. Never reshape the selected path. */
export function arrowTerminal(path: Path): Path & {strokeD:string;arrow?:ArrowHead} {
    const segments=parse(path.d),total=lengths(segments).reduce((n,l)=>n+l,0);
    if(!segments.length || total<1e-6)return {...path,strokeD:path.d};
    const last=segments.at(-1)!.points,tip=last.at(-1)!;
    const prior=[...last.slice(0,-1)].reverse().find(p=>distance(p,tip)>1e-8);
    const u=unit(prior??last[0],tip);
    // Trim under the filled head's base plane with a small ink overlap. The
    // base stays perpendicular to the final tangent; no artificial straight run.
    for(const scale of [1,.75,.5,.25,.1]){
        const headLength=Math.min(ARROW_LENGTH,total*.55)*scale,half=ARROW_WIDTH/2*headLength/ARROW_LENGTH;
        const overlap=Math.min(.75,headLength*.1),depth=headLength-overlap;
        const behind=(p:Point)=>(tip.x-p.x)*u.x+(tip.y-p.y)*u.y;
        let found:{index:number;t:number}|undefined;
        for(let i=segments.length-1;i>=0 && !found;i--){
            const p=samples(segments[i]);
            for(let j=p.length-2;j>=0;j--)if(behind(p[j])>=depth){
                let lo=j/(p.length-1),hi=(j+1)/(p.length-1);
                for(let k=0;k<28;k++){const t=(lo+hi)/2,q=split(segments[i].points,t)[0].at(-1)!;if(behind(q)>depth)lo=t;else hi=t;}
                found={index:i,t:(lo+hi)/2};break;
            }
        }
        if(!found)continue;
        const [prefix]=split(segments[found.index].points,found.t),join=prefix.at(-1)!;
        const offset=Math.abs((join.x-tip.x)*u.y-(join.y-tip.y)*u.x);
        if(offset>half*depth/headLength*.7)continue;
        const base={x:tip.x-u.x*headLength,y:tip.y-u.y*headLength};
        const arrow:ArrowHead={tip,base,left:{x:base.x-u.y*half,y:base.y+u.x*half},right:{x:base.x+u.y*half,y:base.y-u.x*half}};
        return {...path,strokeD:describe([...segments.slice(0,found.index),{command:segments[found.index].command,points:prefix}]).d,arrow};
    }
    return {...path,strokeD:path.d};
}
