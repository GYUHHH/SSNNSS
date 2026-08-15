import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { loadAudioPrefs, useRoomStore } from '../store'
import { VIDEO_FRAME_SIZES } from './InventoryFurniture'
import { embedSrc, trackIframe, muteFrame, unmuteFrame, requestSound, playlistVideoResume } from '../services/ytResume'

// The playing iframes live here, OUTSIDE the furniture tree: entering edit mode swaps every piece into a
// different wrapper, which would unmount an iframe rendered inside it and reload the video. This layer stays
// mounted through mode changes and simply copies each frame's live world matrix per frame, so playback survives
// editing and even follows the frame while it is being dragged. Every playing frame gets its own player, so
// several frames can run at once, each with its own mute toggle.
export default function WallVideoLayer() {
  const { playingFrames, mutedFrames, setFrameMuted } = useRoomStore()
  // The visitor's first click/tap anywhere doubles as audio activation, once: frames with NO saved audio
  // choice get their sound turned on (and remembered); frames the user explicitly muted stay silent.
  // Pref-true frames blocked by autoplay policy retry on their own gesture listener in requestSound.
  const latest = useRef({ playingFrames, mutedFrames, setFrameMuted })
  latest.current = { playingFrames, mutedFrames, setFrameMuted }
  useEffect(() => {
    const onFirstClick = () => {
      const prefs = loadAudioPrefs()
      for (const id of latest.current.playingFrames) {
        if (prefs[id] === undefined && latest.current.mutedFrames.includes(id)) {
          // remember the choice, then let requestSound apply it — it waits out players that are not ready
          // yet and verifies the volume actually landed, instead of firing one possibly-lost command
          latest.current.setFrameMuted(id, false)
          requestSound(id, () => latest.current.setFrameMuted(id, true, false))
        }
      }
    }
    window.addEventListener('pointerdown', onFirstClick, { once: true })
    return () => window.removeEventListener('pointerdown', onFirstClick)
  }, [])
  return <>{playingFrames.map((id) => <WallVideo key={id} frameId={id} />)}</>
}

function WallVideo({ frameId }: { frameId: string }) {
  const { videoLinks, selectedObject, furniture, stopFrame, openVideoPanel, mode, mutedFrames, setFrameMuted } = useRoomStore()
  const item = furniture.find((entry) => entry.id === frameId)
  const videoId = videoLinks[frameId]
  const muted = mutedFrames.includes(frameId)
  const active = !!item && !item.removed && !!videoId && selectedObject !== frameId
  // the embed itself always starts muted so autoplay is never blocked; sound is lifted immediately (retrying
  // until the player answers), and if the browser refuses (fresh visitor, no gesture yet) playback simply
  // continues muted with the 🔇 button shown
  useEffect(() => {
    if (active && !muted) requestSound(frameId, () => setFrameMuted(frameId, true, false), () => setFrameMuted(frameId, false, false))
  }, [active, frameId])  // eslint-disable-line react-hooks/exhaustive-deps -- re-run per frame mount, not per toggle
  // Crop only as much as the video's own letterbox allows: YouTube's edge overlays hide inside the black bars
  // of wide videos, but 4:3/portrait videos fill the iframe, so cutting a fixed band would eat real content.
  // The aspect comes from YouTube's oEmbed endpoint; unknown aspect means no crop (overlays over lost pixels).
  const [crop, setCrop] = useState(0)
  const dims = VIDEO_FRAME_SIZES[(item?.type ?? '')] ?? VIDEO_FRAME_SIZES['video-frame-3']
  const turned = !!item && Math.abs(Math.round(item.rotation[1] / (Math.PI / 2))) % 2 === 1
  const screenWidth = (turned ? dims[1] : dims[0]) - .06
  const screenHeight = (turned ? dims[0] : dims[1]) - .06
  const divHeight = Math.round(640 * (screenHeight / screenWidth))
  useEffect(() => {
    if (!active || !videoId) return
    let live = true
    const lookupId = videoId.startsWith('pl:') ? (playlistVideoResume[frameId] ?? videoId.split('@')[1]) : videoId
    if (!lookupId) return
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${lookupId}`)}&format=json`)
      .then((response) => response.json())
      .then((data) => {
        if (!live || !data?.width || !data?.height) return
        const contentHeight = 640 * data.height / data.width
        setCrop(Math.round(Math.max(0, Math.min(60, (divHeight - contentHeight) / 2))))
      })
      .catch(() => { /* aspect unknown — keep crop 0 so no content is lost */ })
    return () => { live = false }
  }, [active, videoId, frameId, divHeight])
  if (!active) return null
  return <FollowFit fitName={`fit:${item.id}`}>
    <group rotation={[0, 0, -item.rotation[1]]}>
      {/* 640 CSS px stretched to the frame: YouTube lays its controls out for a small player, so they read 2x bigger */}
      {/* drei sizes the punch-through occluder as a 1x1 plane under an orthographic camera, which clips the
          video to a 1-unit window — hand it a plane matching the screen so the hole covers the full frame */}
      <Html transform occlude="blending" geometry={<planeGeometry args={[screenWidth, screenHeight]} />} distanceFactor={400} position={[0, 0, .042]} scale={screenWidth / 640} zIndexRange={[4, 0]} style={{ pointerEvents: mode === 'edit' ? 'none' : 'auto' }}>
        <div className="wall-video" style={{ width: 640, height: divHeight, pointerEvents: mode === 'edit' ? 'none' : 'auto' }} onPointerDown={(event) => event.stopPropagation()}>
          {/* controls=0 keeps YouTube's control bar from popping over the wall screen (it auto-shows on tab
              return); the expanded panel player keeps its controls */}
          <ResumingIframe key={frameId} videoId={videoId} frameId={frameId} extra="autoplay=1&playsinline=1&mute=1&controls=0" frameStyle={crop ? { top: -crop, height: `calc(100% + ${crop * 2}px)` } : undefined} />
          {mode !== 'edit' && <div className="wall-video-actions">
            <button type="button" aria-label="크게 보기" onClick={() => openVideoPanel(frameId)}>⤢</button>
            <button type="button" aria-label={muted ? '소리 켜기' : '소리 끄기'} onClick={() => { if (muted) unmuteFrame(frameId); else muteFrame(frameId); setFrameMuted(frameId, !muted) }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#fff" stroke="none" />
                {muted
                  ? <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
                  : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5.5a10 10 0 0 1 0 13" /></>}
              </svg>
            </button>
            <button type="button" aria-label="재생 멈추기" onClick={() => stopFrame(frameId)}>×</button>
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
export function ResumingIframe({ videoId, frameId, extra, frameStyle }: { videoId: string; frameId: string; extra: string; frameStyle?: React.CSSProperties }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => embedSrc(videoId, frameId, extra))
  useEffect(() => { if (frame.current) return trackIframe(frame.current, frameId) }, [frameId])
  return <iframe ref={frame} title="유튜브 재생" src={src} style={frameStyle} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen />
}
