import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { loadAudioPrefs, useRoomStore } from '../store'
import { VIDEO_FRAME_SIZES } from './InventoryFurniture'
import { embedSrc, trackIframe, requestSound, playlistVideoResume, watchPlaylistOrder, playFrame, framePlayerStates, onFrameMuteState } from '../services/ytResume'

// The playing iframes live here, OUTSIDE the furniture tree: entering edit mode swaps every piece into a
// different wrapper, which would unmount an iframe rendered inside it and reload the video. This layer stays
// mounted through mode changes and simply copies each frame's live world matrix per frame, so playback survives
// editing and even follows the frame while it is being dragged. Every playing frame gets its own player, so
// several frames can run at once, each with its own mute toggle.
// The true aspect of a YouTube video, found without any API key: shorts are detected by their portrait "oar"
// thumbnail (it 404s for normal videos), and everything else is measured by reading the letterbox bars inside
// the 480x360 hqdefault thumbnail (pure-black rows/columns around the content). The measured ratio is only
// trusted when it lands near a common aspect — anything odd resolves to null so the caller skips cropping.
// Once the visitor has clicked anywhere, the page holds a sticky activation and embeds may autoplay WITH
// sound — so remounts (e.g. returning from the expanded panel) of an unmuted frame skip the muted start
// entirely instead of racing the browser's short post-click grace window with an unmute command.
let userInteracted = false
if (typeof window !== 'undefined') window.addEventListener('pointerdown', () => { userInteracted = true }, { once: true })

const aspectCache: Record<string, Promise<number | null>> = {}
export function videoAspect(id: string): Promise<number | null> {
  return aspectCache[id] ??= new Promise((resolve) => {
    const oar = new Image()
    oar.onload = () => resolve(9 / 16)
    oar.onerror = () => {
      const thumb = new Image()
      thumb.crossOrigin = 'anonymous'
      thumb.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = thumb.naturalWidth; canvas.height = thumb.naturalHeight
          const context = canvas.getContext('2d')
          if (!context) return resolve(null)
          context.drawImage(thumb, 0, 0)
          const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
          const dark = (x: number, y: number) => { const at = (y * width + x) * 4; return data[at] < 24 && data[at + 1] < 24 && data[at + 2] < 24 }
          const rowDark = (y: number) => { for (let x = 0; x < width; x += 6) if (!dark(x, y)) return false; return true }
          const colDark = (x: number) => { for (let y = 0; y < height; y += 6) if (!dark(x, y)) return false; return true }
          let top = 0; while (top < height / 3 && rowDark(top)) top++
          let bottom = 0; while (bottom < height / 3 && rowDark(height - 1 - bottom)) bottom++
          let left = 0; while (left < width / 3 && colDark(left)) left++
          let right = 0; while (right < width / 3 && colDark(width - 1 - right)) right++
          const contentWidth = width - left - right, contentHeight = height - top - bottom
          if (contentWidth <= 0 || contentHeight <= 0) return resolve(null)
          const measured = contentWidth / contentHeight
          const known = [16 / 9, 4 / 3, 1, 9 / 16].find((value) => Math.abs(measured - value) / value < .08)
          resolve(known ?? null)
        } catch { resolve(null) }
      }
      thumb.onerror = () => resolve(null)
      thumb.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    }
    oar.src = `https://i.ytimg.com/vi/${id}/oardefault.jpg`
  })
}

export default function WallVideoLayer() {
  const { playingFrames, mutedFrames, setFrameMuted, videoLinks } = useRoomStore()
  // one order-keeper per playing playlist frame, alive across wall<->panel switches (it follows whichever
  // iframe is currently registered for the frame), enforcing the site's custom order and syncing the id list
  useEffect(() => {
    const stops = playingFrames
      .map((id) => ({ id, link: videoLinks[id] }))
      .filter((entry) => entry.link?.startsWith('pl:'))
      .map((entry) => watchPlaylistOrder(entry.id, entry.link.slice(3).split('@')[0]))
    return () => stops.forEach((stop) => stop())
  }, [playingFrames, videoLinks])
  // The first click/tap anywhere unlocks sound. Capture it before the canvas consumes a mobile gesture; retry
  // every frame that is not deliberately muted, even if the autoplay-blocked UI state has not landed yet.
  const latest = useRef({ playingFrames, mutedFrames, setFrameMuted })
  latest.current = { playingFrames, mutedFrames, setFrameMuted }
  useEffect(() => {
    let used = false
    const onFirstGesture = () => {
      if (used) return
      used = true
      const prefs = loadAudioPrefs()
      for (const id of latest.current.playingFrames) {
        if (prefs[id] !== false) {
          latest.current.setFrameMuted(id, false)
          requestSound(id, () => latest.current.setFrameMuted(id, true, false))
          playFrame(id)
        }
      }
    }
    window.addEventListener('pointerdown', onFirstGesture, { capture: true })
    window.addEventListener('touchstart', onFirstGesture, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture, true)
      window.removeEventListener('touchstart', onFirstGesture, true)
    }
  }, [])
  // Focus guard: if a wall iframe holds focus when the tab is left, the browser re-focuses it on return and
  // the YouTube player mistakes that for user activity, waking its control overlay. Whenever focus lands on a
  // wall iframe (window 'blur' fires the moment it does, and also on real tab-leave) it is released right away,
  // so a tab return has no focus to restore and the overlay stays asleep. The wall iframe itself is also
  // pointer-transparent; only our explicit controls accept input, so returning with the cursor over it cannot
  // synthesize hover activity inside YouTube. The expanded panel player remains fully interactive.
  useEffect(() => {
    const releaseWallIframeFocus = () => setTimeout(() => {
      const active = document.activeElement
      if (active instanceof HTMLIFrameElement && active.closest('.wall-video')) active.blur()
    }, 0)
    window.addEventListener('blur', releaseWallIframeFocus)
    window.addEventListener('focus', releaseWallIframeFocus)
    return () => { window.removeEventListener('blur', releaseWallIframeFocus); window.removeEventListener('focus', releaseWallIframeFocus) }
  }, [])
  // Mobile browsers pause media while the screen is off and the embeds do not resume by themselves.
  // The state right before hiding is snapshotted, and on return ONLY frames that were actually playing get
  // nudged back — a video the user paused stays paused, and no commands go to players that need none.
  // the UI's mute flags mirror what the player actually reports — if an unmute attempt silently fails,
  // the speaker icon says muted instead of lying (preferences are not touched by this sync)
  useEffect(() => onFrameMuteState((id, actualMuted) => {
    if (latest.current.playingFrames.includes(id) && latest.current.mutedFrames.includes(id) !== actualMuted) latest.current.setFrameMuted(id, actualMuted, false)
  }), [])
  const playingBeforeHide = useRef<string[]>([])
  useEffect(() => {
    // mobile only: desktop browsers keep background tabs playing, so PC gets no intervention at all
    if (!window.matchMedia('(pointer: coarse)').matches) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        playingBeforeHide.current = latest.current.playingFrames.filter((id) => framePlayerStates[id] === 1 || framePlayerStates[id] === 3)
        return
      }
      const nudge = () => playingBeforeHide.current.forEach((id) => { if (framePlayerStates[id] !== 1) playFrame(id) })
      nudge()
      setTimeout(nudge, 1200)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  return <>{playingFrames.map((id) => <WallVideo key={id} frameId={id} />)}</>
}

function WallVideo({ frameId }: { frameId: string }) {
  const { videoLinks, selectedObject, furniture, openVideoPanel, mode, mutedFrames, setFrameMuted } = useRoomStore()
  const item = furniture.find((entry) => entry.id === frameId)
  const videoId = videoLinks[frameId]
  const muted = mutedFrames.includes(frameId)
  const active = !!item && !item.removed && !!videoId && selectedObject !== frameId
  // the embed itself always starts muted so autoplay is never blocked; sound is lifted immediately (retrying
  // until the player answers), and if the browser refuses (fresh visitor, no gesture yet) playback simply
  // continues muted with the 🔇 button shown
  useEffect(() => {
    if (active && !muted) return requestSound(frameId, () => setFrameMuted(frameId, true, false), () => setFrameMuted(frameId, false, false))
  }, [active, muted, frameId])  // eslint-disable-line react-hooks/exhaustive-deps -- setFrameMuted identity is unstable
  // Crop only as much as the video's own letterbox allows: YouTube's edge overlays hide inside the black bars
  // of wide videos, but 4:3/portrait videos fill the iframe, so cutting a fixed band would eat real content.
  // The aspect comes from videoAspect() below (thumbnail probing — oEmbed reports 16:9 for everything);
  // unknown aspect means no crop, losing pixels never.
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
    videoAspect(lookupId).then((aspect) => {
      if (!live || !aspect) return
      const contentHeight = 640 / aspect
      setCrop(Math.round(Math.max(0, Math.min(60, (divHeight - contentHeight) / 2))))
    })
    return () => { live = false }
  }, [active, videoId, frameId, divHeight])
  if (!active) return null
  return <FollowFit fitName={`fit:${item.id}`}>
    <group rotation={[0, 0, -item.rotation[1]]}>
      {/* 640 CSS px stretched to the frame: YouTube lays its controls out for a small player, so they read 2x bigger */}
      {/* drei sizes the punch-through occluder as a 1x1 plane under an orthographic camera, which clips the
          video to a 1-unit window — hand it a plane matching the screen so the hole covers the full frame */}
      <Html transform occlude="blending" geometry={<planeGeometry args={[screenWidth, screenHeight]} />} distanceFactor={400} position={[0, 0, .042]} scale={screenWidth / 640} zIndexRange={[4, 0]} style={{ pointerEvents: mode === 'edit' ? 'none' : 'auto' }}>
        <div className="wall-video" style={{ width: 640, height: divHeight, pointerEvents: mode === 'edit' ? 'none' : 'auto' }}
          onPointerDown={(event) => event.stopPropagation()} onClick={() => { if (mode !== 'edit') openVideoPanel(frameId) }}>
          {/* controls=0 keeps YouTube's control bar from popping over the wall screen (it auto-shows on tab
              return); the expanded panel player keeps its controls */}
          <ResumingIframe key={frameId} videoId={videoId} frameId={frameId} extra={!muted && userInteracted ? 'autoplay=1&playsinline=1&controls=0' : 'autoplay=1&playsinline=1&mute=1&controls=0'} frameStyle={crop ? { top: -crop, height: `calc(100% + ${crop * 2}px)` } : undefined} />

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
