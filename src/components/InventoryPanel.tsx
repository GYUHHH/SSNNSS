import { type FormEvent, useEffect, useRef, useState } from 'react'
import { frameFamily, type FurnitureItem, initialFurniture, inventoryItems, type InventoryCategory, useRoomStore } from '../store'
import { thumbnailFor, thumbnailForFloorStyle } from '../services/thumbnails'
import { colorOf, customizableTypes, DEFAULT_WALL_COLOR, floorStyleOf, floorStyles, type FloorStyle } from '../services/styles'
import { DEFAULT_APPEARANCE as CHARACTER_DEFAULTS } from './Character'
import { t, tp } from '../services/i18n'
import { CUSTOM_OBJECT_CATEGORIES, customObjectType, type CustomObjectCategory } from '../customObjectSpec'
import { customObjectTemplate, generateCustomObject } from '../services/customObjects'
import { PhotoCropEditor } from './PhotoCropEditor'

function ItemIcon({ item }: { item: { type: string; styleId?: string; customSpec?: FurnitureItem['customSpec'] } }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { let live = true; const wallId = (item as FurnitureItem).allowedSurfaces?.includes('wall') ? 'leftWall' as const : undefined; thumbnailFor({ ...item, wallId } as FurnitureItem).then((url) => { if (live) setSrc(url) }); return () => { live = false } }, [item.type, item.styleId, item.customSpec?.id])
  return src ? <img className="inventory-icon thumb" src={src} alt="" /> : <i className={`inventory-icon ${item.type}`} />
}

const categories: InventoryCategory[] = ['전체', '가구', '조명', '식물', '벽장식', '소품']
// The wall and floor pickers get a tab of their own rather than sitting under every item list. Kept out of
// InventoryCategory because that type is what filters the catalogue, and this tab shows no items at all.
const COLOR_TAB = '색상'
const CHARACTER_TAB = '캐릭터'
const BOOKS_TAB = '책'
const CUSTOM_TAB = 'AI 커스텀'
const tabs = [...categories, CUSTOM_TAB, BOOKS_TAB, CHARACTER_TAB, COLOR_TAB] as const
const categoryFor = (type: string): InventoryCategory => ({ 'task-chair': '가구', 'inflatable-sofa': '가구', 'blob-sculpture': '소품', 'side-table': '가구', 'music-player': '가구', 'floor-lamp': '조명', 'potted-plant': '식물', 'herb-pot': '식물', 'herb-pot-2': '식물', 'succulent-pot': '식물', 'incense-burner': '소품', 'vanity-desk': '가구', 'mushroom-lamp': '조명', 'lavender-sofa': '가구', 'pennant': '벽장식', 'boucle-stool': '가구', 'cube-shelf': '가구', 'papasan-chair': '가구', 'sage-office-chair': '가구', 'glass-table': '가구', 'glass-mushroom-lamp': '조명', 'pop-shelf': '가구', 'bubble-chair': '가구', 'y2k-desk': '가구', 'pod-daybed': '가구', 'wall-art': '벽장식', 'wall-art-3': '벽장식', 'wall-art-4': '벽장식', 'wall-art-5': '벽장식', 'animated-poster': '벽장식', window: '벽장식', banner: '벽장식', 'cd-player': '벽장식', 'profile-board': '벽장식', 'video-frame-3': '벽장식', 'video-frame-4': '벽장식', 'video-frame-5': '벽장식', guestbook: '벽장식', 'notification-box': '벽장식', 'string-lights': '조명', 'wall-sconce-2': '조명', calendar: '벽장식', 'christmas-tree': '식물', 'record-player': '가구', whiteboard: '가구', 'easel-photo': '가구', 'rocking-chair': '가구', beanbag: '가구', 'mini-fridge': '가구', hanger: '가구', 'dual-monitors': '소품', 'full-mirror': '벽장식', 'heart-mirror': '벽장식', 'star-projector': '소품', 'led-lamp': '소품', curtain: '벽장식', fireplace: '가구', 'coffee-table': '가구', 'glass-shelf': '가구', tv: '가구', wardrobe: '가구', 'fish-tank': '소품', candle: '소품', 'wall-shelf': '벽장식', vase: '소품', cushion: '소품', plush: '소품', mug: '소품', 'book-prop': '소품', speaker: '소품', 'photo-frame': '벽장식', 'photo-frame-2': '벽장식', 'photo-frame-3': '벽장식', 'photo-frame-4': '벽장식', 'photo-frame-5': '벽장식', bed: '가구', sofa: '가구', desk: '가구', chair: '가구', bookshelf: '가구', cabinet: '가구', rug: '가구', lamp: '조명', plant: '식물', clock: '벽장식', poster: '벽장식', photo: '벽장식', computer: '소품', cup: '소품' } as Record<string, InventoryCategory>)[type] ?? '가구'

// everything a room can hold: the catalogue plus the movable pieces the room ships with
type InventoryEntry = { type: string; name: string; size: [number, number]; footprint: FurnitureItem['footprint']; allowedSurfaces: FurnitureItem['allowedSurfaces']; styleId?: string }
const OWNABLE: InventoryEntry[] = [...inventoryItems.filter((entry) => entry.type !== 'diary-book'), ...initialFurniture.filter((item) => item.movable)]
  .filter((entry, index, all) => all.findIndex((other) => other.type === entry.type) === index)
  .map((entry) => ({ type: entry.type, name: entry.name, size: entry.size, footprint: entry.footprint, allowedSurfaces: entry.allowedSurfaces }))
// Fixed-size variants remain valid save-data templates, but new rooms see one resizable item per family. A legacy
// variant already owned by a user is surfaced below by its exact id, so its media link and placement are preserved.
const LEGACY_FRAME_TYPES = new Set(['video-frame-4', 'video-frame-5', 'photo-frame-2', 'photo-frame-3', 'photo-frame-4', 'photo-frame-5', 'wall-art-3', 'wall-art-4', 'wall-art-5'])
const CATALOG = OWNABLE.filter((entry) => !LEGACY_FRAME_TYPES.has(entry.type))
const RESIZABLE_FRAME_TYPES = new Set(['video-frame-3', 'photo-frame', 'wall-art'])

// Colours are picked freely off the native wheel rather than off a fixed swatch row. The store write waits for
// the drag to settle: every write publishes the whole room, and a colour input fires on each pointer move.
function ColorField({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const [local, setLocal] = useState(value)
  const pending = useRef<string | null>(null)
  const timer = useRef(0)
  const commit = useRef(onPick)
  commit.current = onPick
  useEffect(() => setLocal(value), [value])
  // closing the panel mid-pick must not drop the colour
  useEffect(() => () => { window.clearTimeout(timer.current); if (pending.current) commit.current(pending.current) }, [])
  return <input type="color" className="color-field" value={local} aria-label={t('색 고르기')} onChange={(event) => {
    const next = event.target.value
    setLocal(next)
    pending.current = next
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { pending.current = null; commit.current(next) }, 220)
  }} />
}

// The character's look editor: one free colour per part. Changes save and publish exactly like recoloring a wall.
const LOOK_ROWS = [['skinColor', '피부'], ['hairColor', '머리'], ['topColor', '상의'], ['bottomColor', '하의'], ['shoeColor', '신발']] as const
function CharacterLookEditor() {
  const { characterLook, setCharacterLook } = useRoomStore()
  const current = { ...CHARACTER_DEFAULTS, ...characterLook }
  return <div className="room-colors">
    {LOOK_ROWS.map(([part, label]) => <div key={part} className="room-color-row"><span>{t(label)}</span>
      <ColorField value={current[part]} onPick={(hex) => setCharacterLook({ [part]: hex })} />
    </div>)}
    {characterLook && <div className="room-color-row"><span /><div><button type="button" className="look-reset" onClick={() => setCharacterLook(null)}>{t('기본으로 되돌리기')}</button></div></div>}
  </div>
}

// 재질 스와치: 평면 색 대신 실제 거칠기로 렌더된 슬래브 썸네일 — 광택 차이가 보인다
function FloorMaterialSwatch({ style, active, onPick }: { style: FloorStyle; active: boolean; onPick: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { let live = true; thumbnailForFloorStyle(style).then((url) => { if (live && url) setSrc(url) }); return () => { live = false } }, [style.id])
  return <button type="button" title={t(style.label)} className={active ? 'active' : ''} style={src ? undefined : { background: style.color }} onClick={onPick}>{src && <img src={src} alt={t(style.label)} />}</button>
}

// wall and floor recolors live in the inventory now — clicking the room surfaces no longer opens a picker
function RoomColorEditor() {
  const { wallStyle, floorStyle, setWallStyle, setFloorStyle } = useRoomStore()
  const floor = floorStyleOf(floorStyle)
  return <div className="room-colors">
    {([['leftWall', '왼쪽 벽'], ['rightWall', '오른쪽 벽']] as const).map(([wallId, label]) => <div key={wallId} className="room-color-row"><span>{t(label)}</span>
      <ColorField value={colorOf(wallStyle[wallId], DEFAULT_WALL_COLOR[wallId])} onPick={(hex) => setWallStyle(wallId, hex)} />
    </div>)}
    <div className="room-color-row"><span>{t('바닥 재질')}</span>
      <div className="style-swatches">{floorStyles.map((style) => <FloorMaterialSwatch key={style.id} style={style} active={floor.id === style.id} onPick={() => setFloorStyle(style.id)} />)}</div>
    </div>
    <div className="room-color-row"><span>{t('바닥 색상')}</span>
      <ColorField value={floor.color} onPick={(hex) => setFloorStyle(`${floor.id}${hex}`)} />
    </div>
  </div>
}

// 보관함의 책 탭: 모든 기록장이 제목으로 나열된다. 보관 중인 책은 꺼내 배치하고,
// "+"로 무한히 새로 만든다. 이름·공개·삭제 관리는 연필 토글 안에 숨긴다.
function BooksTab() {
  const { books, furniture, addBook, updateBook, deleteBook, startPreview } = useRoomStore()
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const stored = (bookId: string) => furniture.some((item) => item.id === `inventory-book-${bookId}` && item.removed)
  const place = (bookId: string) => startPreview('diary-book', undefined, `inventory-book-${bookId}`)
  const create = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    place(addBook(title.trim(), 'private'))
    setTitle(''); setAdding(false)
  }
  return <div className="books-tab">
    {adding
      ? <form className="new-book" onSubmit={create}><input autoFocus aria-label={t('새 책 제목')} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('새 책 제목')} /><button type="submit">{t('책 만들기')}</button></form>
      : <div className="books-tools"><button type="button" onClick={() => { setAdding(true); setManaging(false) }}>{t('+ 새 기록장')}</button><button type="button" onClick={() => { setManaging((value) => !value); setDeleting(null) }}>{managing ? t('관리 닫기') : t('관리')}</button></div>}
    <div className="book-list">{books.map((book) => <div key={book.id} className="book-row-wrap">
      <div className="book-row"><i style={{ background: book.coverColor }} />
        {managing
          ? <input className="book-title-input" maxLength={50} value={book.title} onChange={(event) => updateBook(book.id, { title: event.target.value })} />
          : <span>{book.title}<small>{stored(book.id) ? t('보관 중') : t('배치됨')}</small></span>}
        {!managing && stored(book.id) && <button type="button" className="book-place" onClick={() => place(book.id)}>{t('배치')}</button>}
      </div>
      {managing && <div className="book-controls"><button type="button" onClick={() => updateBook(book.id, { visibility: book.visibility === 'public' ? 'private' : 'public' })}>{book.visibility === 'public' ? t('공개') : t('비공개')}</button><button className="book-delete" type="button" onClick={() => setDeleting(book.id)}>{t('삭제')}</button></div>}
      {deleting === book.id && <div className="delete-confirm"><span>{tp('‘{title}’ 삭제할까요?', { title: book.title })}</span><button type="button" onClick={() => setDeleting(null)}>{t('취소')}</button><button type="button" onClick={() => { deleteBook(book.id); setDeleting(null) }}>{t('삭제')}</button></div>}
    </div>)}</div>
  </div>
}

const CUSTOM_CATEGORY_LABELS: Record<CustomObjectCategory, string> = { furniture: '가구', wallDecoration: '벽장식', floor: '바닥', sculpture: '조형물' }

function CustomTab() {
  const { customObjects, addCustomObject, startPreview, availableCount } = useRoomStore()
  const [source, setSource] = useState<'text' | 'photo' | null>(null)
  const [category, setCategory] = useState<CustomObjectCategory>('furniture')
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [editingImage, setEditingImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const choosePhoto = () => { setSource('photo'); setError(''); file.current?.click() }
  const readPhoto = (value?: File) => {
    if (!value?.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setEditingImage(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(value)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if ((source === 'text' && !prompt.trim()) || (source === 'photo' && !image) || loading) return
    setLoading(true); setError('')
    try {
      const object = await generateCustomObject({ category, prompt: prompt.trim(), image: image ?? undefined })
      addCustomObject(object); setSource(null); setPrompt(''); setImage(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('생성 실패'))
    } finally { setLoading(false) }
  }
  const objects = customObjects.filter((object) => availableCount(customObjectType(object.id)) > 0)
  return <div className="custom-tab">
    <input ref={file} hidden type="file" accept="image/*" onChange={(event) => { readPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} />
    {!source && <div className="custom-source"><button type="button" onClick={() => { setSource('text'); setError('') }}>{t('텍스트 넣기')}</button><button type="button" onClick={choosePhoto}>{t('사진 넣기')}</button></div>}
    {source && <form className="custom-form" onSubmit={submit}>
      <div className="custom-form-head"><strong>{t(source === 'text' ? '텍스트 넣기' : '사진 넣기')}</strong><button type="button" onClick={() => { setSource(null); setImage(null); setEditingImage(null); setError('') }}>×</button></div>
      <label>{t('오브젝트 종류')}<select value={category} onChange={(event) => setCategory(event.target.value as CustomObjectCategory)}>{CUSTOM_OBJECT_CATEGORIES.map((value) => <option key={value} value={value}>{t(CUSTOM_CATEGORY_LABELS[value])}</option>)}</select></label>
      {source === 'photo' && (image ? <div className="custom-photo"><img src={image} alt="" /><button type="button" aria-label={t('사진 삭제')} onClick={() => { setImage(null); file.current?.click() }}>×</button></div> : <button className="custom-photo-pick" type="button" onClick={choosePhoto}>{t('사진 넣기')}</button>)}
      <textarea maxLength={1200} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t(source === 'photo' ? '원하는 디자인 (선택)' : '원하는 디자인')} />
      {error && <p className="custom-error">{error}</p>}
      <button className="custom-generate" type="submit" disabled={(source === 'text' && !prompt.trim()) || (source === 'photo' && !image) || loading}>{t(loading ? '생성 중' : '생성')}</button>
    </form>}
    {!source && <div className="inventory-items custom-items">{objects.map((object) => {
      const entry = customObjectTemplate(object) as FurnitureItem
      return <button key={object.id} type="button" onClick={() => startPreview(entry.type)}><ItemIcon item={entry} /><span>{object.name}<small>{entry.size[0]} × {entry.size[1]}</small></span></button>
    })}</div>}
    {editingImage && <PhotoCropEditor source={editingImage} onApply={(value) => { setImage(value); setEditingImage(null) }} onClose={() => setEditingImage(null)} />}
  </div>
}

export default function InventoryPanel() {
  const [tab, setTab] = useState<typeof tabs[number]>('전체')
  const { startPreview, preview, previewValid, placePreview, availableCount } = useRoomStore()
  const showingColors = tab === COLOR_TAB
  const showingCharacter = tab === CHARACTER_TAB
  const showingBooks = tab === BOOKS_TAB
  const showingCustom = tab === CUSTOM_TAB
  // only what you still own and have not put down somewhere — placing one takes it off this list
  const stock = showingColors || showingCharacter || showingBooks || showingCustom ? [] : CATALOG.filter((entry) => availableCount(entry.type) > 0 && (tab === '전체' || (entry.type === 'speech-bubble' ? '소품' : categoryFor(entry.type)) === tab as InventoryCategory))
  return <section className={preview ? 'inventory-panel previewing' : 'inventory-panel'} aria-label={t('보관함')}>
    <nav>{tabs.map((entry) => <button key={entry} className={tab === entry ? 'active' : ''} type="button" onClick={() => setTab(entry)}>{t(entry)}</button>)}</nav>
    {showingCustom ? <CustomTab /> : showingBooks ? <BooksTab /> : showingCharacter ? <CharacterLookEditor /> : showingColors ? <RoomColorEditor /> : <div className="inventory-items">
      {stock.length === 0 && <p className="inventory-empty">{t('남은 가구가 없어요. 방에 놓인 가구를 정리하면 다시 꺼낼 수 있어요.')}</p>}
      {stock.map((entry) => <button key={`${entry.type}:${entry.styleId ?? ''}`} type="button" onClick={() => startPreview(entry.type, entry.styleId)}><ItemIcon item={entry as FurnitureItem} /><span>{t(entry.name)}<small>{RESIZABLE_FRAME_TYPES.has(frameFamily(entry.type)) ? `× ${availableCount(entry.type)}` : entry.footprint.width ? `${entry.size[0]} × ${entry.size[1]}` : t('벽')}</small></span></button>)}
    </div>}
    {preview && <footer><span className={previewValid ? 'valid' : 'invalid'}>{previewValid ? t('배치 가능한 위치') : t('이 위치에는 배치할 수 없어요')}</span><button type="button" disabled={!previewValid} onClick={placePreview}>{t('배치')}</button></footer>}
  </section>
}
