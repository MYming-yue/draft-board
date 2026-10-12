import type { BoardEdge, BoardNode } from "./types";
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
function border(r: Rect, p: Point, pad: number): Point {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = p.x - cx, dy = p.y - cy;
    if (!dx && !dy)
        return { x: cx, y: cy };
    const s = Math.min(dx ? (r.w / 2 + pad) / Math.abs(dx) : Infinity, dy ? (r.h / 2 + pad) / Math.abs(dy) : Infinity);
    return { x: cx + dx * s, y: cy + dy * s };
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
function route(rf: Rect, rt: Rect, others: Rect[], gap = CLEARANCE): Point[] | null {
    const obstacles = [rf, rt, ...others].map(r => expand(r, gap));
    const starts = ports(rf, gap + 2), ends = ports(rt, gap + 2);
    const xs = [...new Set([...obstacles.flatMap(r => [r.x - 1, r.x + r.w + 1]), ...starts.map(p => p.x), ...ends.map(p => p.x)])].sort((a, b) => a - b);
    const ys = [...new Set([...obstacles.flatMap(r => [r.y - 1, r.y + r.h + 1]), ...starts.map(p => p.y), ...ends.map(p => p.y)])].sort((a, b) => a - b);
    // Bound pathological boards; callers report an unresolved path instead of freezing the UI.
    if (xs.length * ys.length > 90000)
        return null;
    const nx = xs.length, point = (id: number): Point => ({ x: xs[id % nx], y: ys[Math.floor(id / nx)] });
    const index = (p: Point) => ys.indexOf(p.y) * nx + xs.indexOf(p.x);
    const validStarts = starts.map((p, i) => ({ p, i })).filter(({ p, i }) => clear(ports(rf, 2)[i], p, [rt, ...others].map(r => expand(r, gap))));
    const validEnds = new Map(ends.map((p, i) => [index(p), i] as const).filter(([, i]) => clear(ends[i], ports(rt, 6)[i], [rf, ...others].map(r => expand(r, gap)))));
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
    return simplify([ports(rf, 2)[startPort.get(key)!], ...points, ports(rt, 6)[validEnds.get(Math.floor(goal / 3))!]]);
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
export function edgeGeometry(e: BoardEdge, nodes: BoardNode[], heights: Record<string, number>, widths?: Record<string, number>, edges: readonly BoardEdge[] = []): EdgeGeom | null {
    const rect = (n: BoardNode): Rect => ({ x: n.x, y: n.y, w: widths?.[n.id] ?? n.w, h: heights[n.id] ?? n.h ?? 120 });
    const from = nodes.find(n => n.id === e.from), to = nodes.find(n => n.id === e.to);
    if (!from || !to)
        return null;
    const rf = rect(from), rt = rect(to), a = { x: rf.x + rf.w / 2, y: rf.y + rf.h / 2 }, b = { x: rt.x + rt.w / 2, y: rt.y + rt.h / 2 };
    const reciprocal = e.kind === "association" && e.directed && edges.some(o => o.kind === "association" && o.directed && o.from === e.to && o.to === e.from);
    let fromPt: Point, toPt: Point, points: Point[], d: string;
    if (reciprocal) {
        const vx = b.x - a.x, vy = b.y - a.y, length = Math.hypot(vx, vy), bend = Math.min(96, Math.max(48, length * .18));
        const c = { x: (a.x + b.x) / 2 + (length ? -vy / length : 0) * bend, y: (a.y + b.y) / 2 + (length ? vx / length : (e.from < e.to ? 1 : -1)) * bend };
        fromPt = border(rf, c, 2);
        toPt = border(rt, c, 6);
        points = curve([fromPt, c, toPt]);
        d = `M ${fromPt.x} ${fromPt.y} Q ${c.x} ${c.y}, ${toPt.x} ${toPt.y}`;
    }
    else {
        fromPt = border(rf, b, 2);
        toPt = border(rt, a, 6);
        const control = (r: Rect, p: Point, pad: number) => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2, horizontal = Math.abs(p.x - cx) / (r.w / 2 + pad) >= Math.abs(p.y - cy) / (r.h / 2 + pad), reach = Math.abs(horizontal ? toPt.x - fromPt.x : toPt.y - fromPt.y) / 2; return horizontal ? { x: p.x + Math.sign(p.x - cx) * reach, y: p.y } : { x: p.x, y: p.y + Math.sign(p.y - cy) * reach }; };
        const c1 = control(rf, fromPt, 2), c2 = control(rt, toPt, 6);
        points = curve([fromPt, c1, c2, toPt]);
        d = `M ${fromPt.x} ${fromPt.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${toPt.x} ${toPt.y}`;
    }
    const others = nodes.filter(n => n !== from && n !== to).map(rect), expanded = others.map(r => expand(r, CLEARANCE));
    let routed = false;
    if (points.slice(1).some((p, i) => !clear(points[i], p, expanded))) {
        const path = route(rf, rt, others, reciprocal && e.from > e.to ? 32 : CLEARANCE);
        if (path) {
            const rounded = roundedPath(path);
            points = rounded.points;
            fromPt = path[0];
            toPt = path.at(-1)!;
            d = rounded.d;
            routed = true;
        }
    }
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
    return decorate({ fromPt, toPt, mid, d, points, routed }, e, nodes.map(rect));
}
