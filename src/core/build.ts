import { replaceStreamAudio, silenceStream } from './awc/replace'
import { AwcFile, getFormat } from './awc/types'
import { writeAwc } from './awc/write'
import { lookupBank, PACK_RESIDENT, PACK_WEAPONS_PLAYER } from './catalog'
import { shapeAudio } from './dsp'
import { hex8 } from './hash'
import { generateManifest, generateReadme, sanitizeResourceName } from './manifest'
import { bankKey, Project } from './project'
import type { AudioData } from './wav'

export interface BuildInput {
  project: Project
  /** Template banks keyed by bankKey(pack, file). */
  templates: Map<string, AwcFile>
  /** Decoded source audio keyed by source id. */
  sources: Map<string, AudioData>
  /** Optional readable stream names for messages, keyed by bankKey then stream id. */
  names?: Map<string, Record<number, string>>
}

export interface BuiltFile {
  /** Path inside the resource folder, using '/'. */
  path: string
  bytes: Uint8Array
}

export interface BuildResult {
  resourceName: string
  files: BuiltFile[]
  warnings: string[]
  banks: { pack: string; file: string; replaced: number; silenced: number }[]
}

export class BuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuildError'
  }
}

const LONG_SOUND_MS = 3000

export function buildResource(input: BuildInput): BuildResult {
  const { project, templates, sources } = input
  const warnings: string[] = []
  const files: BuiltFile[] = []
  const banks: BuildResult['banks'] = []

  const active = project.banks.filter((b) => b.assignments.length > 0)
  if (active.length === 0) throw new BuildError('Nothing to export yet: assign a sound to at least one stream.')

  for (const bank of active) {
    const key = bankKey(bank.pack, bank.file)
    const template = templates.get(key)
    if (!template) throw new BuildError(`The template for ${bank.pack}/${bank.file} is missing. Import it again.`)
    const names = input.names?.get(key) ?? {}
    const label = (id: number): string => `${bank.file} ${names[id] ?? hex8(id)}`

    const byId = new Map(template.streams.map((s) => [s.id, s]))
    let replaced = 0
    let silenced = 0
    for (const a of bank.assignments) {
      const stream = byId.get(a.streamId)
      if (!stream) {
        warnings.push(`${label(a.streamId)} is not in the template and was skipped.`)
        continue
      }
      if (a.action === 'silence') {
        byId.set(a.streamId, silenceStream(stream))
        silenced++
        continue
      }
      const source = a.sourceId ? sources.get(a.sourceId) : undefined
      if (!source) throw new BuildError(`The audio file for ${label(a.streamId)} is missing.`)
      const fmt = getFormat(stream)
      if (!fmt) {
        warnings.push(`${label(a.streamId)} has no audio format and was skipped.`)
        continue
      }
      const shaped = shapeAudio(source, a.shape, fmt.sampleRate)
      if (shaped.pcm.length === 0) warnings.push(`${label(a.streamId)} came out empty — check trim and length settings.`)
      if (shaped.clipped > 0) warnings.push(`${label(a.streamId)} clips on ${shaped.clipped} samples — lower the gain.`)
      if (shaped.durationMs > LONG_SOUND_MS) {
        warnings.push(`${label(a.streamId)} is ${(shaped.durationMs / 1000).toFixed(1)} s long; gunshots are usually under 3 s.`)
      }
      const headroom = a.shape.headroom === 'template' ? undefined : a.shape.headroom
      byId.set(a.streamId, replaceStreamAudio(stream, shaped.pcm, shaped.sampleRate, { headroom }))
      replaced++
    }

    const out: AwcFile = { ...template, streams: template.streams.map((s) => byId.get(s.id)!) }
    files.push({ path: `audio/sfx/${bank.pack}/${bank.file}`, bytes: writeAwc(out) })
    banks.push({ pack: bank.pack, file: bank.file, replaced, silenced })
  }

  const touchesPlayer = active.some((b) => b.pack === PACK_WEAPONS_PLAYER)
  const touchesShared = active.some((b) => bankKey(b.pack, b.file) === bankKey(PACK_RESIDENT, 'weapons.awc'))
  if (touchesPlayer && !touchesShared) {
    warnings.push('resident/weapons.awc is not replaced, so other players may still hear vanilla gunshots from you.')
  }
  for (const b of active) {
    if (!lookupBank(b.file, b.pack)) warnings.push(`${b.pack}/${b.file} is not a known gun bank; test it in-game.`)
  }

  const info = { ...project, resourceName: sanitizeResourceName(project.resourceName) }
  const paths = files.map((f) => f.path)
  const enc = new TextEncoder()
  files.unshift(
    { path: 'fxmanifest.lua', bytes: enc.encode(generateManifest(info, paths)) },
    { path: 'README.txt', bytes: enc.encode(generateReadme(info, paths)) }
  )
  return { resourceName: info.resourceName, files, warnings, banks }
}
