import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  radius: number
  hueShift: number
}

const MAX_PARTICLES = 88

export default function CursorParticles() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const lastPointRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reducedMotion.matches) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

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
      for (let i = 0; i < amount; i += 1) {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.14 + Math.random() * 0.72
        particles.push({
          x: x + (Math.random() - 0.5) * 8,
          y: y + (Math.random() - 0.5) * 8,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - Math.random() * 0.25,
          life: 0,
          maxLife: 22 + Math.random() * 24,
          radius: 0.55 + Math.random() * 1.1,
          hueShift: Math.random(),
        })
      }
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
      const amount = Math.min(5, Math.max(1, Math.floor(distance / 24) + 1))
      spawn(event.clientX, event.clientY, amount)
      lastPointRef.current = { x: event.clientX, y: event.clientY, time: now }
    }

    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.globalCompositeOperation = 'lighter'

      const particles = particlesRef.current
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]
        p.life += 1
        p.x += p.vx
        p.y += p.vy
        p.vx *= 0.985
        p.vy = p.vy * 0.985 + 0.006

        const progress = p.life / p.maxLife
        if (progress >= 1) {
          particles.splice(i, 1)
          continue
        }

        const alpha = (1 - progress) ** 1.8
        const radius = p.radius * (1 + progress * 1.6)
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 3.4)
        const cool = p.hueShift > 0.58
        gradient.addColorStop(0, cool ? `rgba(234, 248, 255, ${0.34 * alpha})` : `rgba(159, 215, 240, ${0.28 * alpha})`)
        gradient.addColorStop(0.34, cool ? `rgba(143, 180, 201, ${0.16 * alpha})` : `rgba(207, 227, 241, ${0.14 * alpha})`)
        gradient.addColorStop(1, 'rgba(143, 180, 201, 0)')

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(p.x, p.y, radius * 3.4, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = `rgba(248, 251, 255, ${0.52 * alpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, Math.max(0.45, radius * 0.58), 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'source-over'
      animationRef.current = requestAnimationFrame(tick)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    animationRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current)
    }
  }, [])

  return <canvas ref={canvasRef} className="cursor-particles" aria-hidden="true" />
}
