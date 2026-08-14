import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { useRoomStore } from '../store'

// The playing iframe lives here, OUTSIDE the furniture tree: entering edit mode swaps every piece into a
// different wrapper, which would unmount an iframe rendered inside it and reload the video. This layer stays
// mounted through mode changes and simply copies the frame's live world matrix each frame, so playback survives
// editing and even follows the frame while it is being dragged.
export default function WallVideoLayer() {
  const { playingFrame, videoLinks, selectedObject, furniture, setPlayingFrame, openVideoPanel } = useRoomStore()
  if (!playingFrame) return null
  const item = furniture.find((entry) => entry.id === playingFrame)
  const videoId = videoLinks[playingFrame]
  if (!item || item.removed || !videoId || selectedObject === playingFrame) return null
  const large = item.type === 'video-frame-4'
  const [w, h] = large ? [2.3, 1.84] : [1.9, 1.425]
  const turned = Math.abs(Math.round(item.rotation[1] / (Math.PI / 2))) % 2 === 1
  const screenWidth = (turned ? h : w) - .16
  return <FollowFit fitName={`fit:${item.id}`}>
    <group rotation={[0, 0, -item.rotation[1]]}>
      <Html transform distanceFactor={400} position={[0, 0, .09]} scale={screenWidth / 1280} zIndexRange={[4, 0]}>
        <div className="wall-video" style={{ width: 1280, height: Math.round(1280 * ((h - .16) / (w - .16))) }} onPointerDown={(event) => event.stopPropagation()}>
          <iframe title="유튜브 재생" src={`https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1`} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          <div className="wall-video-actions">
            <button type="button" aria-label="크게 보기" onClick={() => openVideoPanel(playingFrame)}>⤢</button>
            <button type="button" aria-label="재생 멈추기" onClick={() => setPlayingFrame(null)}>×</button>
          </div>
        </div>
      </Html>
    </group>
  </FollowFit>
}

function FollowFit({ fitName, children }: { fitName: string; children: React.ReactNode }) {
  const holder = useRef<Group>(null)
  useFrame(({ scene }) => {
    const fit = scene.getObjectByName(fitName)
    const target = holder.current
    if (!fit || !target) return
    fit.updateWorldMatrix(true, false)
    target.matrix.copy(fit.matrixWorld)
    target.matrixAutoUpdate = false
    target.matrixWorldNeedsUpdate = true
  })
  return <group ref={holder}>{children}</group>
}
