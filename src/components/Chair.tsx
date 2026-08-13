import { RoundedBox } from '@react-three/drei'
import Furniture from './Furniture'
import { palette } from '../services/palette'

export default function Chair() {
  return <Furniture id="chair">
    <RoundedBox castShadow args={[.58, .12, .54]} radius={.035} smoothness={2} position={[0, .48, 0]}><meshStandardMaterial color={palette.woodMid} roughness={.72} /></RoundedBox>
    <RoundedBox castShadow args={[.58, .55, .1]} radius={.035} smoothness={2} position={[0, .75, -.22]}><meshStandardMaterial color={palette.woodDark} roughness={.75} /></RoundedBox>
    {[[-.23, -.2], [.23, -.2], [-.23, .2], [.23, .2]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .23, z]}><cylinderGeometry args={[.035, .045, .46, 8]} /><meshStandardMaterial color={palette.woodDark} roughness={.75} /></mesh>)}
  </Furniture>
}
