import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { useRoomStore } from '../store'
import { VIDEO_FRAME_SIZES } from './InventoryFurniture'
import { embedSrc, trackIframe, unmuteFrame } from '../services/ytResume'

// The playing iframe lives here, OUTSIDE the furniture tree: entering edit mode swaps every piece into a
// different wrapper, which would unmount an iframe rendered inside it and reload the video. This layer stays
// mounted through mode changes and simply copies the frame's live world matrix each frame, so playback survives
// editing and even follows the frame while it is being dragged.
export default function WallVideoLayer() {
  const { playingFrame, videoLinks, selectedObject, furniture, setPlayingFrame, openVideoPanel, mode, wallMuted, setWallMuted } = useRoomStore()
  if (!playingFrame) return null
  const item = furniture.find((entry) => entry.id === playingFrame)
  const videoId = videoLinks[playingFrame]
  if (!item || item.removed || !videoId || selectedObject === playingFrame) return null
  const [w, h] = VIDEO_FRAME_SIZES[item.type] ?? VIDEO_FRAME_SIZES['video-frame-3']
  const turned = Math.abs(Math.round(item.rotation[1] / (Math.PI / 2))) % 2 === 1
  const screenWidth = (turned ? h : w) - .16
  return <FollowFit fitName={`fit:${item.id}`}>
    <group rotation={[0, 0, -item.rotation[1]]}>
      <Html transform distanceFactor={400} position={[0, 0, .09]} scale={screenWidth / 1280} zIndexRange={[4, 0]} style={{ pointerEvents: mode === 'edit' ? 'none' : 'auto' }}>
        <div className="wall-video" style={{ width: 1280, height: Math.round(1280 * ((h - .16) / (w - .16))), pointerEvents: mode === 'edit' ? 'none' : 'auto' }} onPointerDown={(event) => event.stopPropagation()}>
          <ResumingIframe videoId={videoId} frameId={playingFrame} extra={wallMuted ? 'autoplay=1&playsinline=1&mute=1' : 'autoplay=1&playsinline=1'} />
          {mode !== 'edit' && <div className="wall-video-actions">
            <button type="button" aria-label="크게 보기" onClick={() => openVideoPanel(playingFrame)}>⤢</button>
            {wallMuted && <button type="button" aria-label="소리 켜기" onClick={() => { unmuteFrame(playingFrame); setWallMuted(false) }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#fff" stroke="none" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            </button>}
            <button type="button" aria-label="재생 멈추기" onClick={() => setPlayingFrame(null)}>×</button>
          </div>}
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

// src is fixed at mount (recomputing it would reload the embed); the tracker keeps the resume point fresh
export function ResumingIframe({ videoId, frameId, extra }: { videoId: string; frameId: string; extra: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => embedSrc(videoId, frameId, extra))
  useEffect(() => { if (frame.current) return trackIframe(frame.current, frameId) }, [frameId])
  return <iframe ref={frame} title="유튜브 재생" src={src} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
}
