import { useEffect, useState } from 'react'
import { type FurnitureItem, initialFurniture, inventoryItems, type InventoryCategory, useRoomStore } from '../store'
import { thumbnailFor } from '../services/thumbnails'
import { colorPresets, customizableTypes, floorStyleOf, floorStyles, wallStylePresets } from '../services/styles'

function ItemIcon({ item }: { item: { type: string; styleId?: string } }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { let live = true; const wallId = (item as FurnitureItem).allowedSurfaces?.includes('wall') ? 'leftWall' as const : undefined; thumbnailFor({ ...item, wallId } as FurnitureItem).then((url) => { if (live) setSrc(url) }); return () => { live = false } }, [item.type, item.styleId])
  return src ? <img className="inventory-icon thumb" src={src} alt="" /> : <i className={`inventory-icon ${item.type}`} />
}

const categories: InventoryCategory[] = ['전체', '가구', '조명', '식물', '벽장식', '소품']
const categoryFor = (type: string): InventoryCategory => ({ 'side-table': '가구', 'music-player': '가구', 'floor-lamp': '조명', 'potted-plant': '소품', 'wall-art': '벽장식', 'wall-art-3': '벽장식', 'wall-art-4': '벽장식', 'wall-art-5': '벽장식', 'animated-poster': '벽장식', window: '벽장식', banner: '벽장식', 'cd-player': '벽장식', 'profile-board': '벽장식', 'video-frame-3': '벽장식', 'video-frame-4': '벽장식', 'video-frame-5': '벽장식', guestbook: '벽장식', 'string-lights': '조명', calendar: '벽장식', 'christmas-tree': '식물', 'record-player': '가구', whiteboard: '가구', 'easel-photo': '가구', 'rocking-chair': '가구', beanbag: '가구', 'mini-fridge': '가구', hanger: '가구', 'star-projector': '소품', 'led-lamp': '소품', curtain: '벽장식', fireplace: '가구', 'coffee-table': '가구', 'glass-shelf': '가구', tv: '가구', wardrobe: '가구', mirror: '가구', 'fish-tank': '소품', candle: '소품', 'wall-shelf': '벽장식', vase: '소품', cushion: '소품', plush: '소품', mug: '소품', 'book-prop': '소품', speaker: '소품', 'photo-frame': '벽장식', 'photo-frame-2': '벽장식', 'photo-frame-3': '벽장식', 'photo-frame-4': '벽장식', 'photo-frame-5': '벽장식', bed: '가구', sofa: '가구', desk: '가구', chair: '가구', bookshelf: '가구', cabinet: '가구', rug: '가구', lamp: '조명', plant: '식물', clock: '벽장식', poster: '벽장식', photo: '벽장식', computer: '소품', cup: '소품' } as Record<string, InventoryCategory>)[type] ?? '가구'

// everything a room can hold: the catalogue plus the movable pieces the room ships with
const OWNABLE: Array<{ type: string; name: string; size: [number, number]; footprint: FurnitureItem['footprint']; allowedSurfaces: FurnitureItem['allowedSurfaces']; styleId?: string }> = [...inventoryItems, ...initialFurniture.filter((item) => item.movable)]
  .filter((entry, index, all) => all.findIndex((other) => other.type === entry.type) === index)
  .map((entry) => ({ type: entry.type, name: entry.name, size: entry.size, footprint: entry.footprint, allowedSurfaces: entry.allowedSurfaces }))
// the white line: the same furniture pre-tinted white, offered as its own catalog entries
const WHITE_LINE = OWNABLE.filter((entry) => customizableTypes.has(entry.type)).map((entry) => ({ ...entry, styleId: 'white', name: `화이트 ${entry.name}` }))
const CATALOG = [...OWNABLE, ...WHITE_LINE]

// wall and floor recolors live in the inventory now — clicking the room surfaces no longer opens a picker
function RoomColorEditor() {
  const { wallStyle, floorStyle, setWallStyle, setFloorStyle } = useRoomStore()
  const wallSwatches = colorPresets.filter((preset) => (wallStylePresets as readonly string[]).includes(preset.id))
  return <div className="room-colors">
    {([['leftWall', '왼쪽 벽'], ['rightWall', '오른쪽 벽']] as const).map(([wallId, label]) => <div key={wallId} className="room-color-row"><span>{label}</span>
      <div className="style-swatches">{wallSwatches.map((preset) => <button key={preset.id} type="button" title={preset.label} className={wallStyle[wallId] === preset.id ? 'active' : ''} style={{ background: preset.color }} onClick={() => setWallStyle(wallId, preset.id)} />)}</div>
    </div>)}
    <div className="room-color-row"><span>바닥</span>
      <div className="style-swatches">{floorStyles.map((style) => <button key={style.id} type="button" title={style.label} className={floorStyleOf(floorStyle).id === style.id ? 'active' : ''} style={{ background: style.color }} onClick={() => setFloorStyle(style.id)} />)}</div>
    </div>
  </div>
}

export default function InventoryPanel() {
  const [category, setCategory] = useState<InventoryCategory>('전체')
  const { startPreview, preview, previewValid, placePreview, cancelPreview, availableCount } = useRoomStore()
  // only what you still own and have not put down somewhere — placing one takes it off this list
  const stock = CATALOG.filter((entry) => availableCount(entry.type) > 0 && (category === '전체' || categoryFor(entry.type) === category))
  return <section className={preview ? 'inventory-panel previewing' : 'inventory-panel'} aria-label="가구함">
    <header><strong>가구함</strong>{preview && <button type="button" onClick={cancelPreview}>미리보기 취소</button>}</header>
    <nav>{categories.map((entry) => <button key={entry} className={category === entry ? 'active' : ''} type="button" onClick={() => setCategory(entry)}>{entry}</button>)}</nav>
    <div className="inventory-items">
      {stock.length === 0 && <p className="inventory-empty">남은 가구가 없어요. 방에 놓인 가구를 정리하면 다시 꺼낼 수 있어요.</p>}
      {stock.map((entry) => <button key={`${entry.type}:${entry.styleId ?? ''}`} type="button" onClick={() => startPreview(entry.type, entry.styleId)}><ItemIcon item={entry as FurnitureItem} /><span>{entry.name}<small>{entry.footprint.width ? `${entry.size[0]} × ${entry.size[1]}` : '벽'}</small></span></button>)}
    </div>
    <RoomColorEditor />
    {preview && <footer><span className={previewValid ? 'valid' : 'invalid'}>{previewValid ? '배치 가능한 위치' : '이 위치에는 배치할 수 없어요'}</span><button type="button" disabled={!previewValid} onClick={placePreview}>배치</button></footer>}
  </section>
}
