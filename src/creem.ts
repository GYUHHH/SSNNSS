export type CreemEvent = {
  eventType?: string
  object?: {
    order?: { id?: string; units?: number | string }
    product?: { id?: string }
    metadata?: Record<string, unknown>
  }
}

// 첫 구매 할인은 상품을 하나 더 두고 고르는 방식 — Fungies offer와 같은 구조를 product_id로 옮겼다
export const creemProductFor = (hasPurchase: boolean, regularProductId: string, firstProductId?: string) =>
  !hasPurchase && firstProductId ? firstProductId : regularProductId

export function creemPurchase(body: CreemEvent, productId: string | readonly string[], fieldKey = 'handle') {
  if (body.eventType !== 'checkout.completed') return null
  const productIds = typeof productId === 'string' ? [productId] : productId
  const object = body.object
  if (!object?.product?.id || !productIds.includes(object.product.id)) return null
  const handle = object.metadata?.[fieldKey]
  const eventId = object.order?.id
  // units는 문서에 확정돼 있지 않다 — 없거나 이상하면 1로 본다
  const raw = Number(object.order?.units ?? 1)
  const quantity = Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 1
  if (typeof handle !== 'string' || !/^[\w-]{1,64}$/.test(handle) || !eventId) return null
  return { eventId: `creem:${eventId}`, handle, quantity }
}
