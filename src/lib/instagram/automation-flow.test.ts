import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  composePrivateReply,
  resolveFlowPlan,
  triggerTextMatchScore,
} from './automation-flow';

const graph = JSON.stringify({
  nodes: [
    { id: 'trigger', data: { kind: 'trigger' } },
    {
      id: 'intro',
      data: {
        kind: 'message',
        text: 'Introducao',
        contentBlocks: [{ type: 'text', text: 'Introducao' }],
      },
    },
    {
      id: 'condition',
      data: { kind: 'condition', condition: 'follows_profile' },
    },
    {
      id: 'yes',
      data: {
        kind: 'message',
        contentBlocks: [{ type: 'text', text: 'Aqui esta o link' }],
        buttons: [{ text: 'Acessar', url: 'https://example.com' }],
      },
    },
    {
      id: 'no',
      data: {
        kind: 'message',
        contentBlocks: [{ type: 'text', text: 'Siga o perfil' }],
        buttons: [
          { text: 'Visitar perfil', url: 'https://instagram.com/example' },
        ],
      },
    },
    { id: 'delay', data: { kind: 'delay', seconds: 5 } },
  ],
  edges: [
    { source: 'trigger', target: 'intro' },
    { source: 'intro', target: 'condition' },
    { source: 'condition', sourceHandle: 'true', target: 'yes' },
    { source: 'condition', sourceHandle: 'false', target: 'no' },
    { source: 'no', target: 'delay' },
    { source: 'delay', target: 'yes' },
  ],
});

test('keeps buttons attached only to their message', () => {
  const plan = resolveFlowPlan(graph, {
    custom_fields: JSON.stringify({ followsProfile: true }),
  });

  assert.deepEqual(plan.steps, [
    {
      type: 'content',
      content: { type: 'text', text: 'Introducao' },
      buttons: [],
    },
    {
      type: 'content',
      content: { type: 'text', text: 'Aqui esta o link' },
      buttons: [{ text: 'Acessar', url: 'https://example.com' }],
    },
  ]);
});

test('follows the false condition branch and preserves standalone delays', () => {
  const plan = resolveFlowPlan(graph, {
    custom_fields: JSON.stringify({ followsProfile: false }),
  });

  assert.equal(plan.steps[1].type, 'content');
  assert.deepEqual(plan.steps[2], { type: 'delay', seconds: 5 });
  assert.equal(plan.steps[3].type, 'content');
});

test('composes a single private comment reply and stops at a delay', () => {
  const plan = resolveFlowPlan(graph, {
    custom_fields: JSON.stringify({ followsProfile: false }),
  });

  assert.equal(
    composePrivateReply(plan, 'Fallback'),
    'Introducao\n\nSiga o perfil\n\nVisitar perfil: https://instagram.com/example'
  );
});

test('prefers an exact longer keyword over a contained keyword', () => {
  assert.ok(
    triggerTextMatchScore(
      { type: 'comment_keyword', matchMode: 'keywords', keywords: 'kimi2' },
      'kimi2'
    ) >
      triggerTextMatchScore(
        { type: 'comment_keyword', matchMode: 'keywords', keywords: 'kimi' },
        'kimi2'
      )
  );
});

test('resolves a button branch only after its target is selected', () => {
  const buttonGraph = JSON.stringify({
    nodes: [
      { id: 'trigger', data: { kind: 'trigger' } },
      {
        id: 'question',
        data: {
          kind: 'message',
          contentBlocks: [{ type: 'text', text: 'Escolha' }],
          buttons: [{ id: 'details', text: 'Detalhes', type: 'flow' }],
        },
      },
      { id: 'details-node', data: { kind: 'message', text: 'Mais detalhes' } },
    ],
    edges: [
      { source: 'trigger', target: 'question' },
      {
        source: 'question',
        sourceHandle: 'button:details',
        target: 'details-node',
      },
    ],
  });

  const initial = resolveFlowPlan(buttonGraph, null);
  assert.equal(initial.steps.length, 1);
  assert.equal(
    initial.steps[0].type === 'content' &&
      initial.steps[0].buttons[0].targetNodeId,
    'details-node'
  );

  const branch = resolveFlowPlan(buttonGraph, null, Date.now(), 'details-node');
  assert.equal(
    branch.steps[0].type === 'content' && branch.steps[0].content.text,
    'Mais detalhes'
  );
});
