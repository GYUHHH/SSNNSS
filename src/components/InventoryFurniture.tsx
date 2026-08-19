import { Html, RoundedBox, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace, type Texture, TextureLoader, VideoTexture, type PointLight } from 'three'
import { BannerTextInput, useArtTexture } from './ArtEditor'
import { isVisiting } from '../services/social'
import { type ReactNode, useRef, useState } from 'react'
import type { Group, MeshStandardMaterial } from 'three'
import Furniture, { FittedMesh } from './Furniture'
import MusicPanel from './MusicPanel'
import { type FurnitureItem, useOptionalRoomStore, useRoomStore } from '../store'
import { wallSurfaces } from '../services/roomGrid'
import { colorPresets } from '../services/styles'
import { PRETENDARD_WOFF } from '../services/fonts'
import { getVideo, loadClipUrls, registerClipPlayer } from '../services/mediaStore'
import { playlistVideoResume } from '../services/ytResume'
import { Swing } from './motion'

export function InventoryFurniture() {
  const { furniture } = useRoomStore()
  return <>{furniture.filter((item) => item.id.startsWith('inventory-') && !item.removed).map((item) => <Furniture key={item.id} id={item.id}><ItemVisual item={item} /></Furniture>)}</>
}

export function ItemVisual({ item, preview = false }: { item: FurnitureItem; preview?: boolean }) {
  const store = useOptionalRoomStore()
  const musicTrack = store?.musicTrack ?? null
  const lit = !preview && (store?.toggledOn.has(item.id) ?? false)
  const styleColor = item.styleId ? colorPresets.find((preset) => preset.id === item.styleId)?.color : undefined
  const material = { color: styleColor, transparent: preview, opacity: preview ? 0.5 : 1 }
  const mat = (fallback: string) => <meshStandardMaterial color={material.color ?? fallback} transparent={material.transparent} opacity={material.opacity} />
  const art = useArtTexture(item.id)
  // photos keep their own aspect inside the square photo frame: the plane shrinks on one axis (contain)
  const artImage = art?.image as { width?: number; height?: number } | undefined
  const artAspect = artImage?.width && artImage.height ? artImage.width / artImage.height : 1
  if (item.type === 'side-table') return <><mesh castShadow position={[0, .48, 0]}><cylinderGeometry args={[.34, .34, .12, 12]} /><meshStandardMaterial color={material.color ?? '#b9855d'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh castShadow position={[0, .25, 0]}><cylinderGeometry args={[.08, .12, .5, 10]} /><meshStandardMaterial color={material.color ?? '#845944'} transparent={material.transparent} opacity={material.opacity} /></mesh></>
  if (item.type === 'music-player') return <>
    {[[-.52, -.16], [.52, -.16], [-.52, .16], [.52, .16]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .06, z]}><cylinderGeometry args={[.035, .045, .12, 8]} /><meshStandardMaterial color={material.color ?? '#6b4c39'} transparent={material.transparent} opacity={material.opacity} /></mesh>)}
    <RoundedBox castShadow args={[1.26, .44, .5]} radius={.04} smoothness={2} position={[0, .32, 0]}><meshStandardMaterial color={material.color ?? '#a97a58'} roughness={.7} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
    {[-.4, .4].map((x) => <group key={x}><mesh position={[x, .32, .252]}><circleGeometry args={[.15, 16]} /><meshStandardMaterial color="#3d342c" transparent={material.transparent} opacity={material.opacity} /></mesh><mesh position={[x, .32, .256]}><circleGeometry args={[.05, 12]} /><meshStandardMaterial color="#8a7863" transparent={material.transparent} opacity={material.opacity} /></mesh></group>)}
    <mesh position={[0, .38, .252]}><planeGeometry args={[.3, .12]} /><meshStandardMaterial color="#2b3236" emissive="#4a6a5e" emissiveIntensity={.4} transparent={material.transparent} opacity={material.opacity} /></mesh>
    <mesh position={[0, .24, .252]}><circleGeometry args={[.045, 12]} /><meshStandardMaterial color="#d9c9ae" transparent={material.transparent} opacity={material.opacity} /></mesh>
    {!preview && musicTrack && <Html position={[0, .75, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}><div className="music-notes"><span>♪</span><span>♫</span><span>♪</span></div></Html>}
    {!preview && <MusicControls id={item.id} y={1.05} />}
  </>
  if (item.type === 'floor-lamp') return <><mesh castShadow position={[0, .06, 0]}><cylinderGeometry args={[.25, .28, .12, 12]} /><meshStandardMaterial color={material.color ?? '#83624f'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh castShadow position={[0, .66, 0]}><cylinderGeometry args={[.04, .04, 1.08, 8]} /><meshStandardMaterial color={material.color ?? '#83624f'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh castShadow position={[0, 1.34, 0]}><cylinderGeometry args={[.18, .3, .38, 12, 1, true]} /><meshStandardMaterial color={material.color ?? '#f3d79f'} emissive={lit ? '#ffd9a0' : '#000000'} emissiveIntensity={lit ? .6 : 0} side={2} transparent={material.transparent} opacity={material.opacity} /></mesh>{lit && <mesh position={[0, 1.26, 0]}><sphereGeometry args={[.07, 10, 8]} /><meshStandardMaterial color="#ffe6b8" emissive="#ffe6b8" emissiveIntensity={1.4} /></mesh>}{lit && <pointLight color="#ffc66d" intensity={6} distance={2.4} position={[0, 1.16, 0]} />}</>
  if (item.type === 'potted-plant') return <><mesh castShadow position={[0, .2, 0]}><cylinderGeometry args={[.22, .27, .4, 10]} /><meshStandardMaterial color={material.color ?? '#c37c59'} transparent={material.transparent} opacity={material.opacity} /></mesh>{[-.18, 0, .18].map((x) => <mesh castShadow key={x} position={[x, .65, 0]} rotation={[0.5, x * 2, 0]}><sphereGeometry args={[.22, 8, 8]} /><meshStandardMaterial color={material.color ?? '#668c64'} transparent={material.transparent} opacity={material.opacity} /></mesh>)}</>
  if (item.type === 'guestbook') {
    const noteCount = Math.min(6, store?.guestbook[item.id]?.length ?? 0)
    return <><RoundedBox castShadow args={[1.34, 1.34, .05]} radius={.03} smoothness={2} position={[0, 0, .025]}>{mat('#8a6048')}</RoundedBox><mesh position={[0, 0, .055]}><planeGeometry args={[1.18, 1.18]} />{mat('#c9a06c')}</mesh><mesh position={[0, .47, .06]}><planeGeometry args={[.62, .16]} />{mat('#f3ead9')}</mesh>{Array.from({ length: noteCount }, (_, index) => <group key={index} position={[-.36 + (index % 3) * .36, .16 - Math.floor(index / 3) * .42, .06]} rotation={[0, 0, (index % 2 ? 1 : -1) * .06]}><mesh><planeGeometry args={[.26, .26]} /><meshStandardMaterial color={['#fffaf0', '#f9e9c8', '#e8f0dd'][index % 3]} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh position={[0, .11, .005]}><circleGeometry args={[.022, 8]} /><meshStandardMaterial color="#b3563f" transparent={material.transparent} opacity={material.opacity} /></mesh></group>)}{noteCount === 0 && <mesh position={[0, -.05, .06]}><planeGeometry args={[.5, .3]} />{mat('#fffaf0')}</mesh>}</>
  }
  if (item.type === 'string-lights') return <StringLightsArt lit={lit} preview={preview} tint={material.color} opacity={material.opacity} />
  if (item.type === 'calendar') return <><RoundedBox castShadow args={[.6, .68, .04]} radius={.02} smoothness={2} position={[0, 0, .02]}>{mat('#f3ead9')}</RoundedBox>{!preview && <CalendarArt />}</>
  if (item.type === 'christmas-tree') return <>
    <mesh castShadow position={[0, .16, 0]}><cylinderGeometry args={[.09, .12, .32, 8]} />{mat('#6b4c39')}</mesh>
    {[[.62, .55, .45], [.5, .5, .82], [.36, .45, 1.06]].map(([r, h, y]) => <mesh castShadow key={y} position={[0, y, 0]}><coneGeometry args={[r, h, 10]} />{mat('#4e7050')}</mesh>)}
    <mesh position={[0, 1.36, 0]}><octahedronGeometry args={[.07]} /><meshStandardMaterial color="#ffd24d" emissive={lit ? '#ffd24d' : '#000000'} emissiveIntensity={lit ? .9 : 0} transparent={material.transparent} opacity={material.opacity} /></mesh>
    {!preview && <TreeLights lit={lit} />}
    {lit && <pointLight color="#ffc66d" intensity={2.4} distance={2.2} position={[0, .8, 0]} />}
  </>
  if (item.type === 'record-player') return <>
    <RoundedBox castShadow args={[1.3, .17, .62]} radius={.03} smoothness={2} position={[0, .135, 0]}>{mat('#8a6048')}</RoundedBox>
    {[[-.54, -.22], [.54, -.22], [-.54, .22], [.54, .22]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .025, z]}><cylinderGeometry args={[.03, .04, .05, 8]} />{mat('#6b4c39')}</mesh>)}
    <mesh position={[-.14, .222, 0]}><cylinderGeometry args={[.34, .34, .02, 28]} />{mat('#b8b2aa')}</mesh>
    {preview ? <mesh position={[-.14, .238, 0]}><cylinderGeometry args={[.32, .32, .015, 28]} />{mat('#221f1d')}</mesh> : <RecordDisc />}
    <mesh castShadow position={[.44, .27, -.2]}><cylinderGeometry args={[.05, .06, .1, 10]} />{mat('#d9c9ae')}</mesh>
    <group position={[.44, .3, -.2]} rotation={[0, -.72, 0]}>
      <mesh castShadow position={[0, .015, .27]}><boxGeometry args={[.028, .028, .54]} />{mat('#cfc7bd')}</mesh>
      <mesh castShadow position={[0, 0, .54]} rotation={[.24, 0, 0]}><boxGeometry args={[.05, .05, .1]} />{mat('#4c4036')}</mesh>
    </group>
    <mesh position={[-.56, .225, .22]}><cylinderGeometry args={[.045, .045, .025, 12]} />{mat('#d9c9ae')}</mesh>
    {!preview && <MusicControls id={item.id} y={.95} />}
  </>
  // A real painter's easel: two front legs leaning back, one rear leg propping it up, a ledge across the front
  // and a canvas standing ON the ledge — the drawing one and the photo one share the frame and differ only in
  // what the canvas shows.
  if (item.type === 'whiteboard' || item.type === 'easel-photo') return <>
    {[-1, 1].map((side) => <mesh castShadow key={side} position={[side * .34, .62, -.04]} rotation={[-.13, 0, side * -.15]}><cylinderGeometry args={[.028, .036, 1.36, 6]} />{mat('#c8a77c')}</mesh>)}
    <mesh castShadow position={[0, .58, -.42]} rotation={[.36, 0, 0]}><cylinderGeometry args={[.026, .034, 1.3, 6]} />{mat('#c8a77c')}</mesh>
    {/* the crossbar the canvas rests on, plus a lower brace tying the front legs together */}
    <mesh castShadow position={[0, .5, .07]}><boxGeometry args={[.78, .05, .12]} />{mat('#b8946a')}</mesh>
    <mesh castShadow position={[0, .16, .04]}><boxGeometry args={[.72, .045, .07]} />{mat('#b8946a')}</mesh>
    {/* the mast continues above the canvas and ends in the little clamp block seen on a real easel */}
    <mesh castShadow position={[0, 1.24, -.09]} rotation={[-.13, 0, 0]}><boxGeometry args={[.07, .34, .06]} />{mat('#c8a77c')}</mesh>
    <mesh castShadow position={[0, 1.36, -.03]} rotation={[-.13, 0, 0]}><boxGeometry args={[.2, .07, .09]} />{mat('#b8946a')}</mesh>
    <group position={[0, .93, .02]} rotation={[-.13, 0, 0]}>
      <RoundedBox castShadow args={[.72, .92, .05]} radius={.015} smoothness={2}>{mat('#e8e2d6')}</RoundedBox>
      <mesh position={[0, 0, .031]}><planeGeometry args={[.66, .86]} /><meshStandardMaterial key={art && !preview ? 'art' : 'plain'} color={art && !preview ? '#ffffff' : '#fbfaf6'} map={!preview ? art ?? undefined : undefined} transparent={material.transparent} opacity={material.opacity} /></mesh>
    </group>
  </>
  if (item.type === 'rocking-chair') return <RockingGroup>
    {[-.19, .19].map((x) => <mesh castShadow key={x} position={[x, .06, .02]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[.3, .022, 6, 14, Math.PI * .8]} />{mat('#6b4c39')}</mesh>)}
    <RoundedBox castShadow args={[.5, .07, .5]} radius={.02} smoothness={2} position={[0, .45, 0]}>{mat('#a97a58')}</RoundedBox>
    {[[-.18, -.18], [.18, -.18], [-.18, .18], [.18, .18]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .28, z]}><cylinderGeometry args={[.025, .03, .32, 6]} />{mat('#6b4c39')}</mesh>)}
    {[-.16, 0, .16].map((x) => <mesh castShadow key={`b${x}`} position={[x, .74, -.22]} rotation={[-.12, 0, 0]}><boxGeometry args={[.06, .5, .03]} />{mat('#a97a58')}</mesh>)}
    <mesh castShadow position={[0, .95, -.245]} rotation={[-.12, 0, 0]}><boxGeometry args={[.44, .06, .04]} />{mat('#8a6048')}</mesh>
  </RockingGroup>
  if (item.type === 'beanbag') return <>
    <mesh castShadow position={[0, .19, 0]} scale={[1, .6, 1]}><sphereGeometry args={[.32, 12, 10]} />{mat('#7d8c9c')}</mesh>
    <mesh castShadow position={[0, .3, -.05]} scale={[.82, .5, .8]}><sphereGeometry args={[.26, 12, 10]} />{mat('#8b99a8')}</mesh>
  </>
  if (item.type === 'mini-fridge') return <>
    <RoundedBox castShadow args={[.56, .84, .54]} radius={.03} smoothness={2} position={[0, .44, 0]}>{mat('#dfe3e0')}</RoundedBox>
    {/* interior front sits .005 proud of the cabinet face — coplanar faces z-fight when the door is open */}
    {lit && <mesh position={[0, .5, .125]}><boxGeometry args={[.46, .6, .3]} /><meshStandardMaterial color="#fff8e8" emissive="#fff3d0" emissiveIntensity={.5} /></mesh>}
    <FridgeDoor open={lit}>
      <RoundedBox castShadow args={[.52, .74, .05]} radius={.02} smoothness={2} position={[.26, 0, .025]}>{mat('#eef1ee')}</RoundedBox>
      <mesh position={[.47, .1, .06]}><boxGeometry args={[.03, .26, .03]} />{mat('#9aa39c')}</mesh>
    </FridgeDoor>
    {lit && <pointLight color="#fff3d0" intensity={1.2} distance={1.2} position={[0, .55, .35]} />}
  </>
  if (item.type === 'hanger') return <>
    {[-.62, .62].map((x) => <group key={x}>
      {[-.14, .14].map((z) => <mesh castShadow key={z} position={[x, .64, z * 1.7]} rotation={[z > 0 ? .2 : -.2, 0, 0]}><cylinderGeometry args={[.024, .03, 1.34, 8]} />{mat('#8a6048')}</mesh>)}
      <mesh castShadow position={[x, .52, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.018, .018, .44, 6]} />{mat('#6b4c39')}</mesh>
    </group>)}
    <mesh castShadow position={[0, 1.26, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.026, .026, 1.36, 10]} />{mat('#6b4c39')}</mesh>
    <mesh castShadow position={[0, .14, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.016, .016, 1.18, 6]} />{mat('#8a6048')}</mesh>
    {/* 셔츠 */}
    <group position={[-.36, 1.26, 0]} rotation={[0, 0, .04]}>
      <mesh position={[0, -.035, 0]}><torusGeometry args={[.03, .008, 6, 10, Math.PI]} />{mat('#4c4036')}</mesh>
      {[-.09, .09].map((dx) => <mesh key={dx} position={[dx, -.1, 0]} rotation={[0, 0, dx > 0 ? -.9 : .9]}><cylinderGeometry args={[.008, .008, .2, 5]} />{mat('#4c4036')}</mesh>)}
      <RoundedBox castShadow args={[.3, .4, .06]} radius={.03} smoothness={2} position={[0, -.34, 0]}><meshStandardMaterial color={material.color ?? '#8a9c82'} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
      {[-.19, .19].map((dx) => <RoundedBox key={dx} castShadow args={[.1, .3, .055]} radius={.025} smoothness={2} position={[dx, -.3, 0]} rotation={[0, 0, dx > 0 ? -.16 : .16]}><meshStandardMaterial color={material.color ?? '#7d9074'} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>)}
      <mesh position={[0, -.17, .032]}><boxGeometry args={[.09, .07, .01]} /><meshStandardMaterial color="#f3ead9" transparent={material.transparent} opacity={material.opacity} /></mesh>
    </group>
    {/* 원피스 */}
    <group position={[.02, 1.26, 0]} rotation={[0, 0, -.03]}>
      <mesh position={[0, -.035, 0]}><torusGeometry args={[.03, .008, 6, 10, Math.PI]} />{mat('#4c4036')}</mesh>
      {[-.08, .08].map((dx) => <mesh key={dx} position={[dx, -.1, 0]} rotation={[0, 0, dx > 0 ? -.95 : .95]}><cylinderGeometry args={[.008, .008, .18, 5]} />{mat('#4c4036')}</mesh>)}
      <RoundedBox castShadow args={[.2, .2, .05]} radius={.02} smoothness={2} position={[0, -.24, 0]}><meshStandardMaterial color={material.color ?? '#b06952'} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
      <mesh castShadow position={[0, -.5, 0]} scale={[1, 1, .32]}><coneGeometry args={[.19, .38, 10]} /><meshStandardMaterial color={material.color ?? '#b06952'} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></mesh>
      <mesh position={[0, -.34, .028]}><boxGeometry args={[.16, .02, .01]} /><meshStandardMaterial color="#8f5240" transparent={material.transparent} opacity={material.opacity} /></mesh>
    </group>
    {/* 자켓 */}
    <group position={[.4, 1.26, 0]} rotation={[0, 0, .05]}>
      <mesh position={[0, -.035, 0]}><torusGeometry args={[.03, .008, 6, 10, Math.PI]} />{mat('#4c4036')}</mesh>
      {[-.1, .1].map((dx) => <mesh key={dx} position={[dx, -.1, 0]} rotation={[0, 0, dx > 0 ? -.85 : .85]}><cylinderGeometry args={[.008, .008, .22, 5]} />{mat('#4c4036')}</mesh>)}
      <RoundedBox castShadow args={[.32, .46, .07]} radius={.03} smoothness={2} position={[0, -.37, 0]}><meshStandardMaterial color={material.color ?? '#607b93'} roughness={.85} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
      {[-.2, .2].map((dx) => <RoundedBox key={dx} castShadow args={[.11, .38, .06]} radius={.028} smoothness={2} position={[dx, -.35, 0]} rotation={[0, 0, dx > 0 ? -.1 : .1]}><meshStandardMaterial color={material.color ?? '#56708a'} roughness={.85} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>)}
      {[-.05, .05].map((dx) => <mesh key={`c${dx}`} position={[dx, -.18, .04]} rotation={[0, 0, dx > 0 ? -.5 : .5]}><boxGeometry args={[.07, .04, .012]} /><meshStandardMaterial color="#4d6478" transparent={material.transparent} opacity={material.opacity} /></mesh>)}
      <mesh position={[0, -.38, .04]}><boxGeometry args={[.015, .34, .012]} /><meshStandardMaterial color="#3f5468" transparent={material.transparent} opacity={material.opacity} /></mesh>
    </group>
    {/* 아래 선반: 신발과 개어둔 옷 */}
    {[[-.34, '#b98a5e'], [-.18, '#b98a5e']].map(([x, color]) => <RoundedBox key={String(x)} castShadow args={[.13, .06, .24]} radius={.02} smoothness={2} position={[x as number, .05, .06]}><meshStandardMaterial color={String(color)} roughness={.8} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>)}
    <RoundedBox castShadow args={[.26, .07, .3]} radius={.02} smoothness={2} position={[.3, .06, .02]}><meshStandardMaterial color="#d9c1a8" roughness={.9} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
    <RoundedBox castShadow args={[.24, .06, .28]} radius={.02} smoothness={2} position={[.31, .12, .02]}><meshStandardMaterial color="#a8bcc9" roughness={.9} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
  </>
  if (item.type === 'led-lamp') return <>
    <mesh castShadow position={[0, .02, 0]}><cylinderGeometry args={[.09, .1, .04, 12]} />{mat('#4c4653')}</mesh>
    <RoundedBox castShadow args={[.035, .3, .035]} radius={.012} smoothness={2} position={[-.08, .19, 0]}>{mat('#5a5462')}</RoundedBox>
    <RoundedBox castShadow args={[.26, .035, .06]} radius={.014} smoothness={2} position={[.03, .35, 0]}>{mat('#5a5462')}</RoundedBox>
    <mesh position={[.05, .329, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[.2, .04]} /><meshStandardMaterial color={lit ? '#eef3ff' : '#c9ced4'} emissive={lit ? '#dfe8ff' : '#000000'} emissiveIntensity={lit ? .75 : 0} side={2} transparent={material.transparent} opacity={material.opacity} /></mesh>
    {lit && <pointLight color="#dce6f8" intensity={.9} distance={1.1} position={[.05, .28, 0]} />}
  </>
  if (item.type === 'star-projector') return <>
    <mesh castShadow position={[0, .05, 0]}><cylinderGeometry args={[.1, .12, .1, 10]} />{mat('#4c4653')}</mesh>
    <mesh castShadow position={[0, .13, 0]}><sphereGeometry args={[.09, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={material.color ?? '#6b6478'} emissive={lit ? '#8f86ad' : '#000000'} emissiveIntensity={lit ? .5 : 0} transparent={material.transparent} opacity={material.opacity} /></mesh>
    {lit && <StarField />}
  </>
  if (item.type === 'profile-board') return <>
    <RoundedBox castShadow args={[1.4, 2.1, .07]} radius={.03} smoothness={2} position={[0, 0, .035]}>{mat('#fbf6ec')}</RoundedBox>
    <mesh position={[0, .36, .073]}><circleGeometry args={[.47, 30]} />{mat('#e2d6c6')}</mesh>
    {!preview && <ProfileBoardFace />}
  </>
  if (item.type.startsWith('video-frame')) {
    const [w, h] = VIDEO_FRAME_SIZES[item.type] ?? VIDEO_FRAME_SIZES['video-frame-3']
    const rotationY = item.rotation?.[1] ?? 0
    const turned = Math.abs(Math.round(rotationY / (Math.PI / 2))) % 2 === 1
    const screenWidth = (turned ? h : w) - .06
    const screenHeight = (turned ? w : h) - .06
    return <>
      <RoundedBox castShadow args={[w, h, .04]} radius={.015} smoothness={2} position={[0, 0, .02]}>{mat('#3a332c')}</RoundedBox>
      <group rotation={[0, 0, -rotationY]}>
        {preview ? <mesh position={[0, 0, .042]}><planeGeometry args={[screenWidth, screenHeight]} />{mat('#20262b')}</mesh> : <VideoScreen id={item.id} width={screenWidth} height={screenHeight} />}
      </group>
    </>
  }
  if (item.type === 'cd-player') return <>
    <RoundedBox castShadow args={[1.34, 1.34, .12]} radius={.05} smoothness={2} position={[0, .04, .06]}>{mat('#f3ead9')}</RoundedBox>
    <mesh position={[0, .1, .121]}><circleGeometry args={[.5, 28]} /><meshStandardMaterial color="#2b2621" roughness={.6} transparent={material.transparent} opacity={material.opacity} /></mesh>
    {preview ? <mesh position={[0, .1, .13]}><circleGeometry args={[.44, 28]} />{mat('#cfd6dc')}</mesh> : <CdDisc />}
    <mesh position={[0, .1, .142]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.045, .045, .03, 12]} />{mat('#d9d3ca')}</mesh>
    <mesh position={[0, -.52, .125]}><boxGeometry args={[.44, .07, .02]} /><meshStandardMaterial color="#2b3236" emissive="#4a6a5e" emissiveIntensity={.35} transparent={material.transparent} opacity={material.opacity} /></mesh>
    <mesh position={[.42, -.52, .13]}><cylinderGeometry args={[.05, .05, .02, 12]} />{mat('#c9a06c')}</mesh>
    <mesh userData={{ excludeFromFit: true }} position={[-.34, -.94, .06]}><boxGeometry args={[.012, .5, .012]} />{mat('#b3a89a')}</mesh>
    <mesh userData={{ excludeFromFit: true }} castShadow position={[-.34, -1.22, .06]}><cylinderGeometry args={[.035, .045, .1, 8]} />{mat('#c9a06c')}</mesh>
    {!preview && <MusicControls id={item.id} y={1.05} />}
  </>
  if (item.type === 'banner') return <>{[.285, -.285].map((y) => <RoundedBox key={y} castShadow args={[2.04, .03, .04]} radius={.012} smoothness={2} position={[0, y, .02]}>{mat('#3a332c')}</RoundedBox>)}{[1.005, -1.005].map((x) => <RoundedBox key={x} castShadow args={[.03, .6, .04]} radius={.012} smoothness={2} position={[x, 0, .02]}>{mat('#3a332c')}</RoundedBox>)}{preview ? <mesh position={[0, 0, .03]}><planeGeometry args={[1.98, .54]} />{mat('#5a4a35')}</mesh> : <BannerArt id={item.id} />}{!preview && !isVisiting() && store?.mode === 'normal' && store.selectedObject === item.id && <Html position={[0, .72, .1]} center zIndexRange={[4, 0]}><section className="object-card banner-popup" onPointerDown={(event) => event.stopPropagation()}><BannerTextInput id={item.id} artwork={store.artworks[item.id]} saveArtwork={store.setArtwork} /></section></Html>}</>
  if (item.type === 'window') return <><mesh castShadow position={[0, 0, .03]}><boxGeometry args={[2.02, 1.38, .06]} />{mat('#8a6048')}</mesh>{preview ? <mesh position={[0, 0, .062]}><planeGeometry args={[1.86, 1.22]} />{mat('#bcd6e8')}</mesh> : <WindowView />}<mesh position={[0, 0, .07]}><boxGeometry args={[.05, 1.32, .02]} />{mat('#8a6048')}</mesh><mesh position={[0, 0, .07]}><boxGeometry args={[1.92, .05, .02]} />{mat('#8a6048')}</mesh></>
  if (item.type === 'curtain') return <><mesh castShadow position={[0, 1.33, .08]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.035, .035, 1.52, 8]} />{mat('#6b4c39')}</mesh>{[-.58, -.29, 0, .3, .58].map((x, index) => <RoundedBox key={x} castShadow args={[.3, 2.58, .1]} radius={.045} smoothness={2} position={[x, -.05, .04 + (index % 2) * .025]}>{mat(index % 2 ? '#d9c1a8' : '#c9a98c')}</RoundedBox>)}</>
  if (item.type === 'fireplace') return <>
    <RoundedBox castShadow args={[1.3, .95, .5]} radius={.03} smoothness={2} position={[0, .475, 0]}>{mat('#9c5b45')}</RoundedBox>
    <RoundedBox castShadow args={[1.44, .1, .58]} radius={.03} smoothness={2} position={[0, .98, 0]}>{mat('#6b4c39')}</RoundedBox>
    <mesh position={[0, .38, .21]}><boxGeometry args={[.78, .58, .12]} /><meshStandardMaterial color="#241b16" transparent={material.transparent} opacity={material.opacity} /></mesh>
    {[-.18, .02, .18].map((x, index) => <mesh castShadow key={x} position={[x, .17, .24]} rotation={[0, index * .5, Math.PI / 2 - .12 + index * .1]}><cylinderGeometry args={[.045, .045, .34, 7]} /><meshStandardMaterial color="#4c3428" transparent={material.transparent} opacity={material.opacity} /></mesh>)}
    {lit && <FireArt />}
    {lit && <FlickerLight position={[0, .45, .38]} color="#ff9a3c" base={3.2} amp={.9} distance={2.6} />}
  </>
  if (item.type === 'glass-shelf') return <>
    {[[-.58, -.22], [.58, -.22], [-.58, .22], [.58, .22]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .32, z]}><cylinderGeometry args={[.02, .02, .64, 8]} /><meshStandardMaterial color={material.color ?? '#c3ced4'} metalness={.6} roughness={.25} transparent opacity={preview ? material.opacity : .75} /></mesh>)}
    <mesh castShadow position={[0, .645, 0]}><boxGeometry args={[1.3, .03, .62]} /><meshStandardMaterial color={material.color ?? '#dfeaf0'} metalness={.15} roughness={.06} transparent opacity={preview ? material.opacity : .34} /></mesh>
    <mesh position={[0, .3, 0]}><boxGeometry args={[1.24, .025, .56]} /><meshStandardMaterial color={material.color ?? '#dfeaf0'} metalness={.15} roughness={.06} transparent opacity={preview ? material.opacity : .22} /></mesh>
  </>
  if (item.type === 'coffee-table') return <><RoundedBox castShadow args={[1.3, .08, .6]} radius={.03} smoothness={2} position={[0, .31, 0]}>{mat('#a97a58')}</RoundedBox>{[[-.55, -.22], [.55, -.22], [-.55, .22], [.55, .22]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .14, z]}><cylinderGeometry args={[.04, .05, .28, 8]} />{mat('#6b4c39')}</mesh>)}</>
  if (item.type === 'tv') return <>
    <RoundedBox castShadow args={[1.35, .32, .48]} radius={.03} smoothness={2} position={[0, .16, 0]}>{mat('#8a6048')}</RoundedBox>
    <RoundedBox castShadow args={[1.24, .72, .07]} radius={.02} smoothness={2} position={[0, .72, 0]}>{mat('#2e2a28')}</RoundedBox>
    <mesh position={[0, .72, .04]}><planeGeometry args={[1.14, .62]} /><meshStandardMaterial color={lit ? '#9fc4dd' : '#171a1e'} emissive={lit ? '#8fb8d4' : '#000000'} emissiveIntensity={lit ? .85 : 0} transparent={material.transparent} opacity={material.opacity} /></mesh>
    {lit && <pointLight color="#a8c8e8" intensity={1.4} distance={1.8} position={[0, .72, .4]} />}
  </>
  if (item.type === 'wardrobe') return <>
    <RoundedBox castShadow args={[1.3, .06, .55]} radius={.02} smoothness={2} position={[0, 1.87, 0]}>{mat('#a97a58')}</RoundedBox>
    <RoundedBox castShadow args={[1.3, .06, .55]} radius={.02} smoothness={2} position={[0, .03, 0]}>{mat('#a97a58')}</RoundedBox>
    {[-.62, .62].map((x) => <RoundedBox castShadow key={x} args={[.06, 1.9, .55]} radius={.02} smoothness={2} position={[x, .95, 0]}>{mat('#a97a58')}</RoundedBox>)}
    <mesh position={[0, .95, -.25]}><boxGeometry args={[1.24, 1.84, .05]} />{mat('#8a6048')}</mesh>
    <mesh position={[0, 1.62, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[.02, .02, 1.2, 8]} />{mat('#c9c1b6')}</mesh>
    {[[-.36, '#8a9c82', .62], [-.04, '#b06952', .7], [.3, '#607b93', .58]].map(([x, color, drop]) => <group key={String(x)} position={[x as number, 1.62, 0]}>
      <mesh position={[0, -.05, 0]}><boxGeometry args={[.02, .1, .02]} />{mat('#4c4036')}</mesh>
      <RoundedBox castShadow args={[.3, drop as number, .12]} radius={.04} smoothness={2} position={[0, -.12 - (drop as number) / 2, 0]}><meshStandardMaterial color={material.color ?? String(color)} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
    </group>)}
    <Swing open={lit} angle={-1.15} pivot={[-.6, .95, .28]}>
      <RoundedBox castShadow args={[.6, 1.74, .04]} radius={.02} smoothness={2} position={[-.3, .95, .28]}>{mat('#c9a37b')}</RoundedBox>
      <mesh position={[-.06, .95, .31]}><cylinderGeometry args={[.014, .014, .16, 6]} />{mat('#4c4036')}</mesh>
    </Swing>
    <Swing open={lit} angle={1.15} pivot={[.6, .95, .28]}>
      <RoundedBox castShadow args={[.6, 1.74, .04]} radius={.02} smoothness={2} position={[.3, .95, .28]}>{mat('#c9a37b')}</RoundedBox>
      <mesh position={[.06, .95, .31]}><cylinderGeometry args={[.014, .014, .16, 6]} />{mat('#4c4036')}</mesh>
    </Swing>
  </>
  if (item.type === 'fish-tank') return <>
    <mesh position={[0, .06, 0]}><boxGeometry args={[.64, .06, .3]} /><meshStandardMaterial color="#d9c9ae" transparent={material.transparent} opacity={material.opacity} /></mesh>
    <mesh position={[0, .24, 0]}><boxGeometry args={[.62, .3, .27]} /><meshStandardMaterial color="#4a7d8f" transparent opacity={preview ? material.opacity : .45} /></mesh>
    {!preview && <TankFish color="#e88a4f" y={.24} phase={0} speed={.9} />}
    {!preview && <TankFish color="#d9a441" y={.31} phase={2.4} speed={1.3} />}
    <RoundedBox args={[.68, .42, .32]} radius={.02} smoothness={2} position={[0, .23, 0]}><meshStandardMaterial color="#bcd6e8" transparent opacity={preview ? material.opacity : .18} /></RoundedBox>
  </>
  if (item.type === 'candle') return <>
    <mesh castShadow position={[0, .1, 0]}><cylinderGeometry args={[.085, .095, .2, 10]} />{mat('#f3ead9')}</mesh>
    <mesh position={[0, .21, 0]}><cylinderGeometry args={[.008, .008, .03, 4]} /><meshStandardMaterial color="#3f3a33" transparent={material.transparent} opacity={material.opacity} /></mesh>
    {lit && <mesh position={[0, .25, 0]} scale={[1, 1.6, 1]}><sphereGeometry args={[.028, 8, 6]} /><meshStandardMaterial color="#ffd27a" emissive="#ffb84d" emissiveIntensity={1.6} /></mesh>}
    {lit && <FlickerLight position={[0, .3, 0]} color="#ffc66d" base={1.6} amp={.5} distance={1.4} />}
  </>
  if (item.type.startsWith('wall-art')) return <><mesh castShadow position={[0, 0, .008]}><boxGeometry args={[1.4, 2.1, .016]} /><meshStandardMaterial color={material.color ?? '#d9aa55'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh position={[0, 0, .019]}><planeGeometry args={[1.34, 2.04]} /><meshStandardMaterial key={art && !preview ? 'art' : 'plain'} color={art && !preview ? '#ffffff' : material.color ?? '#e8dcc7'} map={!preview ? art ?? undefined : undefined} roughness={.85} transparent={material.transparent} opacity={material.opacity} /></mesh></>
  if (item.type === 'wall-shelf') return <RoundedBox args={[2.1, .12, .7]} radius={.025} smoothness={2} position={[0, -.27, .35]}><meshStandardMaterial color={material.color ?? '#8a6048'} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
  if (item.type === 'cushion') return <RoundedBox castShadow args={[.32, .12, .32]} radius={.09} smoothness={2} position={[0, .06, 0]}><meshStandardMaterial color={material.color ?? '#cf9a92'} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></RoundedBox>
  if (item.type === 'plush') return <><mesh castShadow position={[0, .13, 0]}><sphereGeometry args={[.13, 10, 8]} /><meshStandardMaterial color={material.color ?? '#cba24d'} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></mesh>{[-.08, .08].map((x) => <mesh castShadow key={x} position={[x, .24, 0]}><sphereGeometry args={[.045, 8, 6]} /><meshStandardMaterial color={material.color ?? '#cba24d'} roughness={.9} transparent={material.transparent} opacity={material.opacity} /></mesh>)}</>
  if (item.type === 'mug' || item.type === 'cup') return <><mesh castShadow position={[0, .07, 0]}><cylinderGeometry args={[.075, .075, .14, 16]} /><meshStandardMaterial color={material.color ?? '#f3ead9'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh position={[.09, .07, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[.045, .012, 6, 12]} /><meshStandardMaterial color={material.color ?? '#8a6a52'} transparent={material.transparent} opacity={material.opacity} /></mesh></>
  if (item.type === 'book-prop') return <>{[0, 1].map((index) => <mesh castShadow key={index} position={[index * .03, .02 + index * .045, index * -.02]} rotation={[0, index * .3, 0]}><boxGeometry args={[.26, .04, .19]} /><meshStandardMaterial color={material.color ?? (index ? '#b06952' : '#8a9c82')} transparent={material.transparent} opacity={material.opacity} /></mesh>)}</>
  if (item.type === 'speaker') return <><RoundedBox castShadow args={[.16, .26, .14]} radius={.02} smoothness={2} position={[0, .13, 0]}><meshStandardMaterial color={material.color ?? '#4c4038'} transparent={material.transparent} opacity={material.opacity} /></RoundedBox><mesh position={[0, .18, .071]}><circleGeometry args={[.045, 14]} /><meshStandardMaterial color="#2b2621" transparent={material.transparent} opacity={material.opacity} /></mesh><mesh position={[0, .08, .071]}><circleGeometry args={[.03, 14]} /><meshStandardMaterial color="#2b2621" transparent={material.transparent} opacity={material.opacity} /></mesh></>
  if (item.type === 'animated-poster') return <><mesh castShadow position={[0, 0, .04]}><boxGeometry args={[1.4, 2.1, .03]} /><meshStandardMaterial color={material.color ?? '#4a4238'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh position={[0, 0, .058]}><planeGeometry args={[1.2, 1.9]} />{preview ? <meshStandardMaterial color={material.color ?? '#2c3b57'} transparent opacity={material.opacity} /> : <NightSkyArt />}</mesh></>
  if (item.type.startsWith('photo-frame')) return <group rotation={item.wallId ? [0, 0, 0] : [-Math.PI / 2, 0, 0]}><mesh castShadow position={[0, 0, .006]}><boxGeometry args={[.34, .34, .012]} /><meshStandardMaterial color={material.color ?? '#8a6a52'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh position={[0, 0, .014]}><planeGeometry args={[artAspect >= 1 ? .33 : .33 * artAspect, artAspect >= 1 ? .33 / artAspect : .33]} />{art && !preview
    ? <meshBasicMaterial key="art" map={art} transparent={material.transparent} opacity={material.opacity} />
    : <meshStandardMaterial key="plain" color="#8a9c82" transparent={material.transparent} opacity={material.opacity} />}</mesh></group>
  if (item.type === 'computer') return <><mesh castShadow position={[0, .6, -.08]}><boxGeometry args={[1.06, .64, .1]} />{mat('#4b4c50')}</mesh><mesh castShadow position={[0, .15, -.08]}><boxGeometry args={[.12, .32, .12]} />{mat('#49454a')}</mesh><mesh castShadow position={[0, .02, -.02]}><boxGeometry args={[.56, .07, .3]} />{mat('#49454a')}</mesh><mesh castShadow position={[-.05, .025, .43]}><boxGeometry args={[.66, .05, .25]} />{mat('#e9deca')}</mesh></>
  if (item.type === 'rug') return <><RoundedBox castShadow args={[2.1, .06, 1.4]} radius={.025} smoothness={2} position={[0, .03, 0]}>{mat('#b98363')}</RoundedBox><RoundedBox args={[1.74, .012, 1.04]} radius={.02} smoothness={2} position={[0, .063, 0]}>{mat('#e8dcc7')}</RoundedBox></>
  if (item.type === 'plant') return <><mesh castShadow position={[0, .32, 0]}><cylinderGeometry args={[.34, .26, .62, 10]} />{mat('#b06952')}</mesh>{[[-.28, .9, 0], [.25, 1.05, .08], [0, 1.18, -.22]].map(([x, y, z], index) => <mesh castShadow key={index} position={[x, y, z]}><sphereGeometry args={[.32, 8, 8]} />{mat('#8a9c82')}</mesh>)}</>
  if (item.type === 'lamp') return <><mesh castShadow position={[0, .225, 0]}><cylinderGeometry args={[.14, .18, .45, 10]} />{mat('#6b4c39')}</mesh><mesh castShadow position={[0, .76, 0]}><cylinderGeometry args={[.35, .2, .5, 12]} />{mat('#f3ead9')}</mesh></>
  if (item.type === 'cabinet') return <><RoundedBox castShadow args={[1.4, 1.1, .7]} radius={.04} smoothness={2} position={[0, .55, 0]}>{mat('#a97a58')}</RoundedBox>{[.72, .33].map((y) => <RoundedBox key={y} args={[1.14, .28, .03]} radius={.02} smoothness={2} position={[0, y, .37]}>{mat('#c9a37b')}</RoundedBox>)}</>
  if (item.type === 'bed') return <><RoundedBox castShadow args={[1.4, .16, 2.1]} radius={.03} smoothness={2} position={[0, .24, 0]}>{mat('#a97a58')}</RoundedBox><RoundedBox castShadow args={[1.4, 1.3, .14]} radius={.06} smoothness={2} position={[0, .87, -.98]}>{mat('#6b4c39')}</RoundedBox><RoundedBox castShadow args={[1.32, .26, 2]} radius={.07} smoothness={2} position={[0, .45, 0]}>{mat('#e8dcc7')}</RoundedBox></>
  if (item.type === 'desk') return <><RoundedBox castShadow args={[1.4, .09, .7]} radius={.025} smoothness={2} position={[0, 1.03, 0]}>{mat('#a97a58')}</RoundedBox>{[[-.55, -.22], [.55, -.22], [-.55, .22], [.55, .22]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .48, z]}><cylinderGeometry args={[.045, .07, 1.02, 10]} />{mat('#6b4c39')}</mesh>)}</>
  if (item.type === 'chair') return <><RoundedBox castShadow args={[.58, .12, .54]} radius={.035} smoothness={2} position={[0, .48, 0]}>{mat('#a97a58')}</RoundedBox><RoundedBox castShadow args={[.58, .55, .1]} radius={.035} smoothness={2} position={[0, .75, -.22]}>{mat('#6b4c39')}</RoundedBox>{[[-.23, -.2], [.23, -.2], [-.23, .2], [.23, .2]].map(([x, z]) => <mesh castShadow key={`${x}:${z}`} position={[x, .23, z]}><cylinderGeometry args={[.035, .045, .46, 8]} />{mat('#6b4c39')}</mesh>)}</>
  if (item.type === 'sofa') return <><RoundedBox castShadow args={[2, .32, .64]} radius={.06} smoothness={2} position={[0, .34, 0]}>{mat('#cf9a92')}</RoundedBox>{[-.94, .94].map((x) => <RoundedBox castShadow key={x} args={[.22, .5, .68]} radius={.08} smoothness={2} position={[x, .5, 0]}>{mat('#cf9a92')}</RoundedBox>)}<RoundedBox castShadow args={[1.56, .62, .22]} radius={.09} smoothness={2} rotation={[.12, 0, 0]} position={[0, .75, -.24]}>{mat('#cf9a92')}</RoundedBox></>
  if (item.type === 'bookshelf') return <>{[-1.45, 1.45].map((x) => <mesh castShadow key={x} position={[x, 2.15, 0]}><boxGeometry args={[.16, 4.3, .48]} />{mat('#a97a58')}</mesh>)}{[.3, 1.4, 2.5, 3.6, 4.24].map((y) => <mesh castShadow key={y} position={[0, y, 0]}><boxGeometry args={[3.05, .12, .52]} />{mat('#b98363')}</mesh>)}</>
  if (item.type === 'clock') return <><mesh castShadow position={[0, 0, .03]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.4, .4, .06, 20]} />{mat('#6b4c39')}</mesh><mesh position={[0, 0, .062]}><circleGeometry args={[.33, 20]} />{mat('#f3ead9')}</mesh></>
  if (item.type === 'poster' || item.type === 'photo') return <><mesh castShadow position={[0, 0, .008]}><boxGeometry args={[1.4, 2.1, .016]} />{mat('#8a6a52')}</mesh><mesh position={[0, 0, .019]}><planeGeometry args={[1.34, 2.04]} />{mat('#d9c9ae')}</mesh></>
  return <><mesh castShadow position={[0, .2, 0]}><cylinderGeometry args={[.14, .2, .4, 10]} /><meshStandardMaterial color={material.color ?? '#a1795a'} transparent={material.transparent} opacity={material.opacity} /></mesh><mesh castShadow position={[0, .47, 0]}><sphereGeometry args={[.18, 10, 8]} /><meshStandardMaterial color={material.color ?? '#e0b17b'} transparent={material.transparent} opacity={material.opacity} /></mesh></>
}

export function InventoryPreview() {
  const group = useRef<Group>(null)
  const { furniture, preview, previewValid, beginPreviewDrag, endPreviewDrag, placePreview } = useRoomStore()
  if (!preview) return null
  const wall = preview.wallId ? wallSurfaces[preview.wallId] : null
  return <group ref={group} position={preview.position} rotation={wall ? [0, 0, 0] : preview.rotation} onPointerDown={(event) => { event.stopPropagation(); beginPreviewDrag(); (event.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(event.pointerId) }} onPointerUp={(event) => { event.stopPropagation(); endPreviewDrag(); (event.target as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(event.pointerId); if (previewValid) placePreview() }} onPointerCancel={(event) => { endPreviewDrag(); (event.target as unknown as { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(event.pointerId) }}>
    {wall ? <group rotation={wall.rotation}><group rotation={[0, 0, preview.rotation[1]]}><FittedMesh item={preview}><ItemVisual item={preview} preview /></FittedMesh></group></group> : <FittedMesh item={preview}><ItemVisual item={preview} preview /></FittedMesh>}
  </group>
}

// built-in looping scene for the 무빙 포스터: twinkling stars, a drifting shooting star and a moonlit hill,
// drawn onto a small canvas each frame and streamed to the plane as a CanvasTexture
function drawNight(canvas: HTMLCanvasElement, t: number) {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#1d2a4a'); sky.addColorStop(1, '#3a4a6b')
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#f3e9c9'
  ctx.beginPath(); ctx.arc(w * .72, h * .2, 15 + Math.sin(t * .8) * 1.2, 0, Math.PI * 2); ctx.fill()
  for (let i = 0; i < 26; i++) {
    const x = ((i * 137.5) % 97) / 97 * w
    const y = ((i * 71.3) % 89) / 89 * h * .7
    ctx.globalAlpha = .35 + .65 * Math.abs(Math.sin(t * (1.1 + (i % 5) * .3) + i))
    ctx.fillStyle = '#ffe9b0'
    const r = 1.4 + (i % 3)
    ctx.fillRect(x - r / 2, y - r / 2, r, r)
  }
  ctx.globalAlpha = 1
  const phase = (t % 6) / 6
  if (phase < .18) {
    const p = phase / .18
    const sx = w * (.15 + p * .55), sy = h * (.1 + p * .28)
    ctx.strokeStyle = `rgba(255, 240, 200, ${1 - p})`; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 28, sy - 13); ctx.stroke()
  }
  ctx.fillStyle = '#2c3b33'
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * .84); ctx.quadraticCurveTo(w * .3, h * .74, w * .55, h * .87); ctx.quadraticCurveTo(w * .8, h * .97, w, h * .86); ctx.lineTo(w, h); ctx.closePath(); ctx.fill()
}

// Explorer rooms keep their visual motion, but canvas textures only redraw at 12fps there. That restores a real
// preview without bringing back the expensive per-room 60fps texture uploads.
const usePreviewFrameSkip = () => {
  const readOnly = !!useOptionalRoomStore()?.readOnly
  const last = useRef(-Infinity)
  return (time: number) => {
    if (!readOnly) return false
    if (time - last.current < 1 / 12) return true
    last.current = time
    return false
  }
}

function NightSkyArt() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 288
    drawNight(canvas, 0)
    const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace
    return t
  }, [])
  const skip = usePreviewFrameSkip()
  useFrame(({ clock }) => { if (skip(clock.elapsedTime)) return; drawNight(texture.image as HTMLCanvasElement, clock.elapsedTime); texture.needsUpdate = true })
  return <meshStandardMaterial map={texture} roughness={.9} />
}

// shared flicker for fireplace/candle light
function FlickerLight({ position, color, base, amp, distance }: { position: [number, number, number]; color: string; base: number; amp: number; distance: number }) {
  const ref = useRef<PointLight>(null)
  useFrame(({ clock }) => { const t = clock.elapsedTime; if (ref.current) ref.current.intensity = base + Math.sin(t * 11) * amp + Math.sin(t * 23 + 1) * amp * .5 })
  return <pointLight ref={ref} color={color} intensity={base} distance={distance} position={position} />
}

function TankFish({ color, y, phase, speed }: { color: string; y: number; phase: number; speed: number }) {
  const ref = useRef<Group>(null)
  useFrame(({ clock }) => { const t = clock.elapsedTime * speed + phase; if (ref.current) { ref.current.position.x = Math.sin(t) * .18; ref.current.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI } })
  return <group ref={ref} position={[0, y, 0]}>
    <mesh><sphereGeometry args={[.035, 8, 6]} /><meshStandardMaterial color={color} /></mesh>
    <mesh position={[-.045, 0, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[.022, .04, 6]} /><meshStandardMaterial color={color} /></mesh>
  </group>
}

function drawFire(canvas: HTMLCanvasElement, t: number) {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const flames: [number, number, string][] = [[.3, 1.15, '#ff8a2b'], [.7, .95, '#ff9a3c'], [.5, 1.35, '#ffc25e']]
  flames.forEach(([fx, scale, color], index) => {
    const wob = Math.sin(t * (9 + index * 2.4) + index * 2) * .06
    const fh = h * .62 * scale * (1 + Math.sin(t * (11 + index * 3) + index) * .1)
    const cx = w * (fx + wob)
    const grad = ctx.createLinearGradient(0, h, 0, h - fh)
    grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(255, 220, 120, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(cx - w * .16 * scale, h)
    ctx.quadraticCurveTo(cx - w * .1, h - fh * .55, cx, h - fh)
    ctx.quadraticCurveTo(cx + w * .1, h - fh * .55, cx + w * .16 * scale, h)
    ctx.closePath(); ctx.fill()
  })
}

function FireArt() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    drawFire(canvas, 0)
    const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace
    return t
  }, [])
  const skip = usePreviewFrameSkip()
  useFrame(({ clock }) => { if (skip(clock.elapsedTime)) return; drawFire(texture.image as HTMLCanvasElement, clock.elapsedTime); texture.needsUpdate = true })
  return <mesh position={[0, .4, .285]}><planeGeometry args={[.6, .5]} /><meshBasicMaterial map={texture} transparent depthWrite={false} /></mesh>
}

// the view through the window follows the room's time of day; day and dusk drift clouds, night reuses the star field
function drawSkyView(canvas: HTMLCanvasElement, t: number, time: 'day' | 'evening' | 'night') {
  if (time === 'night') return drawNight(canvas, t)
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  if (time === 'day') { sky.addColorStop(0, '#7fbde4'); sky.addColorStop(1, '#c8e4f2') } else { sky.addColorStop(0, '#e88a4f'); sky.addColorStop(1, '#f2c98e') }
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = time === 'day' ? '#ffe9a8' : '#ff9a3c'
  ctx.beginPath(); ctx.arc(w * .74, h * (time === 'day' ? .22 : .58), time === 'day' ? 11 : 15, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = time === 'day' ? 'rgba(255,255,255,.85)' : 'rgba(255,226,190,.8)'
  for (let i = 0; i < 3; i++) {
    const cw = w * (.34 + (i % 2) * .1)
    const x = ((t * (5 + i * 2.4) + i * 67) % (w + cw)) - cw
    const y = h * (.2 + i * .18)
    ctx.beginPath(); ctx.ellipse(x + cw / 2, y, cw / 2, h * .06, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = time === 'day' ? '#7fa06b' : '#5f6e52'
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h * .86); ctx.quadraticCurveTo(w * .35, h * .74, w * .62, h * .88); ctx.quadraticCurveTo(w * .85, h * .99, w, h * .9); ctx.lineTo(w, h); ctx.closePath(); ctx.fill()
}

function WindowView() {
  const timeOfDay = useOptionalRoomStore()?.timeOfDay ?? 'day'
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 108
    drawSkyView(canvas, 0, timeOfDay)
    const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace
    return t
  }, [])
  const skip = usePreviewFrameSkip()
  useFrame(({ clock }) => { if (skip(clock.elapsedTime)) return; drawSkyView(texture.image as HTMLCanvasElement, clock.elapsedTime, timeOfDay); texture.needsUpdate = true })
  return <mesh position={[0, 0, .062]}><planeGeometry args={[1.86, 1.22]} /><meshBasicMaterial map={texture} /></mesh>
}

// scrolling LED banner — the text lives in the artworks map (plain string, not a data URL), editable from the object card
function drawBanner(canvas: HTMLCanvasElement, t: number, text: string) {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width, h = canvas.height
  ctx.fillStyle = '#1c1712'; ctx.fillRect(0, 0, w, h)
  ctx.font = 'bold 34px "Pretendard Variable", Pretendard, sans-serif'
  ctx.textBaseline = 'middle'
  const span = ctx.measureText(text).width + w * .4
  const x = w - ((t * 70) % (span + w))
  ctx.shadowColor = '#ff9a3c'; ctx.shadowBlur = 12
  ctx.fillStyle = '#ffb84d'
  ctx.fillText(text, x, h / 2 + 2)
  ctx.fillText(text, x + span + w, h / 2 + 2)
  ctx.shadowBlur = 0
}

function BannerArt({ id }: { id: string }) {
  const text = useOptionalRoomStore()?.artworks[id] || 'WELCOME ♥'
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 88
    drawBanner(canvas, 0, text)
    const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace
    return t
  }, [])
  const skip = usePreviewFrameSkip()
  useFrame(({ clock }) => { if (skip(clock.elapsedTime)) return; drawBanner(texture.image as HTMLCanvasElement, clock.elapsedTime, text); texture.needsUpdate = true })
  return <mesh position={[0, 0, .03]}><planeGeometry args={[1.98, .54]} /><meshBasicMaterial map={texture} /></mesh>
}

function StringLightsArt({ lit, preview, tint, opacity }: { lit: boolean; preview: boolean; tint?: string; opacity: number }) {
  const bulbs = useRef<(MeshStandardMaterial | null)[]>([])
  const glows = useRef<(PointLight | null)[]>([])
  const xs = [-.9, -.6, -.3, 0, .3, .6, .9]
  const sag = (x: number) => -.16 * (1 - (x / .95) ** 2) - .04
  const colors = ['#ffb84d', '#ec8377', '#7fb377', '#ffb84d', '#7f9cd0', '#ec8377', '#ffb84d']
  // every bulb carries its own small light, pulsing in the same rhythm as its glow
  useFrame(({ clock }) => {
    const pulse = (index: number) => .5 + Math.sin(clock.elapsedTime * 2.4 + index * 1.1) * .28
    bulbs.current.forEach((bulbMat, index) => { if (bulbMat) bulbMat.emissiveIntensity = lit ? pulse(index) : 0 })
    glows.current.forEach((glow, index) => { if (glow) glow.intensity = lit ? pulse(index) * .45 : 0 })
  })
  return <>
    {xs.slice(0, -1).map((x, index) => { const nx = xs[index + 1]; const midY = (sag(x) + sag(nx)) / 2; return <mesh key={x} position={[(x + nx) / 2, midY + .12, 0]} rotation={[0, 0, Math.atan2(sag(nx) - sag(x), nx - x)]}><boxGeometry args={[.31, .012, .012]} /><meshStandardMaterial color={tint ?? '#5a4c3f'} transparent={preview} opacity={opacity} /></mesh> })}
    {xs.map((x, index) => <mesh key={`b${x}`} position={[x, sag(x), 0]}><sphereGeometry args={[.05, 8, 8]} /><meshStandardMaterial ref={(ref) => { bulbs.current[index] = ref }} color={tint ?? colors[index]} emissive={colors[index]} emissiveIntensity={0} transparent={preview} opacity={opacity} /></mesh>)}
    {lit && !preview && xs.map((x, index) => <pointLight key={`l${x}`} ref={(ref) => { glows.current[index] = ref }} color={colors[index]} intensity={.3} distance={.55} position={[x, sag(x), .1]} />)}
  </>
}

function TreeLights({ lit }: { lit: boolean }) {
  const bulbs = useRef<(MeshStandardMaterial | null)[]>([])
  const spots: [number, number, number, string][] = [[-.3, .48, .42, '#f2a8a0'], [.28, .58, .38, '#a8c8a2'], [-.2, .78, .34, '#ffd27a'], [.22, .88, .3, '#a8b8d8'], [-.14, 1.05, .24, '#f2a8a0'], [.12, 1.14, .2, '#ffd27a']]
  useFrame(({ clock }) => { const t = clock.elapsedTime; bulbs.current.forEach((bulbMat, index) => { if (bulbMat) bulbMat.emissiveIntensity = lit ? (Math.sin(t * 3 + index * 2.1) > 0 ? 1.1 : .15) : 0 }) })
  return <>{spots.map(([x, y, z, color], index) => <mesh key={index} position={[x, y, z]}><sphereGeometry args={[.032, 8, 6]} /><meshStandardMaterial ref={(ref) => { bulbs.current[index] = ref }} color={color} emissive={color} emissiveIntensity={0} /></mesh>)}</>
}

function RecordDisc() {
  const disc = useRef<Group>(null)
  const playing = !!useOptionalRoomStore()?.musicTrack
  useFrame((_, delta) => { if (disc.current && playing) disc.current.rotation.y += delta * 3.2 })
  // a plain black disc looks motionless however fast it turns — the light label wedge and rim ticks are what
  // actually sell the spin from the room's fixed camera
  return <group ref={disc} position={[-.14, .238, 0]}>
    <mesh><cylinderGeometry args={[.32, .32, .016, 32]} /><meshStandardMaterial color="#1e1c1a" roughness={.42} /></mesh>
    {[.14, .2, .26].map((radius) => <mesh key={radius} position={[0, .009, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[radius, .003, 4, 28]} /><meshStandardMaterial color="#3d3833" /></mesh>)}
    <mesh position={[0, .01, 0]}><cylinderGeometry args={[.11, .11, .006, 20]} /><meshStandardMaterial color="#c96a4e" /></mesh>
    <mesh position={[.055, .014, 0]}><boxGeometry args={[.1, .004, .035]} /><meshStandardMaterial color="#f3ead9" /></mesh>
    <mesh position={[0, .014, 0]}><cylinderGeometry args={[.015, .015, .008, 8]} /><meshStandardMaterial color="#f3ead9" /></mesh>
    {[0, 1, 2].map((index) => <mesh key={index} position={[Math.cos(index * 2.094) * .29, .011, Math.sin(index * 2.094) * .29]}><boxGeometry args={[.05, .004, .018]} /><meshStandardMaterial color={['#f3ead9', '#8a9c82', '#e8c07a'][index]} /></mesh>)}
  </group>
}

function CdDisc() {
  const disc = useRef<Group>(null)
  const playing = !!useOptionalRoomStore()?.musicTrack
  // wall-mounted, so the CD turns about its facing axis (local z)
  useFrame((_, delta) => { if (disc.current && playing) disc.current.rotation.z -= delta * 4 })
  return <group ref={disc} position={[0, .1, .13]}>
    <mesh><circleGeometry args={[.44, 32]} /><meshStandardMaterial color="#dfe4e8" metalness={.75} roughness={.22} side={2} /></mesh>
    {[0, 1, 2, 3, 4, 5].map((index) => <mesh key={index} position={[Math.cos(index * 1.047) * .3, Math.sin(index * 1.047) * .3, .002]} rotation={[0, 0, index * 1.047]}><planeGeometry args={[.22, .07]} /><meshStandardMaterial color={['#9fd0e8', '#c9a8e0', '#f2c98e', '#a8d8b8', '#f0a8b0', '#bcd6e8'][index]} metalness={.5} roughness={.3} /></mesh>)}
    <mesh position={[0, 0, .004]}><circleGeometry args={[.14, 20]} /><meshStandardMaterial color="#eef2f4" metalness={.4} roughness={.35} /></mesh>
    <mesh position={[0, 0, .006]}><circleGeometry args={[.05, 16]} /><meshStandardMaterial color="#2b2621" /></mesh>
    <mesh position={[.24, 0, .004]}><planeGeometry args={[.12, .03]} /><meshStandardMaterial color="#5a6b74" /></mesh>
  </group>
}

// pivots near the runners so the whole chair sways gently
function RockingGroup({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null)
  useFrame(({ clock }) => { if (group.current) group.current.rotation.x = Math.sin(clock.elapsedTime * 1.1) * .028 })
  return <group ref={group} position={[0, .06, 0]}><group position={[0, -.06, 0]}>{children}</group></group>
}

function FridgeDoor({ open, children }: { open: boolean; children: ReactNode }) {
  const hinge = useRef<Group>(null)
  useLayoutEffect(() => { if (hinge.current) hinge.current.rotation.y = open ? -1.5 : 0 }, [])
  useFrame((_, delta) => { if (hinge.current) hinge.current.rotation.y += ((open ? -1.5 : 0) - hinge.current.rotation.y) * Math.min(1, delta * 6) })
  return <group ref={hinge} position={[-.26, .44, .27]}>{children}</group>
}

function StarField() {
  const field = useRef<Group>(null)
  useFrame((_, delta) => { if (field.current) field.current.rotation.y += delta * .12 })
  const dots = Array.from({ length: 22 }, (_, index) => {
    const azimuth = index * 2.39996; const height = .3 + ((index * 37) % 23) / 23 * 1.4; const radius = 1.1 + ((index * 17) % 13) / 13 * .7
    return [Math.cos(azimuth) * radius, height, Math.sin(azimuth) * radius] as [number, number, number]
  })
  return <group ref={field} position={[0, .1, 0]}>{dots.map((position, index) => <mesh key={index} position={position} userData={{ excludeFromFit: true }}><sphereGeometry args={[.022, 6, 5]} /><meshStandardMaterial color="#cfd8ff" emissive="#aab8ff" emissiveIntensity={1.6} /></mesh>)}</group>
}

function CalendarArt() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 148
    const ctx = canvas.getContext('2d')!
    const now = new Date()
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(0, 0, 128, 148)
    ctx.fillStyle = '#b3563f'; ctx.fillRect(0, 0, 128, 34)
    ctx.fillStyle = '#fff8ed'; ctx.font = 'bold 19px "Pretendard Variable", Pretendard, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(`${now.getMonth() + 1}월`, 64, 24)
    ctx.fillStyle = '#3f3a33'; ctx.font = 'bold 58px "Pretendard Variable", Pretendard, sans-serif'
    ctx.fillText(String(now.getDate()), 64, 102)
    ctx.fillStyle = '#8a7a6a'; ctx.font = '15px "Pretendard Variable", Pretendard, sans-serif'
    ctx.fillText(['일', '월', '화', '수', '목', '금', '토'][now.getDay()] + '요일', 64, 132)
    const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace
    return t
  }, [])
  // sized to the board it sits on, not inset from it — the backing used to show around the page as a cream
  // border, which read as an outline the calendar was never meant to have
  return <mesh position={[0, 0, .045]}><planeGeometry args={[.6, .68]} /><meshStandardMaterial map={texture} roughness={.9} /></mesh>
}

// jukebox controls anchored over the player, shown while it is the selected object
function MusicControls({ id, y }: { id: string; y: number }) {
  const store = useOptionalRoomStore()
  if (!store || store.mode !== 'normal' || store.selectedObject !== id) return null
  return <Html position={[0, y, 0]} center zIndexRange={[4, 0]}>
    <div onPointerDown={(event) => event.stopPropagation()}>
      <MusicPanel musicTrack={store.musicTrack} setMusicTrack={store.setMusicTrack} musicVolume={store.musicVolume} setMusicVolume={store.setMusicVolume} />
    </div>
  </Html>
}

// the clip lives in IndexedDB; it is decoded into a hidden <video> and streamed onto the frame as a texture
function VideoScreen({ id, width, height }: { id: string; width: number; height: number }) {
  const store = useOptionalRoomStore()
  const version = store?.videoFrames[id] ?? 0
  const link = store?.videoLinks[id]
  const [texture, setTexture] = useState<Texture | null>(null)
  // A playlist's thumbnail follows whatever it was last left on, which is what the frame will resume to. The
  // stored `@start` video is only the entry point and stops being true after the first track change, so it is a
  // fallback rather than the answer. Resolved outside the effect and listed in its deps so the picture updates
  // when the playlist moves on instead of staying on whatever it showed at mount.
  const posterId = link && (link.startsWith('pl:') ? playlistVideoResume[id] || link.split('@')[1] : link)
  useEffect(() => {
    let live = true
    let url: string | null = null
    let element: HTMLVideoElement | null = null
    let unregister = () => {}
    setTexture(null)
    const start = (source: string) => {
      element = document.createElement('video')
      element.src = source
      element.loop = true
      element.muted = true
      element.playsInline = true
      element.crossOrigin = 'anonymous'
      unregister = registerClipPlayer(id, element)
      element.play().catch(() => { /* autoplay may wait for a gesture */ })
      const video = new VideoTexture(element)
      video.colorSpace = SRGBColorSpace
      setTexture(video)
    }
    if (posterId) new TextureLoader().setCrossOrigin('anonymous').loadAsync(`https://img.youtube.com/vi/${posterId}/hqdefault.jpg`).then((poster) => {
      if (!live) return
      poster.colorSpace = SRGBColorSpace
      setTexture(poster)
    }).catch(() => { /* thumbnail unavailable */ })
    // a neighbour room in the explorer has no clips of its own to read, and the local ones belong to the viewer,
    // not to that room — so its frames stay empty rather than borrowing whatever this browser happens to hold
    else if (!store?.readOnly) getVideo(id).then((blob) => {
      if (!live) return
      if (blob) { url = URL.createObjectURL(blob); start(url); return }
      // no local copy (a visitor, or another device) — stream the uploaded clip from storage. Nothing uploaded
      // means an empty frame: it stays on the dark screen below instead of playing filler.
      const remote = loadClipUrls()[id]
      if (remote) start(remote)
    })
    return () => {
      live = false
      unregister()
      element?.pause()
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, version, link, posterId])
  return <>{!store?.playingFrames.includes(id) && <mesh position={[0, 0, .042]}>
    <planeGeometry args={[width, height]} />
    {texture
      ? <meshBasicMaterial key="clip" map={texture} />
      : <meshStandardMaterial key="empty" color="#20262b" emissive="#2b3236" emissiveIntensity={.25} />}
  </mesh>}
  {/* Not in a neighbour room: there the frame is a picture, and a click on it picks the room rather than starting
     anything, so a play badge would be promising something that does not happen. */}
  {link && !store?.readOnly && !store?.playingFrames.includes(id) && <group position={[0, 0, .048]}>
    <mesh><circleGeometry args={[.16, 20]} /><meshBasicMaterial color="#000000" transparent opacity={.55} /></mesh>
    {/* a 3-segment circle spans -r/2..r on x, so pull it left by r/4 to sit dead-center in the badge */}
    <mesh position={[-.019, 0, .002]}><circleGeometry args={[.075, 3]} /><meshBasicMaterial color="#ffffff" /></mesh>
  </group>}
  </>
}

// the wall copy of the profile popup: same photo and counts, drawn to a canvas so the board can carry text
function drawProfileBoard(canvas: HTMLCanvasElement, total: number, today: number, friends: number) {
  const ctx = canvas.getContext('2d')!
  const w = canvas.width
  ctx.clearRect(0, 0, w, canvas.height)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#3f3a33'
  ctx.font = 'bold 30px "Pretendard Variable", Pretendard, sans-serif'
  ctx.fillText(`Total ${total}`, w * .29, 42)
  ctx.fillText(`Today ${today}`, w * .72, 42)
  ctx.fillStyle = '#c3b6a6'
  ctx.font = '26px "Pretendard Variable", Pretendard, sans-serif'
  ctx.fillText('|', w / 2, 42)
  ctx.strokeStyle = '#e2d6c6'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(w * .14, 66); ctx.lineTo(w * .86, 66); ctx.stroke()
  ctx.fillStyle = '#5b4e44'
  ctx.font = 'bold 30px "Pretendard Variable", Pretendard, sans-serif'
  ctx.fillText(`친구 ${friends}`, w / 2, 106)
}

function ProfileBoardFace() {
  const store = useOptionalRoomStore()
  const profile = store?.profile
  const total = store?.remoteVisits?.total ?? profile?.total ?? 0, today = store?.remoteVisits?.today ?? profile?.today ?? 0, friends = profile?.friends ?? 0
  const photo = profile?.photo
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 128
    drawProfileBoard(canvas, total, today, friends)
    const created = new CanvasTexture(canvas); created.colorSpace = SRGBColorSpace
    return created
  }, [])
  useEffect(() => {
    drawProfileBoard(texture.image as HTMLCanvasElement, total, today, friends)
    texture.needsUpdate = true
  }, [total, today, friends, texture])
  const portrait = useMemo(() => { if (!photo) return null; const map = new TextureLoader().load(photo); map.colorSpace = SRGBColorSpace; return map }, [photo])
  // These sit ON the board, and the stats panel is drawn on a transparent canvas, so the board behind it is what
  // should show through. While a neighbour room fades it is all in the sorted transparent pass, which orders by
  // the object's projected z — and the stats panel hangs 0.59 BELOW the board's centre, which this camera reads as
  // further away. It drew first, wrote depth, and the board behind it was then rejected, leaving bare wall in its
  // place. renderOrder pins them after the board no matter what the distances work out to.
  return <>
    {portrait && <mesh renderOrder={1} position={[0, .36, .076]}><circleGeometry args={[.47, 30]} /><meshBasicMaterial map={portrait} /></mesh>}
    {profile?.handle && <Text renderOrder={1} font={PRETENDARD_WOFF} position={[0, -.22, .076]} fontSize={.13} color="#403f3d" anchorX="center" anchorY="middle">{profile.handle}</Text>}
    <mesh renderOrder={1} position={[0, -.59, .076]}><planeGeometry args={[1.2, .48]} /><meshBasicMaterial map={texture} transparent /></mesh>
  </>
}

// mesh sizes per frame type; aspect matches the footprint so the fit stays even on both axes
export const VIDEO_FRAME_SIZES: Record<string, [number, number]> = {
  'video-frame-3': [1.9, 1.425],
  'video-frame-4': [2.3, 1.84],
  'video-frame-5': [2.76, 2.3],
}
