import { useEffect, useState } from 'react'
import { type FurnitureItem, initialFurniture, inventoryItems, type InventoryCategory, useRoomStore } from '../store'
import { thumbnailFor } from '../services/thumbnails'
import { colorPresets, customizableTypes, floorStyleOf, floorStyles, wallStylePresets } from '../services/styles'
import { DEFAULT_APPEARANCE as CHARACTER_DEFAULTS } from './Character'

function ItemIcon({ item }: { item: { type: string; styleId?: string } }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { let live = true; const wallId = (item as FurnitureItem).allowedSurfaces?.includes('wall') ? 'leftWall' as const : undefined; thumbnailFor({ ...item, wallId } as FurnitureItem).then((url) => { if (live) setSrc(url) }); return () => { live = false } }, [item.type, item.styleId])
  return src ? <img className="inventory-icon thumb" src={src} alt="" /> : <i className={`inventory-icon ${item.type}`} />
}

const categories: InventoryCategory[] = ['전체', '가구', '조명', '식물', '벽장식', '소품']
// The wall and floor pickers get a tab of their own rather than sitting under every item list. Kept out of
// InventoryCategory because that type is what filters the catalogue, and this tab shows no items at all.
const COLOR_TAB = '색상'
const CHARACTER_TAB = '캐릭터'
const tabs = [...categories, CHARACTER_TAB, COLOR_TAB] as const
const categoryFor = (type: string): InventoryCategory => ({ 'side-table': '가구', 'music-player': '가구', 'floor-lamp': '조명', 'potted-plant': '소품', 'wall-art': '벽장식', 'wall-art-3': '벽장식', 'wall-art-4': '벽장식', 'wall-art-5': '벽장식', 'animated-poster': '벽장식', window: '벽장식', banner: '벽장식', 'cd-player': '벽장식', 'profile-board': '벽장식', 'video-frame-3': '벽장식', 'video-frame-4': '벽장식', 'video-frame-5': '벽장식', guestbook: '벽장식', 'string-lights': '조명', 'wall-sconce-2': '조명', calendar: '벽장식', 'christmas-tree': '식물', 'record-player': '가구', whiteboard: '가구', 'easel-photo': '가구', 'rocking-chair': '가구', beanbag: '가구', 'mini-fridge': '가구', hanger: '가구', 'star-projector': '소품', 'led-lamp': '소품', curtain: '벽장식', fireplace: '가구', 'coffee-table': '가구', 'glass-shelf': '가구', tv: '가구', wardrobe: '가구', 'fish-tank': '소품', candle: '소품', 'wall-shelf': '벽장식', vase: '소품', cushion: '소품', plush: '소품', mug: '소품', 'book-prop': '소품', speaker: '소품', 'photo-frame': '벽장식', 'photo-frame-2': '벽장식', 'photo-frame-3': '벽장식', 'photo-frame-4': '벽장식', 'photo-frame-5': '벽장식', bed: '가구', sofa: '가구', desk: '가구', chair: '가구', bookshelf: '가구', cabinet: '가구', rug: '가구', lamp: '조명', plant: '식물', clock: '벽장식', poster: '벽장식', photo: '벽장식', computer: '소품', cup: '소품' } as Record<string, InventoryCategory>)[type] ?? '가구'

// everything a room can hold: the catalogue plus the movable pieces the room ships with
const OWNABLE: Array<{ type: string; name: string; size: [number, number]; footprint: FurnitureItem['footprint']; allowedSurfaces: FurnitureItem['allowedSurfaces']; styleId?: string }> = [...inventoryItems, ...initialFurniture.filter((item) => item.movable)]
  .filter((entry, index, all) => all.findIndex((other) => other.type === entry.type) === index)
  .map((entry) => ({ type: entry.type, name: entry.name, size: entry.size, footprint: entry.footprint, allowedSurfaces: entry.allowedSurfaces }))
// the white line: the same furniture pre-tinted white, offered as its own catalog entries
const WHITE_LINE = OWNABLE.filter((entry) => customizableTypes.has(entry.type)).map((entry) => ({ ...entry, styleId: 'white', name: `화이트 ${entry.name}` }))
const CATALOG = [...OWNABLE, ...WHITE_LINE]

// The character's look editor: five parts, each with its own swatch row. Skin and hair carry their own
// palettes (the shared furniture presets read wrong on a face); clothes and shoes reuse the room presets so the
// character can match the furniture. Changes save and publish exactly like recoloring a wall does.
const SKIN_TONES = ['#f4d9c0', '#ecc9a8', '#dfa27f', '#c98a63', '#a96c47', '#7d4f33']
const HAIR_TONES = ['#2b2320', '#5a4035', '#8a6a52', '#b78c5a', '#d9b380', '#b55239', '#8a3d2e', '#7d8a93', '#e8e3da']
const LOOK_ROWS = [
  ['skinColor', '피부', SKIN_TONES],
  ['hairColor', '머리', HAIR_TONES],
  ['topColor', '상의', colorPresets.map((preset) => preset.color)],
  ['bottomColor', '하의', colorPresets.map((preset) => preset.color)],
  ['shoeColor', '신발', colorPresets.map((preset) => preset.color)],
] as const
function CharacterLookEditor() {
  const { characterLook, setCharacterLook } = useRoomStore()
  const current = { ...CHARACTER_DEFAULTS, ...characterLook }
  return <div className="room-colors">
    {LOOK_ROWS.map(([part, label, palette]) => <div key={part} className="room-color-row"><span>{label}</span>
      <div className="style-swatches">{palette.map((color) => <button key={color} type="button" title={label} className={current[part] === color ? 'active' : ''} style={{ background: color }} onClick={() => setCharacterLook({ [part]: color })} />)}</div>
    </div>)}
    {characterLook && <div className="room-color-row"><span /><div><button type="button" className="look-reset" onClick={() => setCharacterLook(null)}>기본으로 되돌리기</button></div></div>}
  </div>
}

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
  const [tab, setTab] = useState<typeof tabs[number]>('전체')
  const { startPreview, preview, previewValid, placePreview, cancelPreview, availableCount } = useRoomStore()
  const showingColors = tab === COLOR_TAB
  const showingCharacter = tab === CHARACTER_TAB
  // only what you still own and have not put down somewhere — placing one takes it off this list
  const stock = showingColors || showingCharacter ? [] : CATALOG.filter((entry) => availableCount(entry.type) > 0 && (tab === '전체' || categoryFor(entry.type) === tab as InventoryCategory))
  return <section className={preview ? 'inventory-panel previewing' : 'inventory-panel'} aria-label="보관함">
    <header><strong>보관함</strong>{preview && <button type="button" onClick={cancelPreview}>미리보기 취소</button>}</header>
    <nav>{tabs.map((entry) => <button key={entry} className={tab === entry ? 'active' : ''} type="button" onClick={() => setTab(entry)}>{entry}</button>)}</nav>
    {showingCharacter ? <CharacterLookEditor /> : showingColors ? <RoomColorEditor /> : <div className="inventory-items">
      {stock.length === 0 && <p className="inventory-empty">남은 가구가 없어요. 방에 놓인 가구를 정리하면 다시 꺼낼 수 있어요.</p>}
      {stock.map((entry) => <button key={`${entry.type}:${entry.styleId ?? ''}`} type="button" onClick={() => startPreview(entry.type, entry.styleId)}><ItemIcon item={entry as FurnitureItem} /><span>{entry.name}<small>{entry.footprint.width ? `${entry.size[0]} × ${entry.size[1]}` : '벽'}</small></span></button>)}
    </div>}
    {preview && <footer><span className={previewValid ? 'valid' : 'invalid'}>{previewValid ? '배치 가능한 위치' : '이 위치에는 배치할 수 없어요'}</span><button type="button" disabled={!previewValid} onClick={placePreview}>배치</button></footer>}
  </section>
}
