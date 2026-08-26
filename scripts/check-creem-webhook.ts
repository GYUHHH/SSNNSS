import assert from 'node:assert/strict'
import { creemProductFor, creemPurchase } from '../src/creem.ts'

const paid = {
  eventType: 'checkout.completed',
  object: { order: { id: 'ord_1' }, product: { id: 'prod_a' }, metadata: { handle: 'gyuh' } },
}

assert.deepEqual(creemPurchase(paid, 'prod_a'), { eventId: 'creem:ord_1', handle: 'gyuh', quantity: 1 })
assert.deepEqual(creemPurchase(paid, ['prod_regular', 'prod_a']), { eventId: 'creem:ord_1', handle: 'gyuh', quantity: 1 })

// 남의 상품, 다른 이벤트, 위조된 handle, 주문 id 없음 — 전부 크레딧을 주지 않는다
assert.equal(creemPurchase(paid, 'prod_other'), null)
assert.equal(creemPurchase({ ...paid, eventType: 'subscription.paid' }, 'prod_a'), null)
assert.equal(creemPurchase({ ...paid, object: { ...paid.object, metadata: {} } }, 'prod_a'), null)
assert.equal(creemPurchase({ ...paid, object: { ...paid.object, metadata: { handle: '../bad' } } }, 'prod_a'), null)
assert.equal(creemPurchase({ ...paid, object: { ...paid.object, order: {} } }, 'prod_a'), null)

// units는 문서에 확정돼 있지 않다 — 정상 범위만 반영하고 나머지는 1
const units = (value: unknown) => creemPurchase({ ...paid, object: { ...paid.object, order: { id: 'o', units: value as number } } }, 'prod_a')!.quantity
assert.equal(units(3), 3)
assert.equal(units(0), 1)
assert.equal(units(999), 1)
assert.equal(units('two'), 1)

assert.equal(creemProductFor(false, 'regular', 'first'), 'first')
assert.equal(creemProductFor(true, 'regular', 'first'), 'regular')
assert.equal(creemProductFor(false, 'regular', undefined), 'regular')

console.log('Creem webhook contract OK')
