import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type Api } from '../shared/ipc'

const api: Api = {
  listTemplates: () => ipcRenderer.invoke(IPC.listTemplates),
  importAwcFiles: (paths) => ipcRenderer.invoke(IPC.importAwcFiles, paths),
  importCodeWalkerFolders: (paths) => ipcRenderer.invoke(IPC.importCodeWalkerFolders, paths),
  readTemplate: (pack, file) => ipcRenderer.invoke(IPC.readTemplate, pack, file),
  removeTemplate: (pack, file) => ipcRenderer.invoke(IPC.removeTemplate, pack, file),
  setTemplatePack: (pack, file, newPack) => ipcRenderer.invoke(IPC.setTemplatePack, pack, file, newPack),
  getLabels: () => ipcRenderer.invoke(IPC.getLabels),
  setLabel: (key, label) => ipcRenderer.invoke(IPC.setLabel, key, label),
  pickAudioFiles: () => ipcRenderer.invoke(IPC.pickAudioFiles),
  readFiles: (paths) => ipcRenderer.invoke(IPC.readFiles, paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  saveProject: (json, sources, path) => ipcRenderer.invoke(IPC.saveProject, json, sources, path),
  openProject: () => ipcRenderer.invoke(IPC.openProject),
  getGameSettings: () => ipcRenderer.invoke(IPC.getGameSettings),
  setGamePath: (kind, path) => ipcRenderer.invoke(IPC.setGamePath, kind, path),
  listGameBanks: () => ipcRenderer.invoke(IPC.listGameBanks),
  extractGameBanks: (banks) => ipcRenderer.invoke(IPC.extractGameBanks, banks),
  onGameProgress: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, message: string): void => listener(message)
    ipcRenderer.on(IPC.gameProgress, handler)
    return () => ipcRenderer.removeListener(IPC.gameProgress, handler)
  },
  exportResource: (name, files, mode) => ipcRenderer.invoke(IPC.exportResource, name, files, mode),
  showInFolder: (path) => ipcRenderer.invoke(IPC.showInFolder, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url)
}

contextBridge.exposeInMainWorld('api', api)
