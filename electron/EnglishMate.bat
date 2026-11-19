# EnglishMate 桌面版启动器
#
# 为什么用 .bat 而不是直接双击 exe：
# 部分 Windows 环境下 Chromium 的沙箱在任何 JS 执行前就初始化失败，
# 进程直接以 code 3 退出，用户什么也看不到（连日志都没有，因为崩在原生层）。
# 在 main.cjs 里 app.commandLine.appendSwitch('no-sandbox') 已经太晚，
# 沙箱那时已初始化完毕，所以只能在启动器这一层解决。
#
# 注意：这里关掉的是 Chromium 渲染进程沙箱，不是系统账号权限。
# contextIsolation、nodeIntegration:false、preload 白名单、
# 外链白名单、权限默认拒绝全部保持开启；渲染进程只加载本地打包文件。

@echo off
setlocal
set "APP_DIR=%~dp0"
set "EXE=%APP_DIR%EnglishMate.exe"

if not exist "%EXE%" (
    echo [ERROR] EnglishMate.exe not found.
    echo Expected: %EXE%
    echo.
    pause
    exit /b 1
)

start "" "%EXE%" --no-sandbox %*

endlocal
exit /b 0