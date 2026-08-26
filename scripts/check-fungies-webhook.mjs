import assert from 'node:assert/strict'
import { fungiesOfferFor, fungiesPurchase } from '../src/fungies.ts'

const paid = {
  id: 'event-1', idempotencyKey: 'payment-1', type: 'payment_success',
  data: { items: [{ quantity: 2, offer: { id: 'offer-1' }, customFields: { handle: 'gyuh' } }] },
}

assert.deepEqual(fungiesPurchase(paid, 'offer-1'), { eventId: 'payment-1', handle: 'gyuh', quantity: 2, testMode: false })
assert.deepEqual(fungiesPurchase(paid, ['regular-offer', 'offer-1']), { eventId: 'payment-1', handle: 'gyuh', quantity: 2, testMode: false })
assert.equal(fungiesPurchase(paid, 'another-offer'), null)
assert.equal(fungiesPurchase({ ...paid, type: 'payment_failed' }, 'offer-1'), null)
assert.equal(fungiesPurchase({ ...paid, data: { items: [{ offer: { id: 'offer-1' }, customFields: { handle: '../bad' } }] } }, 'offer-1'), null)
assert.equal(fungiesOfferFor(false, 'regular', 'first'), 'first')
assert.equal(fungiesOfferFor(true, 'regular', 'first'), 'regular')

console.log('Fungies webhook contract OK')
