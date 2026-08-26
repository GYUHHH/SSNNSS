export type FungiesEvent = {
  id?: string
  idempotencyKey?: string
  type?: string
  testMode?: boolean
  data?: { items?: Array<{ quantity?: number | string; offer?: { id?: string }; customFields?: Record<string, unknown> }> }
}

export const fungiesOfferFor = (hasPurchase: boolean, regularOfferId: string, firstOfferId?: string) =>
  !hasPurchase && firstOfferId ? firstOfferId : regularOfferId

export function fungiesPurchase(body: FungiesEvent, offerId: string | readonly string[], fieldKey = 'handle') {
  if (body.type !== 'payment_success') return null
  const offerIds = typeof offerId === 'string' ? [offerId] : offerId
  const item = body.data?.items?.find((value) => !!value.offer?.id && offerIds.includes(value.offer.id))
  const handle = item?.customFields?.[fieldKey]
  const eventId = body.idempotencyKey || body.id
  const quantity = Number(item?.quantity ?? 1)
  if (typeof handle !== 'string' || !/^[\w-]{1,64}$/.test(handle) || !eventId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null
  return { eventId, handle, quantity, testMode: body.testMode === true }
}
