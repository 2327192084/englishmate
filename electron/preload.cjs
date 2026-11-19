/**
 * TypeFlow · preload
 *
 * 只暴露一个极小的白名单 API。渲染进程拿不到 Node、拿不到 fs、拿不到 ipcRenderer 本体，
 * 只能调用下面这两个明确的方法。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('typeflow', {
  /** 是否运行在桌面客户端里（浏览器里是 undefined） */
  isDesktop: true,
  platform: process.platform,
  /** 读取版本信息 */
  getVersion: () => ipcRenderer.invoke('typeflow:version'),
});
