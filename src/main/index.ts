import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, normalize, sep } from 'node:path'
import { sanitizeResourceName } from '../core/manifest'
import { IPC, type ExportFile, type ExportMode, type ProjectFileSource } from '../shared/ipc'
import { LabelStore, TemplateLibrary } from './library'
import { packProject, unpackProject, zipResource } from './projectFile'

// Lets automated tests run against a throwaway profile.
if (process.env.GSM_USER_DATA) app.setPath('userData', process.env.GSM_USER_DATA)

const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'webm']

let win: BrowserWindow | null = null
let library: TemplateLibrary
let labels: LabelStore

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#14161a',
    title: 'Gun Soundpack Maker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function pick(options: OpenDialogOptions): Promise<string[]> {
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

async function readPicked(paths: string[]): Promise<{ name: string; bytes: Uint8Array }[]> {
  return Promise.all(paths.map(async (p) => ({ name: basename(p), bytes: new Uint8Array(await readFile(p)) })))
}

function registerIpc(): void {
  ipcMain.handle(IPC.listTemplates, () => library.list())

  ipcMain.handle(IPC.importAwcFiles, async (_e, paths?: string[]) => {
    const files = paths?.length
      ? paths
      : await pick({
          title: 'Import .awc sound banks',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'AWC sound bank', extensions: ['awc'] }]
        })
    return library.importAwc(files)
  })

  ipcMain.handle(IPC.importCodeWalkerFolders, async (_e, paths?: string[]) => {
    const files = paths?.length
      ? paths
      : await pick({
          title: 'Import CodeWalker XML export (.awc.xml)',
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'CodeWalker AWC XML', extensions: ['xml'] }]
        })
    return library.importCodeWalker(files)
  })

  ipcMain.handle(IPC.readTemplate, (_e, pack: string, file: string) => library.read(pack, file))
  ipcMain.handle(IPC.removeTemplate, (_e, pack: string, file: string) => library.remove(pack, file))
  ipcMain.handle(IPC.setTemplatePack, (_e, pack: string, file: string, newPack: string) => library.setPack(pack, file, newPack))

  ipcMain.handle(IPC.getLabels, () => labels.get())
  ipcMain.handle(IPC.setLabel, (_e, key: string, label: string | null) => labels.set(key, label))

  ipcMain.handle(IPC.pickAudioFiles, async () =>
    readPicked(
      await pick({
        title: 'Add sounds',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
      })
    )
  )

  ipcMain.handle(IPC.readFiles, (_e, paths: string[]) => {
    const ok = paths.filter((p) => AUDIO_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(`.${ext}`)))
    return readPicked(ok)
  })

  ipcMain.handle(IPC.saveProject, async (_e, json: string, sources: ProjectFileSource[], path: string | null) => {
    let target = path
    if (!target) {
      const r = win
        ? await dialog.showSaveDialog(win, {
            title: 'Save project',
            defaultPath: 'my_gunpack.gunpack',
            filters: [{ name: 'Gun soundpack project', extensions: ['gunpack'] }]
          })
        : await dialog.showSaveDialog({ defaultPath: 'my_gunpack.gunpack' })
      if (r.canceled || !r.filePath) return null
      target = r.filePath.toLowerCase().endsWith('.gunpack') ? r.filePath : `${r.filePath}.gunpack`
    }
    await writeFile(target, packProject(json, sources))
    return target
  })

  ipcMain.handle(IPC.openProject, async () => {
    const [path] = await pick({
      title: 'Open project',
      properties: ['openFile'],
      filters: [{ name: 'Gun soundpack project', extensions: ['gunpack'] }]
    })
    if (!path) return null
    return { path, ...unpackProject(new Uint8Array(await readFile(path))) }
  })

  ipcMain.handle(IPC.exportResource, async (_e, name: string, files: ExportFile[], mode: ExportMode) => {
    const resourceName = sanitizeResourceName(name)
    if (mode === 'zip') {
      const r = win
        ? await dialog.showSaveDialog(win, {
            title: 'Export resource as .zip',
            defaultPath: `${resourceName}.zip`,
            filters: [{ name: 'Zip', extensions: ['zip'] }]
          })
        : await dialog.showSaveDialog({ defaultPath: `${resourceName}.zip` })
      if (r.canceled || !r.filePath) return null
      await writeFile(r.filePath, zipResource(resourceName, files))
      return r.filePath
    }
    const [parent] = await pick({
      title: 'Choose where to create the resource folder (e.g. your server resources folder)',
      properties: ['openDirectory', 'createDirectory']
    })
    if (!parent) return null
    const root = join(parent, resourceName)
    if (existsSync(root)) {
      const opts = {
        type: 'warning' as const,
        buttons: ['Replace', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `"${resourceName}" already exists here.`,
        detail: 'Replacing deletes the existing folder first.'
      }
      const answer = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      if (answer.response !== 0) return null
      await rm(root, { recursive: true, force: true })
    }
    for (const f of files) {
      const target = normalize(join(root, f.path))
      if (!target.startsWith(root + sep)) throw new Error(`Refusing to write outside the resource folder: ${f.path}`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, f.bytes)
    }
    return root
  })

  ipcMain.handle(IPC.showInFolder, (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  library = new TemplateLibrary(join(app.getPath('userData'), 'templates'))
  labels = new LabelStore(join(app.getPath('userData'), 'labels.json'))
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
