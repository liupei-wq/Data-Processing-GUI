import { useEffect, useRef } from 'react'

type ThemeId =
  | 'apricot'
  | 'pearl'
  | 'ocean'
  | 'ink'
  | 'ember'
  | 'forest'
  | 'amber'
  | 'rose'
  | 'copper'
  | 'graphite'
  | 'obsidian'
  | 'christmas'

type ParticleKind = 'glow' | 'star' | 'petal' | 'leaf' | 'halo' | 'thread' | 'flame' | 'poly'

type Particle = {
  kind: ParticleKind
  theme: ThemeId
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  radius: number
  rotation: number
  spin: number
  drift: number
  color: string
  colorSoft: string
}

const MAX_PARTICLES = 168

const THEME_COLORS: Record<ThemeId, { primary: string[]; soft: string[] }> = {
  apricot: {
    primary: ['#f8fbff', '#cfe3f1', '#8fb4c9'],
    soft: ['rgba(207,227,241,0.18)', 'rgba(143,180,201,0.14)'],
  },
  pearl: {
    primary: ['#fffef8', '#f6fbff', '#dfefff'],
    soft: ['rgba(248,251,255,0.22)', 'rgba(207,227,241,0.16)'],
  },
  ocean: {
    primary: ['#69d8c2', '#aef4e6', '#ebfffb'],
    soft: ['rgba(105,216,194,0.28)', 'rgba(171,244,230,0.24)'],
  },
  ink: {
    primary: ['rgba(210,230,240,0.68)', 'rgba(175,204,214,0.62)', 'rgba(220,240,255,0.5)'],
    soft: ['rgba(185,210,220,0.12)', 'rgba(220,240,255,0.08)'],
  },
  ember: {
    primary: ['#f5cf85', '#eaf3fb', '#f8e6b6'],
    soft: ['rgba(245,207,133,0.18)', 'rgba(143,180,201,0.14)'],
  },
  forest: {
    primary: ['#f7ebb2', '#efe19a', '#d7c97c'],
    soft: ['rgba(241,242,192,0.18)', 'rgba(228,215,133,0.14)'],
  },
  amber: {
    primary: ['#fff8b6', '#fff08a', '#ffe45d'],
    soft: ['rgba(255,240,138,0.2)', 'rgba(255,228,93,0.14)'],
  },
  rose: {
    primary: ['#f6e0f1', '#f3cce6', '#e7b8d6'],
    soft: ['rgba(246,224,241,0.18)', 'rgba(215,172,205,0.14)'],
  },
  copper: {
    primary: ['#ffc067', '#ff8f5a', '#de3e3e'],
    soft: ['rgba(255,192,103,0.18)', 'rgba(222,62,62,0.14)'],
  },
  graphite: {
    primary: ['#d5d5d5', '#a7a7a7', '#888888'],
    soft: ['rgba(180,180,180,0.14)', 'rgba(120,120,120,0.1)'],
  },
  obsidian: {
    primary: ['#efe6ff', '#d8ddff', '#d8f3ff', '#f7dfff'],
    soft: ['rgba(216,221,255,0.16)', 'rgba(247,223,255,0.14)'],
  },
  christmas: {
    primary: ['#fff08a', '#ffe56e', '#fff7bf'],
    soft: ['rgba(255,240,138,0.2)', 'rgba(255,229,110,0.14)'],
  },
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith('rgba(')) {
    const parts = color.slice(5, -1).split(',').map(part => part.trim())
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
  }
  if (color.startsWith('rgb(')) {
    const parts = color.slice(4, -1).split(',').map(part => part.trim())
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
  }
  const hex = color.replace('#', '')
  const normalized = hex.length === 3
    ? hex.split('').map(char => `${char}${char}`).join('')
    : hex
  const value = parseInt(normalized, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function currentTheme(): ThemeId {
  const theme = document.documentElement.dataset.theme as ThemeId | undefined
  return theme ?? 'apricot'
}

function sample<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function particleKindForTheme(theme: ThemeId): ParticleKind {
  switch (theme) {
    case 'christmas':
      return 'star'
    case 'rose':
      return 'petal'
    case 'obsidian':
      return Math.random() > 0.45 ? 'star' : 'glow'
    case 'forest':
      return 'leaf'
    case 'amber':
      return 'glow'
    case 'ink':
      return 'thread'
    case 'copper':
      return 'flame'
    case 'ocean':
      return 'poly'
    case 'pearl':
      return 'halo'
    case 'graphite':
      return 'glow'
    default:
      return 'glow'
  }
}

function makeParticle(theme: ThemeId, x: number, y: number): Particle {
  const colors = THEME_COLORS[theme]
  const kind = particleKindForTheme(theme)
  const angle = Math.random() * Math.PI * 2
  const baseSpeed = kind === 'thread' ? 0.28 : kind === 'halo' ? 0.1 : kind === 'leaf' ? 0.2 : 0.48
  const speed = baseSpeed * (0.45 + Math.random() * 0.85)

  return {
    kind,
    theme,
    x: x + (Math.random() - 0.5) * 6,
    y: y + (Math.random() - 0.5) * 6,
    vx: Math.cos(angle) * speed,
    vy:
      kind === 'flame'
        ? -Math.abs(Math.sin(angle) * speed) - 0.16
        : Math.sin(angle) * speed - (kind === 'halo' ? 0.02 : 0.08),
    life: 0,
    maxLife:
      kind === 'thread'
        ? 52 + Math.random() * 34
        : kind === 'halo'
          ? 48 + Math.random() * 32
          : kind === 'leaf'
            ? 64 + Math.random() * 34
          : 40 + Math.random() * 30,
    size:
      kind === 'poly'
        ? 6 + Math.random() * 6
        : kind === 'thread'
          ? 14 + Math.random() * 10
          : 4 + Math.random() * 7,
    radius: 0.6 + Math.random() * 1.15,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.08,
    drift: (Math.random() - 0.5) * 0.22,
    color: sample(colors.primary),
    colorSoft: sample(colors.soft),
  }
}

function drawStar(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const spikes = 5
  const outer = particle.size * (0.38 + alpha)
  const inner = outer * 0.45

  ctx.save()
  ctx.translate(particle.x, particle.y)
  ctx.rotate(particle.rotation)
  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (Math.PI * i) / spikes
    const px = Math.cos(angle) * radius
    const py = Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = withAlpha(particle.color, 0.75 * alpha)
  ctx.shadowColor = particle.color
  ctx.shadowBlur = outer * 2.4
  ctx.fill()
  ctx.restore()
}

function drawPetal(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const size = particle.size * 0.7
  ctx.save()
  ctx.translate(particle.x, particle.y)
  ctx.rotate(particle.rotation)
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.bezierCurveTo(size * 0.95, -size * 0.4, size * 0.9, size * 0.7, 0, size)
  ctx.bezierCurveTo(-size * 0.9, size * 0.7, -size * 0.95, -size * 0.4, 0, -size)
  ctx.closePath()
  ctx.fillStyle = withAlpha(particle.color, 0.72 * alpha)
  ctx.shadowColor = particle.colorSoft
  ctx.shadowBlur = size * 2.2
  ctx.fill()
  ctx.restore()
}

function drawLeaf(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const size = particle.size * 0.75
  ctx.save()
  ctx.translate(particle.x, particle.y)
  ctx.rotate(particle.rotation)
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.quadraticCurveTo(size * 0.9, -size * 0.15, size * 0.5, size * 0.95)
  ctx.quadraticCurveTo(0, size * 0.55, -size * 0.5, size * 0.95)
  ctx.quadraticCurveTo(-size * 0.9, -size * 0.15, 0, -size)
  ctx.closePath()
  ctx.fillStyle = withAlpha(particle.color, 0.72 * alpha)
  ctx.strokeStyle = `rgba(146, 118, 58, ${0.28 * alpha})`
  ctx.lineWidth = 1
  ctx.shadowColor = particle.colorSoft
  ctx.shadowBlur = size * 2
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, -size * 0.85)
  ctx.lineTo(0, size * 0.8)
  ctx.stroke()
  ctx.restore()
}

function drawHalo(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const radius = particle.size * (0.7 + alpha * 0.9)
  const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, radius * 3.8)
  gradient.addColorStop(0, `rgba(255,255,244,${0.16 * alpha})`)
  gradient.addColorStop(0.38, `rgba(234,243,251,${0.12 * alpha})`)
  gradient.addColorStop(1, 'rgba(234,243,251,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(particle.x, particle.y, radius * 3.8, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = `rgba(255,255,250,${0.28 * alpha})`
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2)
  ctx.stroke()
}

function drawThread(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const length = particle.size * 1.45
  const dx = Math.cos(particle.rotation) * length
  const dy = Math.sin(particle.rotation) * length
  ctx.save()
  ctx.strokeStyle = withAlpha(particle.color, 0.32 * alpha)
  ctx.lineWidth = Math.max(0.7, particle.radius * 0.95)
  ctx.shadowColor = particle.colorSoft
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(particle.x - dx * 0.55, particle.y - dy * 0.55)
  ctx.quadraticCurveTo(
    particle.x + particle.drift * 10,
    particle.y - particle.drift * 12,
    particle.x + dx * 0.58,
    particle.y + dy * 0.58,
  )
  ctx.stroke()
  ctx.restore()
}

function drawFlame(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const size = particle.size * 0.7
  ctx.save()
  ctx.translate(particle.x, particle.y)
  ctx.rotate(particle.rotation)
  ctx.beginPath()
  ctx.moveTo(0, -size * 1.15)
  ctx.bezierCurveTo(size * 0.9, -size * 0.4, size * 0.9, size * 0.8, 0, size * 1.05)
  ctx.bezierCurveTo(-size * 0.92, size * 0.68, -size * 0.7, -size * 0.35, 0, -size * 1.15)
  ctx.closePath()
  ctx.fillStyle = withAlpha(particle.color, 0.78 * alpha)
  ctx.shadowColor = particle.color
  ctx.shadowBlur = size * 2.5
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(0, -size * 0.6)
  ctx.bezierCurveTo(size * 0.28, -size * 0.15, size * 0.24, size * 0.35, 0, size * 0.55)
  ctx.bezierCurveTo(-size * 0.26, size * 0.32, -size * 0.22, -size * 0.15, 0, -size * 0.6)
  ctx.fillStyle = `rgba(255, 241, 188, ${0.68 * alpha})`
  ctx.fill()
  ctx.restore()
}

function drawPoly(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const size = particle.size * 0.62
  ctx.save()
  ctx.translate(particle.x, particle.y)
  ctx.rotate(particle.rotation)
  ctx.strokeStyle = withAlpha(particle.color, 0.7 * alpha)
  ctx.lineWidth = 1
  ctx.shadowColor = particle.colorSoft
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size, -size * 0.25)
  ctx.lineTo(size * 0.6, size)
  ctx.lineTo(-size * 0.6, size)
  ctx.lineTo(-size, -size * 0.25)
  ctx.closePath()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(0, size)
  ctx.moveTo(-size, -size * 0.25)
  ctx.lineTo(size, -size * 0.25)
  ctx.stroke()
  ctx.restore()
}

function drawGlow(ctx: CanvasRenderingContext2D, particle: Particle, alpha: number) {
  const radius = particle.radius * (1 + (1 - alpha) * 1.8)
  const gradient = ctx.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, radius * 4)
  gradient.addColorStop(0, withAlpha(particle.color, 0.38 * alpha))
  gradient.addColorStop(0.38, withAlpha(particle.colorSoft, 0.24 * alpha))
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(particle.x, particle.y, radius * 4, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = withAlpha(particle.color, 0.65 * alpha)
  ctx.beginPath()
  ctx.arc(particle.x, particle.y, Math.max(0.55, radius), 0, Math.PI * 2)
  ctx.fill()
}

function drawParticle(ctx: CanvasRenderingContext2D, particle: Particle) {
  const progress = particle.life / particle.maxLife
  const alpha = (1 - progress) ** 1.1
  switch (particle.kind) {
    case 'star':
      drawStar(ctx, particle, alpha)
      break
    case 'petal':
      drawPetal(ctx, particle, alpha)
      break
    case 'leaf':
      drawLeaf(ctx, particle, alpha)
      break
    case 'halo':
      drawHalo(ctx, particle, alpha)
      break
    case 'thread':
      drawThread(ctx, particle, alpha)
      break
    case 'flame':
      drawFlame(ctx, particle, alpha)
      break
    case 'poly':
      drawPoly(ctx, particle, alpha)
      break
    default:
      drawGlow(ctx, particle, alpha)
  }
}

function updateParticle(particle: Particle) {
  particle.life += 1
  particle.x += particle.vx
  particle.y += particle.vy
  particle.rotation += particle.spin

  if (particle.kind === 'flame') {
    particle.vx *= 0.982
    particle.vy -= 0.0026
  } else if (particle.kind === 'thread') {
    particle.vx *= 0.995
    particle.vy *= 0.989
  } else if (particle.kind === 'leaf' || particle.kind === 'petal') {
    particle.vx = particle.vx * 0.995 + particle.drift * 0.012
    particle.vy = particle.vy * 0.994 + (particle.kind === 'leaf' ? 0.003 : 0.006)
  } else if (particle.kind === 'halo') {
    particle.vx *= 0.992
    particle.vy *= 0.989
  } else {
    particle.vx *= 0.991
    particle.vy = particle.vy * 0.991 + 0.0025
  }
}

function particleCountForTheme(theme: ThemeId, distance: number) {
  const base = Math.min(5, Math.max(1, Math.floor(distance / 22) + 1))
  if (theme === 'ink' || theme === 'pearl') return Math.max(1, base - 1)
  if (theme === 'christmas' || theme === 'obsidian') return Math.min(6, base + 1)
  if (theme === 'forest') return Math.max(1, base - 1)
  return base
}

export default function CursorParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const lastPointRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const animationRef = useRef<number | null>(null)
  const themeRef = useRef<ThemeId>('apricot')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reducedMotion.matches) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const syncTheme = () => {
      const theme = currentTheme()
      themeRef.current = theme
      canvas.dataset.particleTheme = theme
    }

    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const spawn = (x: number, y: number, amount: number) => {
      const particles = particlesRef.current
      const theme = themeRef.current
      for (let i = 0; i < amount; i += 1) particles.push(makeParticle(theme, x, y))
      if (particles.length > MAX_PARTICLES) {
        particles.splice(0, particles.length - MAX_PARTICLES)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const now = performance.now()
      const last = lastPointRef.current
      const dx = last ? event.clientX - last.x : 0
      const dy = last ? event.clientY - last.y : 0
      const distance = Math.hypot(dx, dy)
      if (last && distance < 4 && now - last.time < 18) return
      const amount = particleCountForTheme(themeRef.current, distance)
      spawn(event.clientX, event.clientY, amount)
      lastPointRef.current = { x: event.clientX, y: event.clientY, time: now }
    }

    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.globalCompositeOperation = 'source-over'

      const particles = particlesRef.current
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i]
        updateParticle(particle)
        if (particle.life / particle.maxLife >= 1) {
          particles.splice(i, 1)
          continue
        }
        drawParticle(ctx, particle)
      }

      animationRef.current = requestAnimationFrame(tick)
    }

    syncTheme()
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    animationRef.current = requestAnimationFrame(tick)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current)
    }
  }, [])

  return <canvas ref={canvasRef} className="cursor-particles" aria-hidden="true" />
}
