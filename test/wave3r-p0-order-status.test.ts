/**
 * Wave 3R Mission 2 / Phase 0 — P0.2 Atlas order-status normalization.
 *
 * Permanently pins: the OBSERVED provider order state dominates order
 * normalization. Ticket references are reconciliation data, never a
 * standalone TICKETED inference; a ticketed-then-cancelled order must be
 * representable (CANCELLED with ticket refs preserved).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeOrderDetails } from '../src/providers/atlas/transactionAdapter.ts';

const TICKETED_WITH_TICKETS = {
  status: 0,
  orderNo: 'ORD-1',
  orderStatus: '2',
  ticketStatus: '1',
  paxTicketInfos: [{ ticketNos: ['999-1111111111'] }],
  totalPrice: 210,
  currency: 'USD',
};

test('P0.2: observed orderStatus dominates normalization (0/1/2/-3)', () => {
  const held = normalizeOrderDetails({ ...TICKETED_WITH_TICKETS, orderStatus: '0', ticketStatus: '0', paxTicketInfos: [] }, 'ORD-1', 'LIVE');
  assert.equal(held.status, 'HELD');

  const paid = normalizeOrderDetails({ ...TICKETED_WITH_TICKETS, orderStatus: '1', ticketStatus: '0', paxTicketInfos: [] }, 'ORD-1', 'LIVE');
  assert.equal(paid.status, 'PAID');

  const ticketed = normalizeOrderDetails(TICKETED_WITH_TICKETS, 'ORD-1', 'LIVE');
  assert.equal(ticketed.status, 'TICKETED');
  assert.deepEqual(ticketed.transactionState?.ticketRefs, ['999-1111111111']);

  const cancelled = normalizeOrderDetails({ ...TICKETED_WITH_TICKETS, orderStatus: '-3' }, 'ORD-1', 'LIVE');
  assert.equal(cancelled.status, 'CANCELLED');
});

test('P0.2: ticket references alone never infer TICKETED', () => {
  // Ticket numbers present but the provider reports NO ticketed order state:
  // the observation stays honest (UNKNOWN here), never promoted to TICKETED.
  const noOrderState = normalizeOrderDetails(
    { status: 0, orderNo: 'ORD-2', paxTicketInfos: [{ ticketNos: ['999-2222222222'] }] },
    'ORD-2',
    'LIVE',
  );
  assert.equal(noOrderState.status, 'UNKNOWN');
  // The refs remain available as reconciliation data.
  assert.deepEqual(noOrderState.transactionState?.ticketRefs, ['999-2222222222']);
});

test('P0.2: ticketed-then-cancelled is representable — CANCELLED with ticket refs preserved', () => {
  const view = normalizeOrderDetails(
    { ...TICKETED_WITH_TICKETS, orderStatus: '-3', ticketStatus: '1' },
    'ORD-3',
    'LIVE',
  );
  assert.equal(view.status, 'CANCELLED', 'observed cancelled state dominates issued ticket refs');
  assert.deepEqual(
    view.transactionState?.ticketRefs,
    ['999-1111111111'],
    'issued ticket references are preserved for reconciliation',
  );
  assert.match(view.detail ?? '', /cancelled/i);
});

test('P0.2: unmapped order status remains UNKNOWN (fail honest)', () => {
  const view = normalizeOrderDetails({ ...TICKETED_WITH_TICKETS, orderStatus: '9' }, 'ORD-4', 'LIVE');
  assert.equal(view.status, 'UNKNOWN');
  assert.match(view.detail ?? '', /unmapped provider order status 9/);
});
