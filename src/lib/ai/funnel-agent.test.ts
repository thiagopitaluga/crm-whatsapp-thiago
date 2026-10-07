import { describe, expect, it } from 'vitest'

import { isExplicitActionRequest, parseFunnelAction } from './funnel-agent'

describe('funnel action guard', () => {
  it.each([
    'Mova o negócio da Maria para Proposta.',
    'Pode atribuir esse lead ao Edi?',
    'Quero que crie uma tarefa para amanhã.',
  ])('accepts an explicit request: %s', (message) => {
    expect(isExplicitActionRequest(message)).toBe(true)
  })

  it.each([
    'Não mova esse negócio.',
    'Não quero que crie uma tarefa.',
    'Como mover um negócio?',
    'É possível atribuir um lead?',
    'Quais negócios estão sem responsável?',
  ])('does not execute a negation or informational question: %s', (message) => {
    expect(isExplicitActionRequest(message)).toBe(false)
  })

  it('rejects a malformed action payload', () => {
    expect(parseFunnelAction({ type: 'move_deal', deal_id: '', stage_id: 'stage' })).toBeNull()
    expect(parseFunnelAction({ type: 'move_deal', deal_id: 'not-a-uuid', stage_id: 'also-not-a-uuid' })).toBeNull()
  })
})
