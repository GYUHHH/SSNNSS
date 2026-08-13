import { Text, useCursor } from '@react-three/drei'
import { useState } from 'react'
import Furniture from './Furniture'
import { useRoomStore, type Book } from '../store'
import { palette } from '../services/palette'
import { colorOf } from '../services/styles'

// one board per compartment "floor" — the topmost board is the cabinet's own cap, not a shelf floor
const SHELF_FLOOR_Y = [0.18, 0.8, 1.42, 2.04]
const TOP_PANEL_Y = 2.88
const SHELF_BOARD_HALF_THICKNESS = 0.06
const BOOKS_PER_SHELF = 8
const SHELF_INNER_WIDTH = 2.7

// deterministic per-book size variation so neighboring spines don't look identical, without any book being random
const bookDims = (index: number) => ({
  width: 0.22 + (index % 3) * 0.03,
  height: 0.42 + ((index * 13) % 4) * 0.06,
  depth: 0.15 + ((index * 7) % 3) * 0.02,
})

export default function Bookshelf() {
  const { books, furniture } = useRoomStore()
  const frameColor = colorOf(furniture.find((item) => item.id === 'bookshelf')?.styleId, palette.woodDark)
  return <Furniture id="bookshelf"><group scale={[.46, 1, 1.35]}>
    <mesh castShadow position={[-1.45, 1.53, 0]}><boxGeometry args={[0.16, 3.06, 0.48]} /><meshStandardMaterial color={frameColor} roughness={0.7} /></mesh>
    <mesh castShadow position={[1.45, 1.53, 0]}><boxGeometry args={[0.16, 3.06, 0.48]} /><meshStandardMaterial color={frameColor} roughness={0.7} /></mesh>
    {[...SHELF_FLOOR_Y, TOP_PANEL_Y].map((y) => <mesh castShadow receiveShadow key={y} position={[0, y, 0]}><boxGeometry args={[3.05, 0.12, 0.52]} /><meshStandardMaterial color={palette.woodMid} roughness={0.7} /></mesh>)}
    {books.map((book, index) => <DiaryBook key={book.id} book={book} index={index} />)}
  </group></Furniture>
}

function DiaryBook({ book, index }: { book: Book; index: number }) {
  const [hovered, setHovered] = useState(false)
  const { mode, selectFurniture, openBook } = useRoomStore()
  useCursor(hovered)
  const shelf = Math.floor(index / BOOKS_PER_SHELF)
  const slot = index % BOOKS_PER_SHELF
  const { width, height, depth } = bookDims(index)
  const gap = SHELF_INNER_WIDTH / BOOKS_PER_SHELF
  const x = -SHELF_INNER_WIDTH / 2 + gap * (slot + 0.5)
  const shelfTopY = (SHELF_FLOOR_Y[shelf] ?? SHELF_FLOOR_Y[SHELF_FLOOR_Y.length - 1]) + SHELF_BOARD_HALF_THICKNESS
  const y = shelfTopY + height / 2
  const z = 0.16
  return <group
    position={[x, y, hovered ? z + 0.05 : z]}
    onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }}
    onPointerOut={() => setHovered(false)}
    onClick={(event) => { event.stopPropagation(); mode === 'edit' ? selectFurniture('bookshelf') : openBook(book.id) }}
  >
    <mesh castShadow><boxGeometry args={[width, height, depth]} /><meshStandardMaterial color={book.coverColor} roughness={0.8} emissive={hovered ? book.coverColor : '#000000'} emissiveIntensity={hovered ? 0.25 : 0} /></mesh>
    <Text position={[0, 0, depth / 2 + 0.004]} rotation={[0, 0, Math.PI / 2]} fontSize={0.045} maxWidth={height * 0.85} color={palette.linen} anchorX="center" anchorY="middle" overflowWrap="break-word">{book.title.length > 8 ? `${book.title.slice(0, 8)}…` : book.title}</Text>
  </group>
}
