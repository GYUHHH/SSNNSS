import { type FormEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { frameFamily, type FurnitureItem, initialFurniture, inventoryItems, type InventoryCategory, useRoomStore } from '../store'
import { thumbnailFor, thumbnailForFloorStyle } from '../services/thumbnails'
import { colorOf, customizableTypes, DEFAULT_WALL_COLOR, floorStyleOf, floorStyles, type FloorStyle } from '../services/styles'
import { DEFAULT_APPEARANCE as CHARACTER_DEFAULTS } from './Character'
import { t, tp } from '../services/i18n'
import { CUSTOM_OBJECT_CATEGORIES, customObjectType, type CustomObjectCategory, type CustomPose } from '../customObjectSpec'
import { cachedCredits, createCreditCheckout, customObjectTemplate, fetchCredits, type CreditStatus } from '../services/customObjects'
import { PhotoCropEditor } from './PhotoCropEditor'

function ItemIcon({ item }: { item: { type: string; styleId?: string; customSpec?: FurnitureItem['customSpec'] } }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { let live = true; setSrc(null); const wallId = (item as FurnitureItem).allowedSurfaces?.includes('wall') ? 'leftWall' as const : undefined; thumbnailFor({ ...item, wallId } as FurnitureItem).then((url) => { if (live && url) setSrc(url) }); return () => { live = false } }, [item.type, item.styleId, item.customSpec?.id, item.customSpec?.glbUrl])
  return src ? <img className="inventory-icon thumb" src={src} alt="" /> : <i className={`inventory-icon ${item.type}`} />
}

const CoinIcon = () => <svg className="credit-coin" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" /><circle cx="8" cy="8" r="4.5" fill="none" /></svg>

const categories: InventoryCategory[] = ['전체', '가구', '조명', '식물', '벽장식', '바닥', '소품']
// The wall and floor pickers get a tab of their own rather than sitting under every item list. Kept out of
// InventoryCategory because that type is what filters the catalogue, and this tab shows no items at all.
const COLOR_TAB = '벽·바닥'
const CHARACTER_TAB = '캐릭터'
const BOOKS_TAB = '책'
const CUSTOM_TAB = 'AI 커스텀'
const PARTICLE_TAB = '효과'
const tabs = [categories[0], CUSTOM_TAB, ...categories.slice(1), PARTICLE_TAB, BOOKS_TAB, CHARACTER_TAB, COLOR_TAB] as const
const categoryFor = (type: string): InventoryCategory => ({ 'play-slide': '가구', 'hyper-sculpture': '소품', 'bracket-shelf': '벽장식', 'pink-mini-sofa': '가구', 'pink-vanity': '가구', 'hanging-bubble-chair': '가구', 'aqua-table': '가구', 'frutiger-desk': '가구', 'deco-shelf': '가구', 'dome-sofa': '가구', 'cloud-sofa': '가구', 'color-drawers': '가구', 'pink-slide': '가구', 'aero-bubble-chair': '가구', 'kids-slide': '가구', 'inflatable-sofa': '가구', 'blob-sculpture': '소품', 'side-table': '가구', 'music-player': '가구', 'floor-lamp': '조명', 'potted-plant': '식물', 'herb-pot': '식물', 'herb-pot-2': '식물', 'succulent-pot': '식물', 'incense-burner': '소품', 'vanity-desk': '가구', 'mushroom-lamp': '조명', 'lavender-sofa': '가구', 'pennant': '벽장식', 'boucle-stool': '가구', 'cube-shelf': '가구', 'papasan-chair': '가구', 'sage-office-chair': '가구', 'glass-table': '가구', 'glass-mushroom-lamp': '조명', 'pop-shelf': '가구', 'bubble-chair': '가구', 'y2k-desk': '가구', 'pod-daybed': '가구', 'wall-art': '벽장식', 'wall-art-3': '벽장식', 'wall-art-4': '벽장식', 'wall-art-5': '벽장식', 'animated-poster': '벽장식', window: '벽장식', banner: '벽장식', 'cd-player': '벽장식', 'profile-board': '벽장식', 'video-frame-3': '벽장식', 'video-frame-4': '벽장식', 'video-frame-5': '벽장식', guestbook: '벽장식', 'notification-box': '벽장식', 'string-lights': '조명', 'wall-sconce-2': '조명', calendar: '벽장식', 'christmas-tree': '식물', 'record-player': '가구', whiteboard: '가구', 'easel-photo': '가구', 'rocking-chair': '가구', beanbag: '가구', 'mini-fridge': '가구', hanger: '가구', 'dual-monitors': '소품', 'full-mirror': '벽장식', 'heart-mirror': '벽장식', 'star-projector': '소품', 'led-lamp': '소품', curtain: '벽장식', fireplace: '가구', 'coffee-table': '가구', 'glass-shelf': '가구', tv: '가구', wardrobe: '가구', 'fish-tank': '소품', candle: '소품', 'wall-shelf': '벽장식', vase: '소품', cushion: '소품', plush: '소품', mug: '소품', 'book-prop': '소품', speaker: '소품', 'photo-frame': '벽장식', 'photo-frame-2': '벽장식', 'photo-frame-3': '벽장식', 'photo-frame-4': '벽장식', 'photo-frame-5': '벽장식', bed: '가구', sofa: '가구', desk: '가구', chair: '가구', bookshelf: '가구', cabinet: '가구', rug: '바닥', lamp: '조명', plant: '식물', clock: '벽장식', poster: '벽장식', photo: '벽장식', computer: '소품', cup: '소품' } as Record<string, InventoryCategory>)[type] ?? '가구'

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

function SurfaceImagePicker({ label, image, onChange }: { label: string; image?: string; onChange: (image: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const close = () => setEditing((source) => { if (source) URL.revokeObjectURL(source); return null })
  return <div className="room-color-row"><span>{t(label)}</span><div>
    <button type="button" className="image-action add" onClick={() => input.current?.click()}>{t('사진 넣기')}</button>
    {image && <button type="button" className="image-action remove" onClick={() => onChange(null)}>{t('사진 제거')}</button>}
    <input ref={input} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) setEditing(URL.createObjectURL(file)); event.target.value = '' }} />
    {editing && <PhotoCropEditor source={editing} aspect={1} output={[1024, 1024]} onClose={close} onApply={(next) => { onChange(next); close() }} />}
  </div></div>
}

// wall and floor recolors live in the inventory now — clicking the room surfaces no longer opens a picker
function RoomColorEditor() {
  const { wallStyle, floorStyle, floorImage, setWallStyle, setFloorStyle, setFloorImage, setWallImage } = useRoomStore()
  const floor = floorStyleOf(floorStyle)
  return <div className="room-colors">
    <section className="room-style-section"><strong>{t('벽')}</strong>
      {([['leftWall', '왼쪽 벽'], ['rightWall', '오른쪽 벽']] as const).map(([wallId, label]) => <div key={wallId} className="room-style-surface"><span>{t(label)}</span>
        <div className="room-color-pair">
          <div className="room-color-row"><span>{t('색상')}</span><ColorField value={colorOf(wallStyle[wallId], DEFAULT_WALL_COLOR[wallId])} onPick={(hex) => setWallStyle(wallId, hex)} /></div>
          <SurfaceImagePicker label="이미지" image={wallStyle[wallId === 'leftWall' ? 'leftWallImage' : 'rightWallImage']} onChange={(image) => setWallImage(wallId, image)} />
        </div>
      </div>)}
    </section>
    <section className="room-style-section"><strong>{t('바닥')}</strong>
      <div className="room-color-row"><span>{t('재질')}</span><div className="style-swatches">{floorStyles.map((style) => <FloorMaterialSwatch key={style.id} style={style} active={floor.id === style.id} onPick={() => setFloorStyle(style.id)} />)}</div></div>
      <div className="room-color-pair">
        <div className="room-color-row"><span>{t('색상')}</span><ColorField value={floor.color} onPick={(hex) => setFloorStyle(`${floor.id}${hex}`)} /></div>
        <SurfaceImagePicker label="이미지" image={floorImage} onChange={setFloorImage} />
      </div>
    </section>
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
      <div className="book-row">{managing
        ? <input className="book-cover-color" type="color" aria-label={`${book.title} ${t('표지 색상')}`} title={t('표지 색상')} value={book.coverColor} onChange={(event) => updateBook(book.id, { coverColor: event.target.value })} />
        : <i style={{ background: book.coverColor }} />}
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

// 생성 잡 진행 표시: 단계 라벨 + 진행률 바. 완료/실패도 여기서 알린다.
export const customJobProgress = (job: { stage: string; round: number }): number =>
  job.stage === 'draft' ? job.round === 0 ? 8 : Math.min(68, 18 + job.round * 3) : job.stage === 'verify' ? job.round === 0 ? 78 : 92 : 100

export const customJobLabel = (job: { stage: string; round: number; name?: string; error?: string }): string =>
  job.stage === 'draft' ? t(job.round === 0 ? '생성 요청 중' : '3D 모델 생성 중') : job.stage === 'verify' ? t(job.round === 0 ? '모델 최적화 중' : '보관함에 저장 중') : job.stage === 'done' ? `${job.name ?? ''} ${t('완성')}` : t('생성 실패')

function CustomJobStatus({ job }: { job: { stage: string; round: number; name?: string; error?: string } }) {
  const running = job.stage !== 'done' && job.stage !== 'error'
  return <div className={`custom-job-status${job.stage === 'error' ? ' failed' : ''}`}>
    <span>{customJobLabel(job)}</span>
    {job.stage === 'error' && job.error && <small>{job.error}</small>}
    {running && <span className="custom-job-bar"><i style={{ width: `${customJobProgress(job)}%` }} /></span>}
  </div>
}

const CUSTOM_CATEGORY_LABELS: Record<CustomObjectCategory, string> = { furniture: '가구', wallDecoration: '벽', floor: '바닥', sculpture: '소품' }
const CUSTOM_CATEGORY_DESCRIPTIONS: Array<[CustomObjectCategory, string]> = [
  ['furniture', '바닥에 배치되며 다른 가구와 겹칠 수 없습니다.'],
  ['wallDecoration', '벽에 배치되며 다른 벽 오브젝트와 겹칠 수 없습니다.'],
  ['floor', '러그처럼 바닥에 배치되며 그 위에 다른 오브젝트를 놓을 수 있습니다.'],
  ['sculpture', '1×1칸을 차지하며 실제 크기는 0.35칸 기준으로 생성됩니다.'],
]

function CustomTab() {
  const { customObjects, startPreview, startCustomObjectEdit, availableCount, customJob, runCustomGeneration, markCustomSeen, removeCustomObject } = useRoomStore()
  const [removing, setRemoving] = useState<string | null>(null)
  // 생성권 잔액: 결제가 구성된 경우에만 표시·차단. 생성이 끝날 때마다 새로 읽는다.
  const [credits, setCredits] = useState<CreditStatus | null>(cachedCredits)
  const [openingCheckout, setOpeningCheckout] = useState(false)
  useEffect(() => { let live = true; void fetchCredits().then((value) => { if (live) setCredits(value) }); return () => { live = false } }, [customJob?.stage])
  // 탭을 열어본 순간 완료/실패 빨간점은 해소된 것으로 본다
  useEffect(() => { markCustomSeen() }, [customJob?.stage])
  const [source, setSource] = useState<'text' | 'photo' | null>(null)
  const [category, setCategory] = useState<CustomObjectCategory>('furniture')
  const [prompt, setPrompt] = useState('')
  const [sizeW, setSizeW] = useState('')
  const [sizeD, setSizeD] = useState('')
  const [sizeH, setSizeH] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [editingImage, setEditingImage] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [categoryInfo, setCategoryInfo] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { root.current?.closest<HTMLElement>('.art-panel')?.scrollTo({ top: 0 }) }, [])
  useEffect(() => {
    if (!categoryInfo) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setCategoryInfo(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [categoryInfo])
  const choosePhoto = () => { setSource('photo'); setPrompt(''); setError(''); file.current?.click() }
  const readPhoto = (value?: File) => {
    if (!value?.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setEditingImage(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(value)
  }
  const [quality, setQuality] = useState<'standard' | 'high'>('standard')
  // 캐릭터가 이 가구에 취할 동작. 실제 자리는 생성된 모델에서 재므로 여기선 무엇을 할지만 고른다
  const [pose, setPose] = useState<'' | CustomPose>('')
  const openCheckout = async () => {
    if (openingCheckout) return
    setOpeningCheckout(true)
    try { window.location.assign(await createCreditCheckout()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'CHECKOUT_FAILED'); setOpeningCheckout(false) }
  }
  const running = !!customJob && customJob.stage !== 'done' && customJob.stage !== 'error'
  const canGenerate = (source === 'text' ? !!prompt.trim() : source === 'photo' ? !!image : false) && !running
  // 가로x세로는 함께, 높이는 선택. 전부 비우면 모델이 알아서 정한다
  const parseSize = (): { width: number; depth: number; height?: number } | null | undefined => {
    if (category === 'sculpture') return { width: 1, depth: 1 }
    const num = (value: string) => { const parsed = Number(value.trim()); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : null }
    if (!sizeW.trim() && !sizeD.trim() && !sizeH.trim()) return undefined
    const width = num(sizeW)
    const depth = num(sizeD)
    if (!width || !depth) return null
    const height = sizeH.trim() ? num(sizeH) : undefined
    if (sizeH.trim() && !height) return null
    return { width, depth, ...(height ? { height } : {}) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if ((source === 'text' && !prompt.trim()) || (source === 'photo' && !image) || running) return
    const size = parseSize()
    if (size === null) { setError(t('크기는 1~12 사이 숫자로 (가로·세로는 함께)')); return }
    setError('')
    runCustomGeneration({ category, prompt: source === 'text' ? prompt.trim() : '', image: image ?? undefined, size, finish: quality === 'high' ? 'gloss' : undefined, pose: pose || undefined })
    setSource(null); setPrompt(''); setImage(null); setSizeW(''); setSizeD(''); setSizeH(''); setPose('')
  }
  const objects = customObjects.filter((object) => availableCount(customObjectType(object.id)) > 0)
  return <div ref={root} className="custom-tab">
    <input ref={file} hidden type="file" accept="image/*" onChange={(event) => { readPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} />
    {credits?.enabled && <div className="custom-credits"><span>{credits.freeLeft && <>{t('무료 1회 남음')} · </>}<span className="credit-balance"><CoinIcon />Credits {credits.balance}</span></span>{credits.checkout ? <button type="button" disabled={openingCheckout} onClick={openCheckout}>{t('충전')}</button> : credits.buyUrl && <a href={credits.buyUrl} target="_blank" rel="noreferrer">{t('충전')}</a>}</div>}
    {customJob && <CustomJobStatus job={customJob} />}
    {!source && <div className="custom-source"><button type="button" onClick={() => { setSource('text'); setError('') }}>{t('텍스트 넣기')}</button><button type="button" onClick={choosePhoto}>{t('사진 넣기')}</button></div>}
    {source && <form className="custom-form" onSubmit={submit}>
      <div className="custom-form-head"><strong>{t(source === 'text' ? '텍스트 넣기' : '사진 넣기')}</strong><button type="button" onClick={() => { setSource(null); setPrompt(''); setImage(null); setEditingImage(null); setError('') }}>×</button></div>
      <label><span className="custom-category-label">{t('오브젝트 종류')}<button type="button" aria-label={t('오브젝트 종류 안내')} onClick={(event) => { event.preventDefault(); setCategoryInfo(true) }}>i</button></span><select value={category} onChange={(event) => setCategory(event.target.value as CustomObjectCategory)}>{CUSTOM_OBJECT_CATEGORIES.map((value) => <option key={value} value={value}>{t(CUSTOM_CATEGORY_LABELS[value])}</option>)}</select></label>
      <label>{t('품질')}<select value={quality} onChange={(event) => setQuality(event.target.value as 'standard' | 'high')}><option value="standard">{t('일반 (1 credit)')}</option><option value="high">{t('고품질 (2 credit)')}</option></select></label>
      {category === 'furniture' && <label>{t('캐릭터 동작')}<select value={pose} onChange={(event) => setPose(event.target.value as '' | CustomPose)}><option value="">{t('없음')}</option><option value="sit">{t('앉기')}</option><option value="lie">{t('눕기')}</option></select></label>}
      <label>{t('크기 (선택)')}{category === 'sculpture' ? <span className="custom-prop-size">{t('1×1칸 · 0.35칸 크기')}</span> : <div className="custom-size"><input type="number" min={1} max={12} value={sizeW} onChange={(event) => setSizeW(event.target.value)} placeholder={t('가로')} aria-label={t('가로')} /><span>×</span><input type="number" min={1} max={12} value={sizeD} onChange={(event) => setSizeD(event.target.value)} placeholder={t('세로')} aria-label={t('세로')} /><span>×</span><input type="number" min={1} max={12} value={sizeH} onChange={(event) => setSizeH(event.target.value)} placeholder={t('높이(선택)')} aria-label={t('높이(선택)')} /></div>}</label>
      {source === 'photo' && (image ? <div className="custom-photo"><img src={image} alt="" /><button type="button" aria-label={t('사진 삭제')} onClick={() => { setImage(null); file.current?.click() }}>×</button></div> : <button className="custom-photo-pick" type="button" onClick={choosePhoto}>{t('사진 넣기')}</button>)}
      {source === 'text' && <textarea maxLength={200} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('원하는 디자인')} />}
      {error && <p className="custom-error">{error}</p>}
      <button className={`custom-generate${canGenerate ? ' ready' : ''}`} type="submit" disabled={!canGenerate}>{t(running ? '생성 중' : '생성')}</button>
    </form>}
    {!source && <div className="inventory-items custom-items">{objects.map((object) => {
      const entry = customObjectTemplate(object) as FurnitureItem
      return <div key={object.id} className="custom-item-wrap">
        <button type="button" onClick={() => startPreview(entry.type)}><ItemIcon item={entry} /><span>{object.name}<small>{entry.size[0]} × {entry.size[1]}</small></span></button>
        <button type="button" className="custom-item-edit" aria-label={t('모델 크기 수정')} onClick={() => { setRemoving(null); startCustomObjectEdit(object.id) }}>✎</button>
        <button type="button" className="custom-item-delete" aria-label={tp('{title} 삭제', { title: object.name })} onClick={() => setRemoving(object.id)}>×</button>
        {removing === object.id && <div className="delete-confirm"><span>{tp('‘{title}’ 삭제할까요?', { title: object.name })}</span><button type="button" onClick={() => setRemoving(null)}>{t('취소')}</button><button type="button" onClick={() => { removeCustomObject(object.id); setRemoving(null) }}>{t('삭제')}</button></div>}
      </div>
    })}</div>}
    {editingImage && <PhotoCropEditor source={editingImage} onApply={(value) => { setImage(value); setEditingImage(null) }} onClose={() => setEditingImage(null)} />}
    {categoryInfo && createPortal(<div className="overlay custom-category-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget) setCategoryInfo(false) }}>
      <section className="custom-category-dialog" role="dialog" aria-modal="true" aria-label={t('오브젝트 종류 안내')}>
        <header><strong>{t('오브젝트 종류')}</strong><button type="button" aria-label={t('닫기')} onClick={() => setCategoryInfo(false)}>×</button></header>
        <dl>{CUSTOM_CATEGORY_DESCRIPTIONS.map(([value, description]) => <div key={value}><dt>{t(CUSTOM_CATEGORY_LABELS[value])}</dt><dd>{t(description)}</dd></div>)}</dl>
      </section>
    </div>, document.body)}
  </div>
}

export default function InventoryPanel() {
  const [tab, setTab] = useState<typeof tabs[number]>('전체')
  const { startPreview, preview, previewValid, placePreview, availableCount, customJob } = useRoomStore()
  const showingColors = tab === COLOR_TAB
  const showingCharacter = tab === CHARACTER_TAB
  const showingBooks = tab === BOOKS_TAB
  const showingCustom = tab === CUSTOM_TAB
  const showingParticles = tab === PARTICLE_TAB
  // only what you still own and have not put down somewhere — placing one takes it off this list
  const stock = showingColors || showingCharacter || showingBooks || showingCustom ? [] : CATALOG.filter((entry) => availableCount(entry.type) > 0 && (tab === '전체' || (showingParticles ? entry.type === 'star-dust' || entry.type === 'club-led' : (entry.type === 'speech-bubble' ? '소품' : categoryFor(entry.type)) === tab as InventoryCategory)))
  return <section className={preview ? 'inventory-panel previewing' : 'inventory-panel'} aria-label={t('보관함')}>
    <nav>{tabs.map((entry) => <button key={entry} className={tab === entry ? 'active' : ''} type="button" onClick={() => setTab(entry)}>{t(entry)}{entry === CUSTOM_TAB && customJob?.unseen && <i className="alert-dot" />}</button>)}</nav>
    {showingCustom ? <CustomTab /> : showingBooks ? <BooksTab /> : showingCharacter ? <CharacterLookEditor /> : showingColors ? <RoomColorEditor /> : <div className="inventory-items">
      {stock.length === 0 && <p className="inventory-empty">{t('남은 가구가 없어요. 방에 놓인 가구를 정리하면 다시 꺼낼 수 있어요.')}</p>}
      {stock.map((entry) => <button key={`${entry.type}:${entry.styleId ?? ''}`} type="button" onClick={() => startPreview(entry.type, entry.styleId)}><ItemIcon item={entry as FurnitureItem} /><span>{t(entry.name)}<small>{RESIZABLE_FRAME_TYPES.has(frameFamily(entry.type)) ? `× ${availableCount(entry.type)}` : entry.footprint.width ? `${entry.size[0]} × ${entry.size[1]}` : t('벽')}</small></span></button>)}
    </div>}
    {preview && <footer><span className={previewValid ? 'valid' : 'invalid'}>{previewValid ? t('배치 가능한 위치') : t('이 위치에는 배치할 수 없어요')}</span><button type="button" disabled={!previewValid} onClick={placePreview}>{t('배치')}</button></footer>}
  </section>
}
