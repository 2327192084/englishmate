/**
 * electron-builder 配置
 *
 * 目标形态与桌面上的 openLearner 一致：
 *  - NSIS 安装包，默认装到 %LOCALAPPDATA%\Programs\TypeFlow
 *  - 创建桌面 + 开始菜单快捷方式
 *  - 支持自选安装目录
 */
module.exports = {
  appId: 'cc.typeflow.app',
  productName: 'TypeFlow',
  copyright: 'Copyright © 2026 TypeFlow contributors',

  directories: {
    output: 'release',
    buildResources: 'build',
  },

  // 只打包运行必需的东西。node_modules 里绝大多数是开发依赖，不该进包
  files: [
    'dist/**/*',
    'electron/main.cjs',
    'electron/preload.cjs',
    'package.json',
    '!**/*.map',
  ],

  // 词库是数据不是代码，单独确认它们被打进去
  extraResources: [],

  asar: true,

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // 没有代码签名证书。关掉 exe 的签名/图标重写步骤：
    // 本机环境下该步骤依赖远程工具链，会静默卡住整个打包流程。
    signAndEditExecutable: false,
    artifactName: 'TypeFlow-${version}-setup.${ext}',
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'TypeFlow',
    // 卸载时保留用户学习数据，避免误删进度
    deleteAppDataOnUninstall: false,
    installerIcon: undefined,
    uninstallDisplayName: 'TypeFlow 打字即学习',
  },
};