import { expect, it } from 'vitest';
import { edgeGeometry, segmentTouchesRect } from './edgeRouting';
import type { BoardEdge, BoardNode } from './types';
const card = (id: string, x: number, y: number, w = 100, h = 70): BoardNode => ({ id, type: 'text', markdown: id, x, y, w, h });
const edge: BoardEdge = { id: 'e_route01', kind: 'association', from: 'n_route01', to: 'n_route02', directed: true };
it('routes around a card between endpoints without changing nodes or relations', () => {
    const nodes = [card(edge.from, 0, 0), card(edge.to, 500, 0), card('n_block01', 240, -40, 120, 150)];
    const before = structuredClone(nodes), g = edgeGeometry(edge, nodes, {})!;
    expect(g.routed).toBe(true);
    const obstacle = { x: 230, y: -50, w: 140, h: 170 };
    expect(g.points.slice(1).some((p, i) => segmentTouchesRect(g.points[i], p, obstacle))).toBe(false);
    expect(nodes).toEqual(before);
    expect(edgeGeometry(edge, nodes, {})!.d).toBe(g.d);
});
it('uses visible caption dimensions and updates the route when an obstacle moves', () => {
    const nodes = [card(edge.from, 0, 0), card(edge.to, 500, 0), card('n_block01', 200, 90)];
    expect(edgeGeometry(edge, nodes, {})!.routed).toBe(false);
    expect(edgeGeometry(edge, nodes, { n_block01: 220 }, { n_block01: 260 })!.routed).toBe(false);
    nodes[2].y = -50;
    const g = edgeGeometry(edge, nodes, { n_block01: 220 }, { n_block01: 260 })!;
    expect(g.routed).toBe(true);
    expect(g.points.slice(1).some((p, i) => segmentTouchesRect(g.points[i], p, { x: 190, y: -60, w: 280, h: 240 }))).toBe(false);
});
it('keeps an unobstructed curve and finds space for a relationship label', () => {
    const nodes = [card(edge.from, 0, 0), card(edge.to, 500, 0), card('n_block01', 240, -40, 120, 150)];
    const g = edgeGeometry({ ...edge, label: '依赖' }, nodes, {})!;
    expect(g.labelBox).toBeDefined();
    const l = g.labelBox!;
    expect(nodes.some(n => l.x < n.x + n.w && l.x + l.w > n.x && l.y < n.y + n.h! && l.y + l.h > n.y)).toBe(false);
    expect(edgeGeometry(edge, nodes.slice(0, 2), {})!.d).toContain(' C ');
});
it('handles negative coordinates and multiple blockers', () => {
    const nodes = [card(edge.from, -600, -300), card(edge.to, 400, 300), card('n_block01', -350, -250, 220, 400), card('n_block02', 0, -80, 250, 450)];
    const g = edgeGeometry(edge, nodes, {})!;
    expect(g.routed).toBe(true);
    for (const n of nodes.slice(2))
        expect(g.points.slice(1).some((p, i) => segmentTouchesRect(g.points[i], p, { x: n.x - 10, y: n.y - 10, w: n.w + 20, h: n.h! + 20 }))).toBe(false);
});
