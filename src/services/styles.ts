// one shared swatch set for walls, floor accents, and furniture — reused everywhere so "a few cozy presets"
// stays true instead of every surface inventing its own list
export type ColorPreset = { id: string; label: string; color: string }
export const colorPresets: ColorPreset[] = [
  { id: 'cream', label: '크림', color: '#f3ead9' },
  { id: 'beige', label: '베이지', color: '#e3d3b8' },
  { id: 'brown', label: '브라운', color: '#8a6a52' },
  { id: 'terracotta', label: '테라코타', color: '#c17650' },
  { id: 'sage', label: '세이지', color: '#8a9c82' },
  { id: 'mutedYellow', label: '머스터드', color: '#cba24d' },
  { id: 'dustyPink', label: '더스티 핑크', color: '#cf9a92' },
  // Keep white walls distinct from the explorer's warm-white background when rooms are zoomed out.
  { id: 'white', label: '화이트', color: '#e7e5df' },
  { id: 'ivory', label: '아이보리', color: '#efe9dc' },
  { id: 'lightGray', label: '라이트 그레이', color: '#d8d8d4' },
]
// a stored style is either one of the preset ids or a raw hex the owner picked out of the colour wheel
export const colorOf = (id: string | undefined, fallback: string) => id?.startsWith('#') ? id : colorPresets.find((preset) => preset.id === id)?.color ?? fallback

// the walls before anyone recolours them — lives here so the picker can show what it is starting from
export const DEFAULT_WALL_COLOR = { leftWall: '#f1dfc4', rightWall: '#f8e9d1' } as const

// walls only offer a subset that reads as "wallpaper" rather than furniture-saturated colors
export const wallStylePresets = ['cream', 'beige', 'sage', 'dustyPink', 'brown', 'white', 'ivory', 'lightGray'] as const

export type FloorStyle = { id: string; label: string; color: string; roughness: number }
export const floorStyles: FloorStyle[] = [
  { id: 'wood', label: '원목', color: '#cf914f', roughness: 0.75 },
  { id: 'carpet', label: '카펫', color: '#b58a63', roughness: 0.97 },
  { id: 'tile', label: '타일', color: '#e7ddc9', roughness: 0.3 },
  { id: 'whitewood', label: '화이트 우드', color: '#e9e4da', roughness: 0.6 },
]
// A floor is a material plus a colour: "tile" keeps the material's own tone, "tile#c9a06a" repaints it while
// keeping that material's roughness and grout.
export const floorStyleOf = (id: string | undefined): FloorStyle => {
  const [material, tint] = (id ?? '').split('#')
  const style = floorStyles.find((entry) => entry.id === material) ?? floorStyles[0]
  return tint ? { ...style, color: `#${tint}` } : style
}

// furniture types whose primary material responds to a styleId — anything not listed here just ignores styleId
export const customizableTypes = new Set(['bed', 'sofa', 'desk', 'cabinet', 'bookshelf', 'rug', 'lamp', 'floor-lamp', 'cushion', 'plush', 'photo-frame', 'music-player'])
