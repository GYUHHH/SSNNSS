import { RoundedBox } from '@react-three/drei'
import Furniture from './Furniture'
import { useRoomStore } from '../store'
import { palette } from '../services/palette'
import { colorOf } from '../services/styles'

export default function Desk() {
  const { furniture } = useRoomStore()
  const top = colorOf(furniture.find((item) => item.id === 'desk')?.styleId, palette.woodLight)
  return <Furniture id="desk">
    <RoundedBox castShadow args={[1.4, 0.09, 0.7]} radius={0.025} smoothness={2} position={[0, 1.03, 0]}><meshStandardMaterial color={top} roughness={0.65} /></RoundedBox>
    {[[-0.55, -0.22], [0.55, -0.22], [-0.55, 0.22], [0.55, 0.22]].map(([x, z]) => <mesh castShadow key={`${x}${z}`} position={[x, 0.48, z]}><cylinderGeometry args={[0.045, 0.07, 1.02, 10]} /><meshStandardMaterial color={palette.woodDark} roughness={0.7} /></mesh>)}
  </Furniture>
}
