/** Contract between the Electron main process and the renderer (exposed as window.api). */

export interface LibraryTemplate {
  pack: string
  file: string
  streamCount: number
  sizeBytes: number
  importedAt: string
  origin: 'awc' | 'codewalker-xml'
  hasNames: boolean
}

export interface TemplateData {
  bytes: Uint8Array
  names: Record<number, string>
}

export interface ImportReport {
  imported: LibraryTemplate[]
  errors: { name: string; message: string }[]
  warnings: string[]
}

export interface PickedFile {
  name: string
  bytes: Uint8Array
}

export interface ProjectFileSource {
  id: string
  fileName: string
  bytes: Uint8Array
}

export interface OpenedProject {
  path: string
  json: string
  sources: ProjectFileSource[]
}

export interface ExportFile {
  path: string
  bytes: Uint8Array
}

export type ExportMode = 'folder' | 'zip'

export interface Api {
  listTemplates(): Promise<LibraryTemplate[]>
  /** Opens a file dialog for .awc files, or imports the given paths when provided (drag & drop). */
  importAwcFiles(paths?: string[]): Promise<ImportReport>
  /** Opens a folder dialog for CodeWalker "Export XML" output, or imports the given folders. */
  importCodeWalkerFolders(paths?: string[]): Promise<ImportReport>
  readTemplate(pack: string, file: string): Promise<TemplateData>
  removeTemplate(pack: string, file: string): Promise<void>
  setTemplatePack(pack: string, file: string, newPack: string): Promise<LibraryTemplate>

  getLabels(): Promise<Record<string, string>>
  setLabel(key: string, label: string | null): Promise<void>

  pickAudioFiles(): Promise<PickedFile[]>
  readFiles(paths: string[]): Promise<PickedFile[]>
  /** Absolute path of a dropped File (Electron removed File.path). */
  pathForFile(file: File): string

  saveProject(json: string, sources: ProjectFileSource[], path: string | null): Promise<string | null>
  openProject(): Promise<OpenedProject | null>

  exportResource(resourceName: string, files: ExportFile[], mode: ExportMode): Promise<string | null>
  showInFolder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
}

export const IPC = {
  listTemplates: 'templates:list',
  importAwcFiles: 'templates:import-awc',
  importCodeWalkerFolders: 'templates:import-cw',
  readTemplate: 'templates:read',
  removeTemplate: 'templates:remove',
  setTemplatePack: 'templates:set-pack',
  getLabels: 'labels:get',
  setLabel: 'labels:set',
  pickAudioFiles: 'audio:pick',
  readFiles: 'files:read',
  saveProject: 'project:save',
  openProject: 'project:open',
  exportResource: 'export:resource',
  showInFolder: 'shell:show',
  openExternal: 'shell:external'
} as const
