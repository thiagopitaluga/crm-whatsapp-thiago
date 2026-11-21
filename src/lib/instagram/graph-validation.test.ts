import { describe, it, expect } from 'vitest';
import { validateInstagramGraph } from './graph-validation';
const graph = () => ({
  nodes: [
    {
      id: 'trigger',
      position: { x: 0, y: 0 },
      data: {
        kind: 'trigger',
        triggers: [{ type: 'message_keyword', matchMode: 'any' }],
      },
    },
    {
      id: 'message',
      position: { x: 320, y: 0 },
      data: {
        kind: 'message',
        contentBlocks: [{ id: 'text', type: 'text', text: 'Olá' }],
        buttons: [],
      },
    },
  ],
  edges: [{ id: 'edge', source: 'trigger', target: 'message' }],
});
describe('Visual Instagram graph validation', () => {
  it('accepts a complete message flow and a draft without a connected profile', () => {
    expect(() => validateInstagramGraph(graph(), true)).not.toThrow();
  });
  it('rejects automatic cycles instead of sending repeatedly', () => {
    const g = graph();
    g.edges.push({ id: 'loop', source: 'message', target: 'message' });
    expect(() => validateInstagramGraph(g)).toThrow('ciclo');
  });
  it('rejects dangling connections', () => {
    const g = graph();
    g.edges[0].target = 'foreign';
    expect(() => validateInstagramGraph(g)).toThrow('Conexão');
  });
  it('rejects ambiguous parallel output paths', () => {
    const g = graph();
    g.edges.push({ ...g.edges[0], id: 'duplicate' });
    expect(() => validateInstagramGraph(g)).toThrow('uma conexão');
  });
  it('rejects insecure media URLs', () => {
    const g = graph();
    g.nodes[1].data.contentBlocks = [
      { id: 'media', type: 'image', url: 'http://example.com/a.jpg' },
    ] as never;
    expect(() => validateInstagramGraph(g)).toThrow('HTTPS');
  });
  it('requires a real connected destination for a postback button', () => {
    const g = graph();
    g.nodes[1].data.buttons = [
      { id: 'next', text: 'Próximo', type: 'flow' },
    ] as never;
    expect(() => validateInstagramGraph(g, true)).toThrow('Conecte o destino');
  });
  it('preserves the follower trigger as draft but explains why activation is unavailable', () => {
    const g = graph();
    g.nodes[0].data.triggers = [{ type: 'follow_to_dm', matchMode: 'any' }];
    expect(() => validateInstagramGraph(g)).not.toThrow();
    expect(() => validateInstagramGraph(g, true)).toThrow('novo seguidor');
  });
});
