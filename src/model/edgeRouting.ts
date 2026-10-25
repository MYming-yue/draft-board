import type { BoardEdge, BoardNode, NodeShape } from "./types";
import { arrowTerminal, type ArrowHead } from './edgeTerminals';
export type Point = {
    x: number;
    y: number;
};
export type Rect = {
    x: number;
    y: number;
    w: number;
    h: number;
};
export interface EdgeGeom {
    fromPt: Point;
    toPt: Point;
    mid: Point;
    d: string;
    points: Point[];
    routed: boolean;
    labelBox?: Rect;
    strokeD?: string;
    arrow?: ArrowHead;
}
const CLEARANCE = 12;
const expand = (r: Rect, gap: number): Rect => ({ x: r.x - gap, y: r.y - gap, w: r.w + gap * 2, h: r.h + gap * 2 });
export function segmentTouchesRect(a: Point, b: Point, r: Rect): boolean {
    let lo = 0, hi = 1;
    for (const [p, q] of [[a.x - b.x, a.x - r.x], [b.x - a.x, r.x + r.w - a.x], [a.y - b.y, a.y - r.y], [b.y - a.y, r.y + r.h - a.y]]) {
        if (Math.abs(p) < 1e-9) {
            if (q < 0)
                return false;
            continue;
        }
        const t = q / p;
        if (p < 0)
            lo = Math.max(lo, t);
        else
            hi = Math.min(hi, t);
        if (lo > hi)
            return false;
    }
    return true;
}
const clear = (a: Point, b: Point, rects: Rect[]) => !rects.some(r => segmentTouchesRect(a, b, r));
function insideNode(p:Point,n:BoardNode,r:Rect):boolean {
    const dx=Math.abs(p.x-r.x-r.w/2),dy=Math.abs(p.y-r.y-r.h/2);
    if(n.shape==='diamond')return dx/(r.w/2)+dy/(r.h/2)<1-1e-7;
    if(n.shape==='pill'){
        const radius=Math.min(r.w,r.h)/2,x=Math.max(0,dx-r.w/2+radius),y=Math.max(0,dy-r.h/2+radius);
        return dx<r.w/2 && dy<r.h/2 && x*x+y*y<radius*radius-1e-7;
    }
    return dx<r.w/2-1e-7 && dy<r.h/2-1e-7;
}
function border(r: Rect, p: Point, pad: number, shape?: NodeShape): Point {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = p.x - cx, dy = p.y - cy;
    if (!dx && !dy)
        return { x: cx, y: cy };
    let s = Math.min(dx ? (r.w / 2 + pad) / Math.abs(dx) : Infinity, dy ? (r.h / 2 + pad) / Math.abs(dy) : Infinity);
    if (shape === 'diamond') s = 1 / (Math.abs(dx) / (r.w / 2 + pad) + Math.abs(dy) / (r.h / 2 + pad));
    if (shape === 'pill') {
        const rx = r.w / 2 + pad, ry = r.h / 2 + pad, radius = Math.min(rx,ry);
        let lo = 0, hi = s;
        for (let i=0;i<24;i++) {
            const t=(lo+hi)/2, x=Math.max(0,Math.abs(dx*t)-rx+radius), y=Math.max(0,Math.abs(dy*t)-ry+radius);
            if (x*x+y*y <= radius*radius) lo=t; else hi=t;
        }
        s=lo;
    }
    return { x: cx + dx * s, y: cy + dy * s };
}
/** Shared trunks are derived from existing edges, never extra hidden nodes. */
function flowPath(from: BoardNode, to: BoardNode, nodes: BoardNode[], rect: (node: BoardNode) => Rect, edges: readonly BoardEdge[]): Point[] {
    const rf=rect(from), rt=rect(to), start=ports(rf,2), end=ports(rt,6), cx=rf.x+rf.w/2, tx=rt.x+rt.w/2;
    if (from.id === to.id) return [start[0],{x:rf.x+rf.w+36,y:start[0].y},{x:rf.x+rf.w+36,y:rf.y-36},{x:end[3].x,y:rf.y-36},end[3]];
    if (rt.y >= rf.y+rf.h+16) {
        if (from.shape === 'diamond' && Math.abs(tx-cx)>rf.w*.4) {
            const p=start[tx>cx ? 0 : 2]; return [p,{x:end[3].x,y:p.y},end[3]];
        }
        if (to.shape === 'diamond' && Math.abs(tx-cx)>rt.w*.4) {
            const q=end[tx>cx ? 2 : 0]; return [start[1],{x:start[1].x,y:q.y},q];
        }
        const children=edges.filter(o=>o.routing==='orthogonal' && o.from===from.id).flatMap(o=>nodes.filter(n=>n.id===o.to && n.y>=rf.y+rf.h+16).map(rect));
        const parents=edges.filter(o=>o.routing==='orthogonal' && o.to===to.id).flatMap(o=>nodes.filter(n=>n.id===o.from && rect(n).y+rect(n).h+16<=rt.y).map(rect));
        const top=children.length>1 ? Math.min(...children.map(r=>r.y)) : rt.y;
        const bottom=children.length<=1 && parents.length>1 ? Math.max(...parents.map(r=>r.y+r.h)) : rf.y+rf.h;
        const bus=(top+bottom)/2;
        return [start[1],{x:start[1].x,y:bus},{x:end[3].x,y:bus},end[3]];
    }
    if (rt.y+rt.h+16 <= rf.y) {
        const left=Math.min(rf.y,rt.y), bottom=Math.max(rf.y+rf.h,rt.y+rt.h);
        const lane=Math.max(rf.x+rf.w,rt.x+rt.w,...nodes.filter(n=>{const r=rect(n);return r.y+r.h>=left && r.y<=bottom;}).map(n=>{const r=rect(n);return r.x+r.w;}))+36;
        return [start[0],{x:lane,y:start[0].y},{x:lane,y:end[0].y},end[0]];
    }
    const right=tx>=cx, p=start[right?0:2], q=end[right?2:0], bus=(p.x+q.x)/2;
    return [p,{x:bus,y:p.y},{x:bus,y:q.y},q];
}
function curve(pts: Point[]): Point[] {
    return Array.from({ length: 49 }, (_, i) => {
        const t = i / 48, u = 1 - t;
        if (pts.length === 3)
            return { x: u * u * pts[0].x + 2 * u * t * pts[1].x + t * t * pts[2].x, y: u * u * pts[0].y + 2 * u * t * pts[1].y + t * t * pts[2].y };
        return { x: u * u * u * pts[0].x + 3 * u * u * t * pts[1].x + 3 * u * t * t * pts[2].x + t * t * t * pts[3].x, y: u * u * u * pts[0].y + 3 * u * u * t * pts[1].y + 3 * u * t * t * pts[2].y + t * t * t * pts[3].y };
    });
}
function ports(r: Rect, pad: number) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    return [{ x: r.x + r.w + pad, y: cy }, { x: cx, y: r.y + r.h + pad }, { x: r.x - pad, y: cy }, { x: cx, y: r.y - pad }];
}
type Side = 0 | 1 | 2 | 3;
type CurvePorts = { from: Point; to: Point; fromSide: Side; toSide: Side };
const normals: Point[] = [{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
function facingSides(a: Rect, b: Rect): Side[] {
    return ([0,1,2,3] as Side[]).filter(s => s===0 ? b.x>=a.x+a.w+8 : s===1 ? b.y>=a.y+a.h+8 : s===2 ? b.x+b.w+8<=a.x : b.y+b.h+8<=a.y);
}
function sidePort(r: Rect, side: Side, pad: number, fraction=.5, shape?: NodeShape): Point {
    const p=side%2 ? {x:r.x+r.w*fraction,y:side===1?r.y+r.h:r.y} : {x:side===0?r.x+r.w:r.x,y:r.y+r.h*fraction};
    return border(r,p,pad,shape);
}
/** One deterministic plan for siblings, independent of edge array/render order. */
function siblingPorts(e: BoardEdge, nodes: BoardNode[], rect: (n:BoardNode)=>Rect, edges: readonly BoardEdge[]): CurvePorts | undefined {
    if(e.kind!=='parentChild' || e.routing==='orthogonal')return;
    const from=nodes.find(n=>n.id===e.from)!;
    const children=edges.filter(o=>o.kind==='parentChild' && o.routing!=='orthogonal' && o.from===e.from)
        .flatMap(o=>{const n=nodes.find(n=>n.id===o.to);return n?[{e:o,n,r:rect(n)}]:[];});
    if(children.length<2)return;
    const rf=rect(from), common=([0,1,2,3] as Side[]).filter(s=>children.every(c=>facingSides(rf,c.r).includes(s)));
    if(!common.length)return;
    // A row favours vertical fan-out; a column favours horizontal fan-out.
    const span=(axis:'x'|'y')=>{const values=children.map(c=>c.r[axis]+(axis==='x'?c.r.w:c.r.h)/2);return Math.max(...values)-Math.min(...values);};
    common.sort((a,b)=>(a%2 ? span('y') : span('x'))-(b%2 ? span('y') : span('x')) || a-b);
    const side=common[0], axis=side%2?'x':'y';
    children.sort((a,b)=>(a.r[axis]+(axis==='x'?a.r.w:a.r.h)/2)-(b.r[axis]+(axis==='x'?b.r.w:b.r.h)/2) || a.e.id.localeCompare(b.e.id));
    const rank=children.findIndex(c=>c.e.id===e.id), child=children[rank], opposite=((side+2)%4) as Side;
    return {from:sidePort(rf,side,2,(rank+1)/(children.length+1),from.shape),to:sidePort(child.r,opposite,6,.5,child.n.shape),fromSide:side,toSide:opposite};
}
function directCurve(p: CurvePorts, strength=.5): {d:string;points:Point[]} {
    const {from:a,to:b}=p, n=normals[p.fromSide], m=normals[p.toSide];
    const reach=Math.max(0,Math.abs(p.fromSide%2 ? b.y-a.y : b.x-a.x)*strength);
    const c={x:a.x+n.x*reach,y:a.y+n.y*reach},d={x:b.x+m.x*reach,y:b.y+m.y*reach};
    return {d:`M ${a.x} ${a.y} C ${c.x} ${c.y}, ${d.x} ${d.y}, ${b.x} ${b.y}`,points:curve([a,c,d,b])};
}
function simplify(points: Point[]): Point[] {
    const out: Point[] = [];
    for (const p of points) {
        if (out.length && out.at(-1)!.x === p.x && out.at(-1)!.y === p.y)
            continue;
        while (out.length >= 2) {
            const a = out.at(-2)!, b = out.at(-1)!;
            if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))
                out.pop();
            else
                break;
        }
        out.push(p);
    }
    return out;
}
/** Orthogonal visibility grid with a bend penalty. No card moves or persisted waypoints. */
function route(rf: Rect, rt: Rect, others: Rect[], gap = CLEARANCE, preferred?: CurvePorts): Point[] | null {
    const obstacles = [rf, rt, ...others].map(r => expand(r, gap));
    const actualStarts=preferred?[preferred.from]:ports(rf,2),actualEnds=preferred?[preferred.to]:ports(rt,6);
    const starts = preferred ? [{x:preferred.from.x+normals[preferred.fromSide].x*gap,y:preferred.from.y+normals[preferred.fromSide].y*gap}] : ports(rf, gap + 2);
    const ends = preferred ? [{x:preferred.to.x+normals[preferred.toSide].x*gap,y:preferred.to.y+normals[preferred.toSide].y*gap}] : ports(rt, gap + 2);
    const xs = [...new Set([...obstacles.flatMap(r => [r.x - 1, r.x + r.w + 1]), ...starts.map(p => p.x), ...ends.map(p => p.x)])].sort((a, b) => a - b);
    const ys = [...new Set([...obstacles.flatMap(r => [r.y - 1, r.y + r.h + 1]), ...starts.map(p => p.y), ...ends.map(p => p.y)])].sort((a, b) => a - b);
    // Bound pathological boards; callers report an unresolved path instead of freezing the UI.
    if (xs.length * ys.length > 90000)
        return null;
    const nx = xs.length, point = (id: number): Point => ({ x: xs[id % nx], y: ys[Math.floor(id / nx)] });
    const index = (p: Point) => ys.indexOf(p.y) * nx + xs.indexOf(p.x);
    const validStarts = starts.map((p, i) => ({ p, i })).filter(({ p, i }) => clear(actualStarts[i], p, [rt, ...others].map(r => expand(r, gap))));
    const validEnds = new Map(ends.map((p, i) => [index(p), i] as const).filter(([, i]) => clear(ends[i], actualEnds[i], [rf, ...others].map(r => expand(r, gap)))));
    const distance = new Map<number, number>(), previous = new Map<number, number>(), startPort = new Map<number, number>();
    type Entry = {
        key: number;
        cost: number;
        score: number;
    };
    const heap: Entry[] = [];
    const push = (e: Entry) => { heap.push(e); let i = heap.length - 1; while (i) {
        const p = (i - 1) >> 1;
        if (heap[p].score <= e.score)
            break;
        heap[i] = heap[p];
        i = p;
    } heap[i] = e; };
    const pop = () => { const root = heap[0], last = heap.pop()!; if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
            let c = i * 2 + 1;
            if (c + 1 < heap.length && heap[c + 1].score < heap[c].score)
                c++;
            if (heap[c].score >= last.score)
                break;
            heap[i] = heap[c];
            i = c;
        }
        heap[i] = last;
    } return root; };
    const heuristic = (p: Point) => Math.min(...ends.map(q => Math.abs(p.x - q.x) + Math.abs(p.y - q.y)));
    for (const { p, i } of validStarts) {
        const key = index(p) * 3;
        distance.set(key, 0);
        startPort.set(key, i);
        push({ key, cost: 0, score: heuristic(p) });
    }
    const checked = new Map<string, boolean>();
    let goal: number | undefined;
    while (heap.length) {
        const current = pop();
        if (distance.get(current.key) !== current.cost)
            continue;
        const id = Math.floor(current.key / 3), dir = current.key % 3, p = point(id), x = id % nx, y = Math.floor(id / nx);
        if (validEnds.has(id)) {
            goal = current.key;
            break;
        }
        for (const [next, axis] of [[x ? id - 1 : -1, 1], [x + 1 < nx ? id + 1 : -1, 1], [y ? id - nx : -1, 2], [y + 1 < ys.length ? id + nx : -1, 2]]) {
            if (next < 0)
                continue;
            const q = point(next), signature = `${Math.min(id, next)}:${Math.max(id, next)}`;
            let pass = checked.get(signature);
            if (pass === undefined) {
                pass = clear(p, q, obstacles);
                checked.set(signature, pass);
            }
            if (!pass)
                continue;
            const cost = current.cost + Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + (dir && dir !== axis ? 28 : 0), key = next * 3 + axis;
            if (cost >= (distance.get(key) ?? Infinity))
                continue;
            distance.set(key, cost);
            previous.set(key, current.key);
            push({ key, cost, score: cost + heuristic(q) });
        }
    }
    if (goal === undefined)
        return null;
    const points: Point[] = [];
    let key = goal;
    while (true) {
        points.push(point(Math.floor(key / 3)));
        const before = previous.get(key);
        if (before === undefined)
            break;
        key = before;
    }
    points.reverse();
    return simplify([actualStarts[startPort.get(key)!], ...points, actualEnds[validEnds.get(Math.floor(goal / 3))!]]);
}
function roundedPath(path: Point[]): {
    d: string;
    points: Point[];
} {
    let d = `M ${path[0].x} ${path[0].y}`;
    const points = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
        const a = path[i - 1], b = path[i], c = path[i + 1], ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), radius = Math.min(6, ab / 2, bc / 2);
        const entry = { x: b.x + (a.x - b.x) * radius / ab, y: b.y + (a.y - b.y) * radius / ab }, exit = { x: b.x + (c.x - b.x) * radius / bc, y: b.y + (c.y - b.y) * radius / bc };
        d += ` L ${entry.x} ${entry.y} Q ${b.x} ${b.y} ${exit.x} ${exit.y}`;
        points.push(entry, ...curve([entry, b, exit]).slice(1));
    }
    const last = path.at(-1)!;
    d += ` L ${last.x} ${last.y}`;
    points.push(last);
    return { d, points };
}
/** Fit inside the routing corridor, rather than interpolating its square corners.
 * Convex Bezier controls cannot overshoot a horizontal/vertical run into a hook. */
function curvedDetour(path: Point[], obstacles: Rect[]): {d:string;points:Point[]} | null {
    // Preserve endpoint normals; shortcut only the interior visibility-grid walk.
    const short=path.slice(0,2);
    for(let i=1;i<path.length-2;){
        let next=i+1;
        for(let j=path.length-2;j>i+1;j--)if(clear(path[i],path[j],obstacles)){next=j;break;}
        short.push(path[next]);i=next;
    }
    short.push(path.at(-1)!);
    // A clamped quadratic B-spline cuts across safe corners with broad arcs.
    // Its controls stay inside the local corridor and its joins share tangents.
    for(const waypoints of [simplify(short),path]){
        let d=`M ${waypoints[0].x} ${waypoints[0].y}`,a=waypoints[0];
        const points=[a];
        for(let i=1;i<waypoints.length-1;i++){
            const c=waypoints[i],next=waypoints[i+1],b=i===waypoints.length-2?next:{x:(c.x+next.x)/2,y:(c.y+next.y)/2};
            const c1={x:a.x+2*(c.x-a.x)/3,y:a.y+2*(c.y-a.y)/3},c2={x:b.x+2*(c.x-b.x)/3,y:b.y+2*(c.y-b.y)/3};
            d+=` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
            points.push(...curve([a,c1,c2,b]).slice(1));a=b;
        }
        if(waypoints.length>2 && points.slice(1).every((p,i)=>clear(points[i],p,obstacles)))return{d,points};
    }
    for(const waypoints of [simplify(short),path])for(const strength of [.48,.3,.12,.03]){
        let d=`M ${waypoints[0].x} ${waypoints[0].y}`, current=waypoints[0];
        const points=[current];
        const append=(a:Point,c1:Point,c2:Point,b:Point)=>{
            if(Math.hypot(b.x-a.x,b.y-a.y)<1e-8)return;
            d+=` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
            points.push(...curve([a,c1,c2,b]).slice(1));current=b;
        };
        const straight=(b:Point)=>{const a=current;append(a,{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},{x:a.x+2*(b.x-a.x)/3,y:a.y+2*(b.y-a.y)/3},b);};
        for(let i=1;i<waypoints.length-1;i++){
            const a=waypoints[i-1],b=waypoints[i],c=waypoints[i+1],ab=Math.hypot(b.x-a.x,b.y-a.y),bc=Math.hypot(c.x-b.x,c.y-b.y);
            const radius=Math.min(ab,bc)*strength;
            if(radius<1e-8)continue;
            const entry={x:b.x+(a.x-b.x)*radius/ab,y:b.y+(a.y-b.y)*radius/ab},exit={x:b.x+(c.x-b.x)*radius/bc,y:b.y+(c.y-b.y)*radius/bc};
            straight(entry);
            append(entry,{x:entry.x+2*(b.x-entry.x)/3,y:entry.y+2*(b.y-entry.y)/3},{x:exit.x+2*(b.x-exit.x)/3,y:exit.y+2*(b.y-exit.y)/3},exit);
        }
        straight(waypoints.at(-1)!);
        if(points.slice(1).every((p,i)=>clear(points[i],p,obstacles)))return{d,points};
    }
    return null;
}
function decorate(g: EdgeGeom, e: BoardEdge, rects: Rect[]): EdgeGeom {
    if (!e.label)
        return g;
    const w = [...e.label].reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 12 : 7), 0) + 8, h = 20;
    const candidates = [g.mid, ...g.points.filter((_, i) => i % 4 === 0), ...g.points.slice(1).map((p, i) => ({ x: (p.x + g.points[i].x) / 2, y: (p.y + g.points[i].y) / 2 }))];
    for (const p of candidates) {
        const box = { x: p.x - w / 2, y: p.y - 21, w, h };
        if (!rects.some(r => box.x < r.x + r.w + 4 && box.x + box.w > r.x - 4 && box.y < r.y + r.h + 4 && box.y + box.h > r.y - 4))
            return { ...g, mid: p, labelBox: box };
    }
    return { ...g, labelBox: { x: g.mid.x - w / 2, y: g.mid.y - 21, w, h } };
}
type Candidate = {g:EdgeGeom;cost:number};
function edgeCandidates(e: BoardEdge, nodes: BoardNode[], heights: Record<string, number>, widths: Record<string, number> | undefined, edges: readonly BoardEdge[]): Candidate[] {
    const rect = (n: BoardNode): Rect => ({ x: n.x, y: n.y, w: widths?.[n.id] ?? n.w, h: heights[n.id] ?? n.h ?? 120 });
    const from = nodes.find(n => n.id === e.from), to = nodes.find(n => n.id === e.to);
    if (!from || !to)
        return [];
    const rf = rect(from), rt = rect(to), a = { x: rf.x + rf.w / 2, y: rf.y + rf.h / 2 }, b = { x: rt.x + rt.w / 2, y: rt.y + rt.h / 2 };
    const reciprocal = e.kind === "association" && e.directed && edges.some(o => o.kind === "association" && o.directed && o.from === e.to && o.to === e.from);
    let fromPt: Point, toPt: Point, points: Point[], d: string;
    if (e.routing === 'orthogonal') {
        const path=simplify(flowPath(from,to,nodes,rect,edges)), rounded=roundedPath(path);
        fromPt=path[0];toPt=path.at(-1)!;points=rounded.points;d=rounded.d;
    }
    else if (reciprocal) {
        const vx = b.x - a.x, vy = b.y - a.y, length = Math.hypot(vx, vy), bend = Math.min(96, Math.max(48, length * .18));
        const c = { x: (a.x + b.x) / 2 + (length ? -vy / length : 0) * bend, y: (a.y + b.y) / 2 + (length ? vx / length : (e.from < e.to ? 1 : -1)) * bend };
        fromPt = border(rf, c, 2, from.shape);
        toPt = border(rt, c, 6, to.shape);
        points = curve([fromPt, c, toPt]);
        d = `M ${fromPt.x} ${fromPt.y} Q ${c.x} ${c.y}, ${toPt.x} ${toPt.y}`;
    }
    else {
        fromPt = border(rf, b, 2, from.shape);
        toPt = border(rt, a, 6, to.shape);
        const control = (r: Rect, p: Point, pad: number) => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2, horizontal = Math.abs(p.x - cx) / (r.w / 2 + pad) >= Math.abs(p.y - cy) / (r.h / 2 + pad), reach = Math.abs(horizontal ? toPt.x - fromPt.x : toPt.y - fromPt.y) / 2; return horizontal ? { x: p.x + Math.sign(p.x - cx) * reach, y: p.y } : { x: p.x, y: p.y + Math.sign(p.y - cy) * reach }; };
        const c1 = control(rf, fromPt, 2), c2 = control(rt, toPt, 6);
        points = curve([fromPt, c1, c2, toPt]);
        d = `M ${fromPt.x} ${fromPt.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${toPt.x} ${toPt.y}`;
    }
    const others = nodes.filter(n => n !== from && n !== to).map(rect), expanded = others.map(r => expand(r, CLEARANCE));
    const preferred=siblingPorts(e,nodes,rect,edges), raw={fromPt,toPt,points,d,routed:false};
    const safe=(g:{points:Point[]})=>g.points.slice(1).every((p,i)=>clear(g.points[i],p,expanded));
    const available: {g:typeof raw;preferred:boolean}[]=[];
    const add=(g:typeof raw,preferred=false)=>{if(safe(g) && !available.some(c=>c.g.d===g.d))available.push({g,preferred});};
    const endpointSafe=(g:{points:Point[]})=>g.points.every(p=>![from,to].some(n=>insideNode(p,n,rect(n))));
    if(e.routing!=='orthogonal' && !reciprocal){
        const choices:CurvePorts[]=[...(preferred?[preferred]:[]),...facingSides(rf,rt).map(side=>({from:sidePort(rf,side,2,.5,from.shape),to:sidePort(rt,((side+2)%4) as Side,6,.5,to.shape),fromSide:side,toSide:((side+2)%4) as Side}))];
        for(const p of choices)for(const strength of [.5,.3]){
            const shape=directCurve(p,strength),g={...shape,fromPt:p.from,toPt:p.to,routed:false};
            if(endpointSafe(g))add(g,p===preferred);
        }
    }
    add(raw);
    if (!available.length || (preferred && !available.some(c=>c.preferred))) {
        const extra=reciprocal && e.from > e.to ? 20 : 0;
        for(const preferredRoute of preferred?[preferred,undefined]:[undefined])for(const gap of e.routing==='orthogonal'?[CLEARANCE+extra]:[48+extra,CLEARANCE+extra]){
            const path=route(rf,rt,others,gap,preferredRoute);
            if(!path)continue;
            const detour=e.routing==='orthogonal'?roundedPath(path):curvedDetour(path,[...expanded,rf,rt]);
            if(!detour)continue;
            add({...detour,fromPt:path[0],toPt:path.at(-1)!,routed:true},!!preferredRoute);
            if(!preferred)break;
        }
    }
    if(!available.length)available.push({g:raw,preferred:false});
    return available.map(candidate=>{
        const g=candidate.g,length=g.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-g.points[i].x,p.y-g.points[i].y),0);
        const direction=normals[preferred?.fromSide ?? facingSides(rf,rt)[0]];
        const retreat=direction ? g.points.slice(1).reduce((sum,p,i)=>sum+Math.max(0,-(p.x-g.points[i].x)*direction.x-(p.y-g.points[i].y)*direction.y),0) : 0;
        const cost=length+retreat*4+(preferred && !candidate.preferred?400:0);
        return {g:decorate(withMidpoint(g),e,nodes.map(rect)),cost};
    }).sort((a,b)=>a.cost-b.cost || a.g.d.localeCompare(b.g.d));
}
function withMidpoint(g:Omit<EdgeGeom,'mid'>):EdgeGeom {
    const {points}=g;
    // Arc-length midpoint also works for detours with unequal segment lengths.
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let remaining = lengths.reduce((s, n) => s + n, 0) / 2, mid = points[0];
    for (let i = 0; i < lengths.length; i++) {
        if (remaining <= lengths[i]) {
            const t = lengths[i] ? remaining / lengths[i] : 0;
            mid = { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
            break;
        }
        remaining -= lengths[i];
    }
    return {...g,mid};
}

function crossing(a:Pick<EdgeGeom,'points'>,b:Pick<EdgeGeom,'points'>,joins:Rect|Rect[]):boolean {
    const inside=(p:Point)=>(Array.isArray(joins)?joins:[joins]).some(join=>p.x>=join.x && p.x<=join.x+join.w && p.y>=join.y && p.y<=join.y+join.h);
    for(let i=1;i<a.points.length;i++)for(let j=1;j<b.points.length;j++){
        const p=a.points[i-1],q=a.points[i],r=b.points[j-1],s=b.points[j];
        if(Math.max(p.x,q.x)<Math.min(r.x,s.x) || Math.max(r.x,s.x)<Math.min(p.x,q.x) || Math.max(p.y,q.y)<Math.min(r.y,s.y) || Math.max(r.y,s.y)<Math.min(p.y,q.y))continue;
        const dx=q.x-p.x,dy=q.y-p.y,ex=s.x-r.x,ey=s.y-r.y,det=dx*ey-dy*ex;
        if(Math.abs(det)<1e-9)continue;
        const t=((r.x-p.x)*ey-(r.y-p.y)*ex)/det,u=((r.x-p.x)*dy-(r.y-p.y)*dx)/det;
        if(t>=0 && t<=1 && u>=0 && u<=1 && !inside({x:p.x+t*dx,y:p.y+t*dy}))return true;
    }
    return false;
}
/** Compute once per scene: all consumers use the same bounded sibling selection. */
export function edgeGeometries(edges:readonly BoardEdge[],nodes:BoardNode[],heights:Record<string,number>,widths?:Record<string,number>):Map<string,EdgeGeom> {
    const choices=new Map(edges.map(e=>[e.id,edgeCandidates(e,nodes,heights,widths,edges)])),selected=new Map<string,Candidate>();
    for(const [id,candidates] of choices)if(candidates.length)selected.set(id,candidates[0]);
    const groups=new Map<string,BoardEdge[]>();
    for(const e of edges)if(e.kind==='parentChild' && e.routing!=='orthogonal' && selected.has(e.id))groups.set(e.from,[...(groups.get(e.from)??[]),e]);
    for(const [id,group] of groups){
        if(group.length<2 || group.length>64)continue;
        group.sort((a,b)=>a.id.localeCompare(b.id));
        const n=nodes.find(n=>n.id===id)!,join=expand({x:n.x,y:n.y,w:widths?.[id]??n.w,h:heights[id]??n.h??120},16);
        // Prefer fewer crossings lexicographically, then the shorter natural path.
        for(let pass=0;pass<2;pass++){
            let changed=false;
            for(const e of group){
                let best=selected.get(e.id)!,bestCross=group.filter(o=>o!==e && crossing(best.g,selected.get(o.id)!.g,join)).length;
                for(const candidate of choices.get(e.id)!){
                    const count=group.filter(o=>o!==e && crossing(candidate.g,selected.get(o.id)!.g,join)).length;
                    if(count<bestCross || (count===bestCross && candidate.cost<best.cost)){best=candidate;bestCross=count;}
                }
                if(best!==selected.get(e.id)){selected.set(e.id,best);changed=true;}
            }
            if(!changed)break;
        }
    }
    const result=new Map([...selected].map(([id,c])=>[id,c.g]));
    const rect=(n:BoardNode):Rect=>({x:n.x,y:n.y,w:widths?.[n.id]??n.w,h:heights[n.id]??n.h??120});
    // Tail decoration is deliberately after route selection: the existing body,
    // sibling order and obstacle corridor are not rescored for arrow appearance.
    for(const e of [...edges].sort((a,b)=>a.id.localeCompare(b.id))){
        const g=result.get(e.id);
        if(!g || !e.directed)continue;
        const endpoints=nodes.filter(n=>n.id===e.from || n.id===e.to),obstacles=nodes.filter(n=>!endpoints.includes(n)).map(n=>expand(rect(n),CLEARANCE));
        const tailArea=expand({x:g.toPt.x,y:g.toPt.y,w:0,h:0},80);
        const peers=edges.filter(o=>o.id!==e.id && result.has(o.id) && result.get(o.id)!.points.slice(1).some((p,i)=>segmentTouchesRect(result.get(o.id)!.points[i],p,tailArea))).map(o=>{
            const joins=endpoints.filter(n=>n.id===o.from || n.id===o.to).map(n=>expand(rect(n),16)),other=result.get(o.id)!;
            return {other,joins,alreadyCrosses:crossing(g,other,joins)};
        });
        const safeTail=(points:Point[])=>points.every(p=>!endpoints.some(n=>insideNode(p,n,rect(n)))) && points.slice(1).every((p,i)=>clear(points[i],p,obstacles)) && !peers.some(p=>!p.alreadyCrosses && crossing({points},p.other,p.joins));
        const terminal=arrowTerminal(g,safeTail,e.routing!=='orthogonal');
        if(e.kind==='association')terminal.strokeD=terminal.d;
        result.set(e.id,decorate(withMidpoint({...g,...terminal,labelBox:undefined}),e,nodes.map(rect)));
    }
    return result;
}
export function edgeGeometry(e:BoardEdge,nodes:BoardNode[],heights:Record<string,number>,widths?:Record<string,number>,edges:readonly BoardEdge[]=[]):EdgeGeom|null {
    return edgeGeometries(edges.some(o=>o.id===e.id)?edges.map(o=>o.id===e.id?e:o):[...edges,e],nodes,heights,widths).get(e.id)??null;
}
