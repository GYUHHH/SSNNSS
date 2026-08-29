import { useSyncExternalStore } from 'react'

export type VisitorLook = { skinColor?: string; hairColor?: string; topColor?: string; bottomColor?: string; shoeColor?: string }
export type VisitorPresence = {
  sessionId: string
  handle: string
  appearance: VisitorLook
  position: [number, number, number]
  facing: number
  state: 'idle'
}

const SESSION_KEY = 'dens-presence-session'
export const presenceSessionId = (() => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id) }
    return id
  } catch { return crypto.randomUUID() }
})()

let visitors: VisitorPresence[] = []
const listeners = new Set<() => void>()
export const publishVisitors = (next: VisitorPresence[]) => {
  visitors = next.filter((visitor, index) => visitor?.sessionId && visitor?.handle && next.findIndex((value) => value.sessionId === visitor.sessionId) === index)
  listeners.forEach((listener) => listener())
}
export const publishVisitor = (next: VisitorPresence) => publishVisitors([...visitors.filter((visitor) => visitor.sessionId !== next.sessionId), next])
export const useVisitors = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => visitors, () => visitors)
export const selfVisitor = () => visitors.find((visitor) => visitor.sessionId === presenceSessionId) ?? null

const hash = (value: string) => [...value].reduce((total, letter) => (total * 31 + letter.charCodeAt(0)) >>> 0, 0)
export const visitorSpawn = (sessionId: string): [number, number, number] => {
  const slot = hash(sessionId) % 8
  return [-2.45 + (slot % 4) * 1.4, 0, 1.75 + Math.floor(slot / 4) * .7]
}

export const visitorPosition: [number, number, number] = visitorSpawn(presenceSessionId)
export const visitorFacing = { current: Math.PI }
export const visitorMoveTarget = { current: null as [number, number, number] | null }
export const requestVisitorMove = (position: [number, number, number]) => { visitorMoveTarget.current = position }
export const resetVisitorTransform = () => {
  visitorPosition.splice(0, 3, ...visitorSpawn(presenceSessionId)); visitorFacing.current = Math.PI; visitorMoveTarget.current = null
}
