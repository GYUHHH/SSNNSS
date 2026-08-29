import { useSyncExternalStore } from 'react'

let firstPerson = false
const listeners = new Set<() => void>()
export const setFirstPerson = (value: boolean) => { if (firstPerson === value) return; firstPerson = value; listeners.forEach((listener) => listener()) }
export const toggleFirstPerson = () => setFirstPerson(!firstPerson)
export const useFirstPerson = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => firstPerson, () => false)

