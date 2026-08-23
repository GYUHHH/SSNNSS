import Furniture from './Furniture'
import { useRoomStore } from '../store'
import { palette } from '../services/palette'
import { colorOf } from '../services/styles'

// 2단 고정 선반. 책은 이제 별도 배치 아이템(diary-book)이라 여기서는 틀만 그린다 —
// 단 높이(0.18/0.80)와 capY(1.64)는 roomGrid의 책장 표면 오프셋과 한 몸이다.
const FLOORS = [0.18, 0.8]
const CAP_Y = 1.64
const FRAME_HEIGHT = CAP_Y + 0.18

export default function Bookshelf() {
  const { furniture } = useRoomStore()
  const frameColor = colorOf(furniture.find((item) => item.id === 'bookshelf')?.styleId, palette.woodDark)
  return <Furniture id="bookshelf"><group scale={[.46, 1, 1.35]}>
    <mesh castShadow position={[-1.45, FRAME_HEIGHT / 2, 0]}><boxGeometry args={[0.16, FRAME_HEIGHT, 0.48]} /><meshStandardMaterial color={frameColor} roughness={0.7} /></mesh>
    <mesh castShadow position={[1.45, FRAME_HEIGHT / 2, 0]}><boxGeometry args={[0.16, FRAME_HEIGHT, 0.48]} /><meshStandardMaterial color={frameColor} roughness={0.7} /></mesh>
    {[...FLOORS, CAP_Y].map((y) => <mesh castShadow receiveShadow key={y} position={[0, y, 0]}><boxGeometry args={[3.05, 0.12, 0.52]} /><meshStandardMaterial color={palette.woodMid} roughness={0.7} /></mesh>)}
  </group></Furniture>
}
