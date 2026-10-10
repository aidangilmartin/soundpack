import type { Voice } from '@core/soundgraph'

/**
 * Renders a planned gunshot (see @core/soundgraph) the way the game layers it: every wave at its
 * time, level, pitch, pan, filters and envelope, plus an environment reverb preset standing in for
 * the game's runtime environment processing.
 */

export type Environment = 'outdoor' | 'indoor' | 'dry'

export interface ResolvedWave {
  samples: Float32Array
  sampleRate: number
  /** Extra gain for this wave (the game applies the wave's headroom). */
  gainDb: number
}

export type WaveResolver = (voice: Voice) => ResolvedWave | null

const RATE = 48000
const MAX_SECONDS = 15
const dB = (db: number): number => Math.pow(10, db / 20)

const TAIL: Record<Environment, number> = { outdoor: 2.6, indoor: 0.9, dry: 0.15 }
const SEND: Record<Environment, number> = { outdoor: 0.22, indoor: 0.35, dry: 0 }

/** Procedural impulse responses: open-air slapback + long tail, or a dense small room. */
function impulse(ctx: BaseAudioContext, env: Exclude<Environment, 'dry'>): AudioBuffer {
  const len = Math.floor(TAIL[env] * RATE)
  const buf = ctx.createBuffer(2, len, RATE)
  let seed = 0x2545f491
  const rnd = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) / 4294967296) * 2 - 1
  }
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / RATE
      const decay = env === 'outdoor' ? Math.exp(-t * 2.4) * Math.min(1, t / 0.04) : Math.exp(-t * 7.5)
      // darken the tail over time like air absorption
      const k = env === 'outdoor' ? Math.min(0.97, 0.55 + t * 0.25) : 0.35
      lp = lp * k + rnd() * (1 - k)
      d[i] = lp * decay * (env === 'outdoor' ? 1.6 : 1.1)
    }
    if (env === 'outdoor') {
      for (const [ms, g] of [
        [85, 0.45],
        [160, 0.3],
        [310, 0.22],
        [540, 0.12]
      ]) {
        const at = Math.floor(((ms + ch * 7) / 1000) * RATE)
        if (at < len) d[at] += g
      }
    }
  }
  return buf
}

function applyEnvelope(param: AudioParam, v: Voice, peak: number, end: number): void {
  const t0 = v.time
  const env = v.envelope
  const attack = Math.max(v.attackMs, env?.attack ?? 0) / 1000
  if (attack > 0) {
    param.setValueAtTime(0, t0)
    param.linearRampToValueAtTime(peak, t0 + attack)
  } else {
    param.setValueAtTime(peak, t0)
  }
  let t = t0 + attack
  if (env) {
    const sustain = (Math.max(0, Math.min(100, env.sustain)) / 100) * peak
    t += Math.max(0, env.decay) / 1000
    param.linearRampToValueAtTime(sustain, t)
    if (env.hold >= 0) {
      t += env.hold / 1000
      param.setValueAtTime(sustain, t)
      param.linearRampToValueAtTime(0, t + Math.max(0.005, env.release / 1000))
    }
  } else if (v.releaseMs > 0 && end > t) {
    param.setValueAtTime(peak, Math.max(t, end - v.releaseMs / 1000))
    param.linearRampToValueAtTime(0, end)
  }
}

export async function renderPreview(voices: Voice[], resolve: WaveResolver, env: Environment): Promise<AudioBuffer | null> {
  const items = voices.map((v) => ({ v, w: resolve(v) })).filter((x): x is { v: Voice; w: ResolvedWave } => !!x.w && x.w.samples.length > 0)
  if (!items.length) return null

  const rateOf = (v: Voice): number => Math.pow(2, v.cents / 1200)
  let end = 0
  for (const { v, w } of items) {
    const dur = Math.max(0, w.samples.length / w.sampleRate - v.startOffsetMs / 1000) / rateOf(v)
    end = Math.max(end, v.time + dur)
  }
  const seconds = Math.min(MAX_SECONDS, end + TAIL[env])
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * RATE)), RATE)

  // the game's master bus limits peaks; keep the same chain for "original" and "yours"
  const master = ctx.createGain()
  master.gain.value = dB(-6)
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 3
  limiter.ratio.value = 20
  limiter.attack.value = 0.001
  limiter.release.value = 0.12
  master.connect(limiter).connect(ctx.destination)

  let reverbIn: GainNode | null = null
  if (env !== 'dry') {
    const conv = ctx.createConvolver()
    conv.buffer = impulse(ctx, env)
    reverbIn = ctx.createGain()
    reverbIn.connect(conv).connect(master)
  }

  for (const { v, w } of items) {
    const buffer = ctx.createBuffer(1, w.samples.length, Math.max(3000, Math.min(768000, w.sampleRate)))
    buffer.copyToChannel(w.samples as Float32Array<ArrayBuffer>, 0)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rateOf(v)
    let node: AudioNode = src
    if (v.hpfHz && v.hpfHz > 20) {
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = Math.min(20000, v.hpfHz)
      node = node.connect(hp)
    }
    if (v.lpfHz && v.lpfHz < 20000) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = Math.max(20, v.lpfHz)
      node = node.connect(lp)
    }
    const pan = ctx.createStereoPanner()
    pan.pan.value = v.pan
    const amp = ctx.createGain()
    const voiceEnd = v.time + Math.max(0, w.samples.length / w.sampleRate - v.startOffsetMs / 1000) / rateOf(v)
    applyEnvelope(amp.gain, v, dB(v.gainDb + w.gainDb), voiceEnd)
    node.connect(pan).connect(amp).connect(master)
    if (reverbIn) {
      const send = ctx.createGain()
      send.gain.value = SEND[env] * (0.6 + v.reverb)
      amp.connect(send).connect(reverbIn)
    }
    src.start(v.time, Math.max(0, v.startOffsetMs / 1000))
  }
  return ctx.startRendering()
}

export function toFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768
  return out
}

/** Mono mixdown for drawing. */
export function mixdown(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buffer.numberOfChannels
  }
  return out
}
