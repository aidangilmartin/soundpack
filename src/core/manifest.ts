export interface ResourceInfo {
  resourceName: string
  author: string
  description: string
  resourceVersion: string
}

/** FiveM resource folder names: keep to lowercase letters, digits, '_' and '-'. */
export function sanitizeResourceName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
  return s || 'gunpack'
}

const lua = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ')}'`

/** fxmanifest.lua registering each wave pack folder that has replaced banks. */
export function generateManifest(info: ResourceInfo, files: string[]): string {
  const awcs = files.filter((f) => f.toLowerCase().endsWith('.awc')).sort()
  const packs = [...new Set(awcs.map((f) => f.slice(0, f.lastIndexOf('/'))))].sort()
  const lines = [
    "fx_version 'cerulean'",
    "game 'gta5'",
    '',
    `name ${lua(sanitizeResourceName(info.resourceName))}`,
    `description ${lua(info.description || 'Custom gun sounds')}`,
    `author ${lua(info.author || 'unknown')}`,
    `version ${lua(info.resourceVersion || '1.0.0')}`,
    '',
    'files {',
    ...awcs.map((f, i) => `  ${lua(f)}${i < awcs.length - 1 ? ',' : ''}`),
    '}',
    '',
    ...packs.map((p) => `data_file 'AUDIO_WAVEPACK' ${lua(p)}`),
    ''
  ]
  return lines.join('\n')
}

export function generateReadme(info: ResourceInfo, banks: string[]): string {
  const name = sanitizeResourceName(info.resourceName)
  return [
    `${name} — gun sound pack`,
    '',
    'Install:',
    `  1. Copy the "${name}" folder into your server's resources folder.`,
    `  2. Add "ensure ${name}" to server.cfg.`,
    '  3. Restart the server. Players download the sounds when they join.',
    '',
    'Replaced sound banks:',
    ...banks.map((b) => `  - ${b}`),
    '',
    'Made with Gun Soundpack Maker.',
    ''
  ].join('\n')
}
