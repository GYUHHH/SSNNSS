// Video clips are far too big for localStorage (a few MB blows the whole quota and would take the room layout
// down with it), so they live in IndexedDB as blobs keyed by the frame's furniture id.
const dbName = 'my-room-media'
const storeName = 'videos'

const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(dbName, 1)
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName) }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> => {
  try {
    const db = await open()
    return await new Promise<T | null>((resolve, reject) => {
      const request = action(db.transaction(storeName, mode).objectStore(storeName))
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  } catch { return null }
}

export const putVideo = (id: string, blob: Blob) => run('readwrite', (store) => store.put(blob, id))
export const getVideo = (id: string) => run<Blob>('readonly', (store) => store.get(id) as IDBRequest<Blob>)
export const deleteVideo = (id: string) => run('readwrite', (store) => store.delete(id))
export const listVideoIds = async () => (await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())) as string[] | null
