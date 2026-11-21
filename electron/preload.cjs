/**
 * EnglishMate · preload
 *
 * 只暴露一个极小的白名单 API。渲染进程拿不到 Node、拿不到 fs、拿不到 ipcRenderer 本体，
 * 只能调用下面这些明确的方法。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('englishmate', {
  /** 是否运行在桌面客户端里（浏览器里是 undefined） */
  isDesktop: true,
  platform: process.platform,
  /** 读取版本信息 */
  getVersion: () => ipcRenderer.invoke('englishmate:version'),

  /**
   * 语音合成（Windows SAPI，走主进程）。
   *
   * 为什么需要它：Chromium 的 Web Speech API 只读 OneCore 语音注册表，
   * 实测本机那里一个英文语音都没有，只有中文——于是英文句子会被中文引擎
   * 硬读成"口齿不清"。主进程能调 System.Speech，那里有系统的 en-US 语音。
   *
   * 只传文本、只回收一个文件路径，不暴露任意 IPC 通道。
   */
  tts: {
    /**
     * 合成一段文本，返回 { ok, url }。
     * url 是 app:// 同源地址，渲染进程直接喂给 <audio> 即可
     * （不能是 file://，跨源会被 webSecurity 拦掉且不报错）。
     */
    synthesize: (text) => ipcRenderer.invoke('englishmate:tts-synthesize', text),
    /** 本机是否有可用的英文语音 */
    available: () => ipcRenderer.invoke('englishmate:tts-voices'),
  },
});