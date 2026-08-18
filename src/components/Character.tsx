import { Html, RoundedBox, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Group, Vector3 } from 'three'
import { baseFloorCells, useRoomStore, type CharacterTransform } from '../store'
import { characterPosition } from '../services/characterTracker'
import { resolveInteraction, stateForInteraction } from '../services/interactionAnchors'
import { cellsFor, findPath, floorSurface, gridToWorld, type GridPosition, worldToGrid } from '../services/roomGrid'

const CELL = { width: 1, depth: 1 }

export type CharacterAppearance = {
  skinColor: string
  hairStyle: 'bob'
  hairColor: string
  top: 'tshirt'
  topColor: string
  bottom: 'shorts'
  bottomColor: string
  shoes: 'round'
  shoeColor: string
}

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  skinColor: '#dfa27f', hairStyle: 'bob', hairColor: '#5a4035',
  top: 'tshirt', topColor: '#627b73', bottom: 'shorts', bottomColor: '#80675b',
  shoes: 'round', shoeColor: '#4c3b34',
}

const turnToward = (current: number, target: number, amount: number) => current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * amount
const cellKey = ({ gridX, gridY }: GridPosition) => `${gridX}:${gridY}`
const simplifyPath = (path: GridPosition[]) => path.filter((cell, index) => {
  if (!index || index === path.length - 1) return true
  const before = path[index - 1]; const after = path[index + 1]
  return Math.sign(cell.gridX - before.gridX) !== Math.sign(after.gridX - cell.gridX) || Math.sign(cell.gridY - before.gridY) !== Math.sign(after.gridY - cell.gridY)
})
const currentTransform = (actor: Group): CharacterTransform => ({
  position: [actor.position.x, 0, actor.position.z], facing: actor.rotation.y, y: actor.position.y,
})

export default function Character({ appearance: customAppearance }: { appearance?: Partial<CharacterAppearance> } = {}) {
  const actor = useRef<Group>(null)
  const legLeft = useRef<Group>(null); const legRight = useRef<Group>(null)
  const armLeft = useRef<Group>(null); const armRight = useRef<Group>(null)
  const torso = useRef<Group>(null); const head = useRef<Group>(null)
  const [hovered, setHovered] = useState(false)
  const { readOnly, characterHome, characterPose, characterWritable, characterLook, currentHandle, selectedObject, characterState, finishCharacterAction, cupHeld, selectObject, furniture, debugAnchors, moveNotice, floorTarget, settleFloorMove } = useRoomStore()
  // the saved look wins over the prop, and both win over the defaults — unset parts fall through to the model
  const appearance = { ...DEFAULT_APPEARANCE, ...customAppearance, ...characterLook }
  // Per room, not per module. Every room in the explorer renders one of these, so a single shared start would put
  // them all where THIS browser last left its own character. characterHome is that room's own saved spot.
  const start = useRef(new Vector3(characterHome[0], characterPose?.y ?? 0, characterHome[2])).current
  const route = useRef<Vector3[]>([]); const routeIndex = useRef(0); const routeKey = useRef<string | null>(null)
  const interactionStart = useRef<{ key: string | null; position: [number, number, number] }>({ key: null, position: [start.x, 0, start.z] })
  const clock = useRef(0)
  useCursor(hovered)
  // A room change applies one complete snapshot before paint. The same actor can stay mounted without carrying
  // any position, direction or route from the room left behind.
  useLayoutEffect(() => {
    if (!actor.current) return
    start.set(characterHome[0], characterPose?.y ?? 0, characterHome[2])
    actor.current.position.copy(start)
    actor.current.rotation.y = characterPose?.facing ?? Math.PI / 4
    route.current = []; routeIndex.current = 0; routeKey.current = null
    interactionStart.current = { key: null, position: [start.x, 0, start.z] }
  }, [currentHandle])
  // Visitor and explorer characters are read-only snapshots. Owner realtime updates replace them as a whole.
  useLayoutEffect(() => {
    if (characterWritable || !actor.current) return
    start.set(characterHome[0], characterPose?.y ?? 0, characterHome[2])
    actor.current.position.copy(start)
    actor.current.rotation.y = characterPose?.facing ?? Math.PI / 4
    interactionStart.current.position = [start.x, 0, start.z]
  }, [characterWritable, characterHome[0], characterHome[2], characterPose])

  const seated = characterState === 'sitting' || characterState === 'working'
  const resting = characterState === 'laying' || characterState === 'sleeping'
  const floorSitting = characterState === 'sittingFloor'
  // floor sit: hips just above the floor's VISUAL top (y=0.035, the floor box is 0.05 tall centered at 0.01 —
  // resting anything at y=0 clips into it), legs swung fully horizontal so calves/feet also stay above 0.035
  // seated y=-0.56 puts the pelvis (local y .56) exactly AT the seat anchor height — the anchor itself is the
  // seat's physical top, so the butt rests on it instead of hovering
  const pose = resting ? { y: 0, rotation: [-Math.PI / 2, 0, 0] as [number, number, number], legBend: 0 } : floorSitting ? { y: -0.47, rotation: [0, 0, 0] as [number, number, number], legBend: -Math.PI / 2 } : seated ? { y: -0.56, rotation: [0, 0, 0] as [number, number, number], legBend: -1.15 } : { y: 0, rotation: [0, 0, 0] as [number, number, number], legBend: 0 }

  useFrame((_, delta) => {
    if (!actor.current) return
    if (characterWritable) {
      characterPosition[0] = actor.current.position.x; characterPosition[2] = actor.current.position.z
    }
    // a neighbour's character is part of a still: its clock holds, so the wave arm and the sleeping breath
    // freeze mid-gesture instead of ticking away in every room of the explorer
    if (!readOnly) clock.current += delta
    const walking = characterState === 'walking'
    if (interactionStart.current.key !== selectedObject) interactionStart.current = { key: selectedObject, position: [actor.current.position.x, 0, actor.current.position.z] }
    const interaction = resolveInteraction(selectedObject, furniture, interactionStart.current.position)

    if (walking && interaction) {
      const destination = interaction.approachWorld.position
      const nextRouteKey = `${selectedObject}:${destination.join(',')}`
      if (routeKey.current !== nextRouteKey) {
        routeKey.current = nextRouteKey
        const occupied = new Set(furniture.filter((item) => item.category === 'floorFurniture' && item.type !== 'rug' && !item.removed && item.surfaceId === 'floor').flatMap((item) => baseFloorCells(item).map((cell) => `${cell.x}:${cell.y}`)))
        const startCell = worldToGrid(floorSurface, [actor.current.position.x, 0, actor.current.position.z], CELL)
        const desiredCell = worldToGrid(floorSurface, destination, CELL)
        const targetCells = interaction.target.category === 'floorFurniture' ? cellsFor(interaction.target, interaction.target.footprint, interaction.target.rotation[1]) : []
        const candidates = [desiredCell, ...targetCells.flatMap((cell) => [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((y) => ({ gridX: cell.x + x, gridY: cell.y + y }))))]
          .filter((cell, index, items) => cell.gridX >= 0 && cell.gridX < 10 && cell.gridY >= 0 && cell.gridY < 10 && !occupied.has(cellKey(cell)) && items.findIndex((other) => cellKey(other) === cellKey(cell)) === index)
          .sort((a, b) => Math.hypot(a.gridX - desiredCell.gridX, a.gridY - desiredCell.gridY) - Math.hypot(b.gridX - desiredCell.gridX, b.gridY - desiredCell.gridY))
        let path: GridPosition[] = []
        let goal: GridPosition | null = null
        for (const candidate of candidates) { const found = cellKey(candidate) === cellKey(startCell) ? [] : findPath(occupied, startCell, candidate); if (found.length || cellKey(candidate) === cellKey(startCell)) { path = found; goal = candidate; break } }
        // no reachable approach cell: don't dead-end with an empty route (routeKey would block any retry) —
        // fall through to 'aligning', whose glide always completes and lands the interaction anyway
        if (!goal) { route.current = []; routeKey.current = null; finishCharacterAction('aligning', currentTransform(actor.current)); return }
        const cells = simplifyPath(path)
        route.current = cells.map((cell, index) => {
          if (index === cells.length - 1 && cellKey(goal) === cellKey(desiredCell)) return new Vector3(...destination)
          const [x, , z] = gridToWorld(floorSurface, cell, CELL); return new Vector3(x, 0, z)
        })
        if (!route.current.length) route.current = [cellKey(goal) === cellKey(desiredCell) ? new Vector3(...destination) : new Vector3(...gridToWorld(floorSurface, goal, CELL))]
        routeIndex.current = 0
      }
      const target = route.current[routeIndex.current]
      // an empty/expired route with a matching key can never advance — clear the key so next frame replans
      if (!target) { routeKey.current = null; return }
      const dx = target.x - actor.current.position.x; const dz = target.z - actor.current.position.z
      if (Math.hypot(dx, dz) > 0.03) actor.current.rotation.y = turnToward(actor.current.rotation.y, Math.atan2(dx, dz), Math.min(1, delta * 7))
      actor.current.position.y = 0
      actor.current.position.lerp(target, Math.min(1, delta * 6))
      if (actor.current.position.distanceTo(target) < .12) {
        if (routeIndex.current < route.current.length - 1) routeIndex.current += 1
        else finishCharacterAction('aligning', currentTransform(actor.current))
      }
    } else if (walking && floorTarget) {
      // floor-click walk: same waypoint motion as furniture walks, ending in idle at the clicked cell
      const nextRouteKey = `floor:${floorTarget[0]},${floorTarget[2]}`
      if (routeKey.current !== nextRouteKey) {
        routeKey.current = nextRouteKey
        const occupied = new Set(furniture.filter((item) => item.category === 'floorFurniture' && item.type !== 'rug' && !item.removed && item.surfaceId === 'floor').flatMap((item) => baseFloorCells(item).map((cell) => `${cell.x}:${cell.y}`)))
        const startCell = worldToGrid(floorSurface, [actor.current.position.x, 0, actor.current.position.z], CELL)
        const goal = worldToGrid(floorSurface, floorTarget, CELL)
        const path = cellKey(goal) === cellKey(startCell) ? [] : findPath(occupied, startCell, goal)
        if (!path.length && cellKey(goal) !== cellKey(startCell)) { settleFloorMove(false, currentTransform(actor.current)); return }
        const cells = simplifyPath(path)
        route.current = cells.map((cell, index) => index === cells.length - 1 ? new Vector3(...floorTarget) : new Vector3(...gridToWorld(floorSurface, cell, CELL)).setY(0))
        if (!route.current.length) route.current = [new Vector3(...floorTarget)]
        routeIndex.current = 0
      }
      const target = route.current[routeIndex.current]
      if (!target) return
      const dx = target.x - actor.current.position.x; const dz = target.z - actor.current.position.z
      if (Math.hypot(dx, dz) > 0.03) actor.current.rotation.y = turnToward(actor.current.rotation.y, Math.atan2(dx, dz), Math.min(1, delta * 7))
      actor.current.position.y = 0
      actor.current.position.lerp(target, Math.min(1, delta * 6))
      if (actor.current.position.distanceTo(target) < .12) {
        if (routeIndex.current < route.current.length - 1) routeIndex.current += 1
        else settleFloorMove(true, currentTransform(actor.current))
      }
    } else if (characterState === 'aligning' && interaction) {
      const target = new Vector3(...interaction.actionWorld.position)
      actor.current.position.lerp(target, Math.min(1, delta * 5))
      actor.current.rotation.y = turnToward(actor.current.rotation.y, interaction.actionWorld.rotation, Math.min(1, delta * 7))
      const angleLeft = Math.abs(Math.atan2(Math.sin(interaction.actionWorld.rotation - actor.current.rotation.y), Math.cos(interaction.actionWorld.rotation - actor.current.rotation.y)))
      if (actor.current.position.distanceTo(target) < .025 && angleLeft < .025) finishCharacterAction(stateForInteraction(interaction.type), currentTransform(actor.current))
    } else {
      routeKey.current = null
      // walking/aligning with nothing to walk to (selection vanished, item removed) must settle, not spin forever
      if ((walking || characterState === 'aligning') && !interaction && !floorTarget) finishCharacterAction('idle', currentTransform(actor.current))
    }

    const swing = walking ? Math.sin(clock.current * 8) * 0.5 : 0
    const waving = characterState === 'wave'
    if (legLeft.current) { legLeft.current.rotation.x = walking ? swing : pose.legBend; legLeft.current.rotation.z = 0 }
    if (legRight.current) { legRight.current.rotation.x = walking ? -swing : pose.legBend; legRight.current.rotation.z = 0 }
    if (armLeft.current) { armLeft.current.rotation.x = -swing; armLeft.current.rotation.z = 0 }
    if (armRight.current) { armRight.current.rotation.x = swing; armRight.current.rotation.z = waving ? 2.35 + Math.sin(clock.current * 9) * 0.25 : 0 }
    if (head.current) head.current.rotation.x = characterState === 'reading' ? 0.3 : characterState === 'working' ? 0.15 : 0
    if (torso.current) torso.current.scale.y = characterState === 'sleeping' ? 1 + Math.sin(clock.current * 2.2) * 0.02 : 1
  })

  return <group ref={actor} name="CharacterRoot" scale={0.85} onPointerOver={(event) => { if (readOnly) return; event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)} onClick={(event) => { if (readOnly) return; event.stopPropagation(); selectObject('character') }}>
    <group position={[0, pose.y, 0]} rotation={pose.rotation} scale={hovered ? 1.03 : 1}>
      <group ref={torso} name="Body">
        <group name="BaseBody">
          <mesh name="Neck" position={[0, 1.14, 0]}><cylinderGeometry args={[.085, .09, .14, 8]} /><meshStandardMaterial color={appearance.skinColor} roughness={.85} /></mesh>
          <RoundedBox name="Torso" args={[.36, .46, .21]} radius={.07} smoothness={2} position={[0, .88, 0]}><meshStandardMaterial color={appearance.skinColor} roughness={.9} /></RoundedBox>
        </group>
        <group name="Top">
          <RoundedBox args={[.43, .47, .245]} radius={.065} smoothness={2} position={[0, .9, 0]}><meshStandardMaterial color={appearance.topColor} roughness={.9} /></RoundedBox>
          <RoundedBox name="Collar" args={[.45, .12, .255]} radius={.055} smoothness={2} position={[0, 1.09, 0]}><meshStandardMaterial color={appearance.topColor} roughness={.9} /></RoundedBox>
        </group>
        <group name="Bottom">
          <RoundedBox name="Shorts" args={[.43, .16, .27]} radius={.045} smoothness={2} position={[0, .64, 0]}><meshStandardMaterial color={appearance.bottomColor} roughness={.9} /></RoundedBox>
        </group>
      </group>
      <group ref={head} name="Head" position={[0, 1.34, 0]}>
        <group name="Face">
          <mesh position={[0, .015, .025]} scale={[.95, 1, .92]}><sphereGeometry args={[.35, 12, 10]} /><meshStandardMaterial color={appearance.skinColor} roughness={.9} /></mesh>
          {[-.115, .115].map((x) => <mesh key={x} position={[x, -.015, .34]}><sphereGeometry args={[.027, 8, 6]} /><meshStandardMaterial color="#41332d" roughness={.8} /></mesh>)}
          {[-.335, .335].map((x) => <mesh key={x} position={[x, .005, 0]} scale={[.55, 1, .65]}><sphereGeometry args={[.08, 8, 6]} /><meshStandardMaterial color={appearance.skinColor} roughness={.9} /></mesh>)}
        </group>
        <group name={`Hair-${appearance.hairStyle}`}>
          <mesh position={[0, .035, -.055]} scale={[1.04, 1.07, .93]}><sphereGeometry args={[.37, 12, 10]} /><meshStandardMaterial color={appearance.hairColor} roughness={.92} /></mesh>
          <mesh position={[0, .075, .015]}><sphereGeometry args={[.365, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={appearance.hairColor} roughness={.92} /></mesh>
          {[[-.14, .14], [.02, .17], [.15, .13]].map(([x, y], index) => <mesh key={index} position={[x, y, .285]} scale={[1, 1.3, .6]} rotation={[0, 0, index === 1 ? 0 : x * 1.4]}><sphereGeometry args={[.1, 9, 7]} /><meshStandardMaterial color={appearance.hairColor} roughness={.92} /></mesh>)}
        </group>
        <group name="GlassesSlot" position={[0, -.015, .355]} />
        <group name="HatSlot" position={[0, .37, 0]} />
        <group name="EarringSlot" position={[.34, 0, 0]} />
      </group>
      {([-1, 1] as const).map((side) => <group key={side} ref={side < 0 ? armLeft : armRight} name={side < 0 ? 'LeftArm' : 'RightArm'} position={[side * .285, 1.08, 0]}>
        <group name="UpperArm">
          <RoundedBox args={[.145, .26, .155]} radius={.06} smoothness={2} position={[0, -.11, 0]}><meshStandardMaterial color={appearance.skinColor} roughness={.88} /></RoundedBox>
          <RoundedBox name="Sleeve" args={[.16, .22, .165]} radius={.06} smoothness={2} position={[0, -.08, 0]}><meshStandardMaterial color={appearance.topColor} roughness={.9} /></RoundedBox>
        </group>
        <group name="ForeArm" position={[0, -.235, .01]}>
          <RoundedBox args={[.128, .24, .137]} radius={.055} smoothness={2} position={[0, -.11, 0]}><meshStandardMaterial color={appearance.skinColor} roughness={.88} /></RoundedBox>
          <mesh name="Hand" position={[0, -.235, .015]} scale={[.95, 1, .9]}><sphereGeometry args={[.087, 9, 7]} /><meshStandardMaterial color={appearance.skinColor} roughness={.88} /></mesh>
        </group>
      </group>)}
      {([-1, 1] as const).map((side) => <group key={side} ref={side < 0 ? legLeft : legRight} name={side < 0 ? 'LeftLeg' : 'RightLeg'} position={[side * .125, .57, 0]}>
        <group name="UpperLeg">
          <RoundedBox name="Pants" args={[.19, .26, .2]} radius={.06} smoothness={2} position={[0, -.115, 0]}><meshStandardMaterial color={appearance.bottomColor} roughness={.92} /></RoundedBox>
        </group>
        <group name="LowerLeg" position={[0, -.235, 0]}>
          <RoundedBox args={[.17, .24, .18]} radius={.055} smoothness={2} position={[0, -.105, 0]}><meshStandardMaterial color={appearance.skinColor} roughness={.9} /></RoundedBox>
          <group name="Foot" position={[0, -.235, .045]}>
            <RoundedBox name="Shoes" args={[.2, .13, .25]} radius={.06} smoothness={2} position={[0, -.005, .025]}><meshStandardMaterial color={appearance.shoeColor} roughness={.88} /></RoundedBox>
          </group>
        </group>
      </group>
      )}
      <group name="NecklaceSlot" position={[0, 1.08, .14]} />
      {cupHeld && <mesh position={[.4, .61, .1]}><cylinderGeometry args={[.09, .09, .18, 16]} /><meshStandardMaterial color="#f5e7cc" roughness={.85} /></mesh>}
      {moveNotice && <Html position={[0, 2, 0]} center><div className="speech-bubble">여기로 이동할 수 없어요</div></Html>}
      {selectedObject === 'plant' && characterState === 'interacting' && <Html position={[0, 2, 0]} center><div className="speech-bubble">새 잎이 났네.</div></Html>}
      {debugAnchors && <mesh position={[0, .8, 0]}><boxGeometry args={[.62, 1.68, .48]} /><meshBasicMaterial color="#3b82f6" wireframe depthTest={false} /></mesh>}
    </group>
  </group>
}
