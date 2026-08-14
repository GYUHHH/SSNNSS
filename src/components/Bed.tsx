import { RoundedBox } from '@react-three/drei'
import Furniture from './Furniture'
import { useRoomStore } from '../store'
import { palette } from '../services/palette'
import { colorOf } from '../services/styles'

export default function Bed() {
  const { furniture } = useRoomStore()
  const accent = colorOf(furniture.find((item) => item.id === 'bed')?.styleId, palette.rust)
  return <Furniture id="bed">
    {/* frame: legs + low rail, mattress sits on top */}
    {[[-0.62, -0.92], [0.62, -0.92], [-0.62, 0.92], [0.62, 0.92]].map(([x, z]) => <mesh castShadow key={`${x}${z}`} position={[x, 0.11, z]}><boxGeometry args={[0.1, 0.22, 0.1]} /><meshStandardMaterial color={palette.woodDark} roughness={0.75} /></mesh>)}
    <RoundedBox castShadow args={[1.4, 0.16, 2.1]} radius={0.03} smoothness={2} position={[0, 0.24, 0]}><meshStandardMaterial color={palette.woodMid} roughness={0.7} /></RoundedBox>
    <RoundedBox castShadow args={[1.4, 1.3, 0.14]} radius={0.06} smoothness={2} position={[0, 0.87, -0.98]}><meshStandardMaterial color={palette.woodDark} roughness={0.75} /></RoundedBox>

    <RoundedBox castShadow args={[1.32, 0.26, 2]} radius={0.07} smoothness={2} position={[0, 0.45, 0]}><meshStandardMaterial color={palette.linen} roughness={0.9} /></RoundedBox>

    <RoundedBox castShadow args={[1.28, 0.1, 1.3]} radius={0.05} smoothness={2} position={[0, 0.63, 0.28]}><meshStandardMaterial color={accent} roughness={0.9} /></RoundedBox>

    <RoundedBox castShadow args={[0.5, 0.1, 0.5]} radius={0.05} smoothness={2} rotation={[0, 0.08, 0]} position={[-0.3, 0.63, -0.62]}><meshStandardMaterial color={palette.linen} roughness={0.85} /></RoundedBox>
    <RoundedBox castShadow args={[0.5, 0.1, 0.5]} radius={0.05} smoothness={2} rotation={[0, -0.06, 0]} position={[0.3, 0.63, -0.6]}><meshStandardMaterial color={palette.linen} roughness={0.85} /></RoundedBox>
  </Furniture>
}
