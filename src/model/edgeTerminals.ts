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
const STEM_LENGTH = 14;
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
function cutBack(segments: Segment[],back: number): {prefix:Segment[];tail:Point[];direction:Point}|null {
    for(let i=segments.length-1;i>=0;i--){
        const segment=segments[i],p=samples(segment),ls=p.slice(1).map((q,j)=>distance(p[j],q)),length=ls.reduce((n,l)=>n+l,0);
        if(back>length){back-=length;continue;}
        let forward=length-back;
        for(let j=0;j<ls.length;j++){
            if(forward>ls[j] && j<ls.length-1){forward-=ls[j];continue;}
            const t=(j+forward/(ls[j]||1))/(p.length-1),[left,right]=split(segment.points,t);
            return {prefix:[...segments.slice(0,i),{command:segment.command,points:left}],tail:[right[0],...samples({command:segment.command,points:right}).slice(1),...segments.slice(i+1).flatMap(s=>samples(s).slice(1))],direction:unit(right[0],right[1])};
        }
    }
    return null;
}
function line(a: Point,b: Point): Segment {
    return {command:'C',points:[a,mix(a,b,1/3),mix(a,b,2/3),b]};
}
function nearOriginal(points: Point[],original: Point[]): boolean {
    return points.every(p=>original.slice(1).some((b,i)=>{
        const a=original[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
        return distance(p,{x:a.x+t*dx,y:a.y+t*dy})<=16;
    }));
}

/** Retain the routed body exactly; replace at most its final 96 world units.
 * The caller checks the small replacement for collisions before it is accepted. */
export function arrowTerminal(path: Path,canUseTail:(points:Point[])=>boolean,reserve=true): Path & {strokeD:string;arrow?:ArrowHead} {
    const original=parse(path.d),total=lengths(original).reduce((n,l)=>n+l,0);
    if(!original.length || total<1e-6)return {...path,strokeD:path.d};
    const last=original.at(-1)!.points,tip=last.at(-1)!;
    const prior=[...last.slice(0,-1)].reverse().find(p=>distance(p,tip)>1e-8);
    const direction=unit(prior??last[0],tip);
    let segments=original,result=path;
    const finalRun=reserve?cutBack(original,Math.min(STEM_LENGTH,total*.8)):null;
    const alreadyStraight=finalRun?.tail.every(p=>Math.abs((p.x-tip.x)*direction.y-(p.y-tip.y)*direction.x)<1e-7);
    if(reserve && !alreadyStraight)outer:for(const stem of [STEM_LENGTH,ARROW_LENGTH])for(const back of [40,56,72,88,96]){
        const cut=cutBack(original,Math.min(back,total*.35));
        if(!cut)continue;
        const a=cut.prefix.at(-1)!.points.at(-1)!,b={x:tip.x-direction.x*stem,y:tip.y-direction.y*stem},v={x:b.x-a.x,y:b.y-a.y};
        let h1=Math.min(distance(a,b)/3,(v.x*cut.direction.x+v.y*cut.direction.y)/2),h2=Math.min(distance(a,b)/3,(v.x*direction.x+v.y*direction.y)/2);
        for(const axis of ['x','y'] as const){
            if(cut.direction[axis]*v[axis]<-1e-8 || direction[axis]*v[axis]<-1e-8){h1=0;break;}
            if(Math.abs(cut.direction[axis])>1e-8)h1=Math.min(h1,Math.abs(v[axis]/cut.direction[axis])*.45);
            if(Math.abs(direction[axis])>1e-8)h2=Math.min(h2,Math.abs(v[axis]/direction[axis])*.45);
        }
        // A nonzero derivative alone can still look like a tiny elbow. Require
        // enough room for the turn, or retain the old curve and align its head.
        if(h1<6 || h2<6)continue;
        const blend:Segment={command:'C',points:[a,{x:a.x+cut.direction.x*h1,y:a.y+cut.direction.y*h1},{x:b.x-direction.x*h2,y:b.y-direction.y*h2},b]};
        const tail=[...samples(blend),tip];
        if(!nearOriginal(tail,cut.tail) || !canUseTail(tail))continue;
        segments=[...cut.prefix,blend,line(b,tip)];result=describe(segments);break outer;
    }
    // Place the head at the original tip and end visible ink at its base.
    // A circle intersection keeps even an unmodified tight curve attached.
    const headLength=Math.min(ARROW_LENGTH,total*.55),points=result.points;
    let found:{index:number;t:number}|undefined;
    for(let i=segments.length-1;i>=0 && !found;i--){
        const p=samples(segments[i]);
        for(let j=p.length-2;j>=0;j--)if(distance(p[j],tip)>=headLength){
            let lo=j/(p.length-1),hi=(j+1)/(p.length-1);
            for(let k=0;k<24;k++){const t=(lo+hi)/2,q=split(segments[i].points,t)[0].at(-1)!;if(distance(q,tip)>headLength)lo=t;else hi=t;}
            found={index:i,t:(lo+hi)/2};break;
        }
    }
    if(!found)return {...result,strokeD:result.d};
    const [left]=split(segments[found.index].points,found.t),base=left.at(-1)!,u=unit(base,tip),half=ARROW_WIDTH/2*headLength/ARROW_LENGTH;
    const arrow:ArrowHead={tip,base,left:{x:base.x-u.y*half,y:base.y+u.x*half},right:{x:base.x+u.y*half,y:base.y-u.x*half}};
    return {...result,points,strokeD:describe([...segments.slice(0,found.index),{command:segments[found.index].command,points:left}]).d,arrow};
}
