import { RoundedBox } from '@react-three/drei'
import Furniture from './Furniture'
import { useRoomStore } from '../store'
import { palette } from '../services/palette'
import { colorOf } from '../services/styles'

export default function Sofa() {
  const { furniture } = useRoomStore()
  const fabric = colorOf(furniture.find((item) => item.id === 'sofa')?.styleId, palette.fabricWarm)
  return <Furniture id="sofa">
    {[[-0.95, -0.28], [0.95, -0.28], [-0.95, 0.28], [0.95, 0.28]].map(([x, z]) => <mesh castShadow key={`${x}${z}`} position={[x, 0.09, z]}><boxGeometry args={[0.08, 0.18, 0.08]} /><meshStandardMaterial color={palette.woodDark} roughness={0.75} /></mesh>)}

    <RoundedBox castShadow args={[2, 0.32, 0.64]} radius={0.06} smoothness={2} position={[0, 0.34, 0]}><meshStandardMaterial color={fabric} roughness={0.85} /></RoundedBox>

    <RoundedBox castShadow args={[0.22, 0.5, 0.68]} radius={0.08} smoothness={2} position={[-0.94, 0.5, 0]}><meshStandardMaterial color={fabric} roughness={0.85} /></RoundedBox>
    <RoundedBox castShadow args={[0.22, 0.5, 0.68]} radius={0.08} smoothness={2} position={[0.94, 0.5, 0]}><meshStandardMaterial color={fabric} roughness={0.85} /></RoundedBox>

    <RoundedBox castShadow args={[1.56, 0.62, 0.22]} radius={0.09} smoothness={2} rotation={[0.12, 0, 0]} position={[0, 0.75, -0.24]}><meshStandardMaterial color={fabric} roughness={0.85} /></RoundedBox>

    <RoundedBox castShadow args={[0.32, 0.12, 0.3]} radius={0.05} smoothness={2} rotation={[0, 0.4, 0.12]} position={[0.72, 0.62, 0.05]}><meshStandardMaterial color={palette.sage} roughness={0.9} /></RoundedBox>
  </Furniture>
}
