import { useSyncExternalStore } from 'react'

let firstPerson = false
const listeners = new Set<() => void>()
const zoomListeners = new Set<(direction: 'in' | 'out') => void>()
export const setFirstPerson = (value: boolean) => { if (firstPerson === value) return; firstPerson = value; listeners.forEach((listener) => listener()) }
export const isFirstPerson = () => firstPerson
export const toggleFirstPerson = () => setFirstPerson(!firstPerson)
export const useFirstPerson = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => firstPerson, () => false)
export const requestFirstPersonZoom = (direction: 'in' | 'out') => zoomListeners.forEach((listener) => listener(direction))
export const onFirstPersonZoom = (listener: (direction: 'in' | 'out') => void) => { zoomListeners.add(listener); return () => zoomListeners.delete(listener) }
