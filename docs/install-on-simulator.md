# 将 OpenReader 更新到 iOS 模拟器

适用：在本地 Mac 上让模拟器运行当前工作区代码，包括未提交的修改。
真机签名、描述文件和开发者信任见 [iPhone 安装指南](install-on-iphone.md)。
模拟器不需要这些真机步骤，也不能安装 `iphoneos` 的构建产物。

## 先确认目标和运行方式

从仓库根目录执行：

```bash
pwd
xcode-select -p
xcrun simctl list devices available
xcrun simctl list devices booted
lsof -nP -iTCP:8081 -sTCP:LISTEN
```

本文记录的目标是 iPhone 17，UDID 为
`13D669CF-ADBD-470C-9D6C-C3B03B9746E9`。每次先查列表，下面命令中的
`SIMULATOR_UDID` 替换为本次目标；多台模拟器启动时尤其不要盲用 `booted`。
目标尚未启动时：

```bash
xcrun simctl boot SIMULATOR_UDID
xcrun simctl bootstatus SIMULATOR_UDID -b
```

本项目有自定义原生模块，使用自己的 OpenReader 应用，不使用 Expo Go。
已安装且原生依赖匹配的 Debug 应用可以直接从 Metro 加载最新代码；原生模块、
插件、依赖或原生配置发生变化时，需要重新构建并安装。Release 内含代码包，
仅重启 Metro 不会更新它。

## 日常更新：已有 Debug 应用，只有应用代码变化

先确认 Metro 属于当前仓库。端口在监听只说明有服务，并不说明目录正确。
用上一步得到的 PID 检查进程及工作目录：

```bash
ps -p METRO_PID -o command=
lsof -a -p METRO_PID -d cwd
curl -s http://localhost:8081/status
```

若确认该进程是本项目遗留的失效服务，停止这个确切的 PID，然后在当前仓库启动：

```bash
kill METRO_PID
npx expo start --port 8081
```

若没有服务，只执行启动命令；若已有正确服务，保留它。若端口属于另一个仍在使用
的项目，给本项目选择空闲端口，并让本项目的构建和运行配置使用同一端口。
开发期间保持 Metro 所在终端运行。

在另一个终端重启应用，使它请求当前代码包：

```bash
xcrun simctl terminate SIMULATOR_UDID top.xujialiu.openreader
xcrun simctl launch SIMULATOR_UDID top.xujialiu.openreader
curl -s http://localhost:8081/json/list
```

应用原本未运行时，terminate 报未找到进程不妨碍后续 launch。
检查 Metro 出现本次打包记录，并确认调试目标包含 `top.xujialiu.openreader`。
还必须打开改动所在的界面，确认最终改动实际出现；连接成功本身不证明更新完成。

### 已遇到：Metro 指向搬家前的目录

2026-09-20，8081 上的进程仍从旧目录 `Works/react_native` 启动。
应用重启显示 `ConfigError: The expected package.json path … does not exist`，
`/json/list` 最初为空。停止这个失效进程，在 `Works/openreader` 启动 Metro
后重新启动应用，日志显示重新打包，调试目标出现，阅读页显示了最新的同排目录
和倍速按钮。此情况通过更正 Metro 解决，无需删除应用或清空书库。

## 首次安装或原生内容变化：构建 Debug 模拟器应用

先阅读 [Expo SDK 57 文档](https://docs.expo.dev/versions/v57.0.0/)。
安装仓库依赖；仅在原生目录不存在或相关配置需要重新生成时执行：

```bash
npx expo prebuild --platform ios
```

常规构建与启动入口：

```bash
npx expo run:ios --device SIMULATOR_UDID --port 8081
```

也可以分开构建、安装和启动，便于区分失败发生在哪一步。以下为 Debug
模拟器命令形状；本次仅更新 JavaScript 的验证未重新执行这条构建命令：

```bash
xcodebuild \
  -workspace ios/OpenReader.xcworkspace \
  -scheme OpenReader \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'id=SIMULATOR_UDID' \
  -derivedDataPath /tmp/openreader-simulator-build \
  ENABLE_USER_SCRIPT_SANDBOXING=NO \
  -quiet build > /tmp/openreader-simulator-build.log 2>&1
```

等待命令退出且退出码为 0 后再安装；产物目录存在不代表本次构建成功。

```bash
xcrun simctl install SIMULATOR_UDID \
  /tmp/openreader-simulator-build/Build/Products/Debug-iphonesimulator/OpenReader.app
xcrun simctl launch SIMULATOR_UDID top.xujialiu.openreader
```

保留已有应用的数据，直接覆盖安装。不要用卸载应用或抹掉模拟器作为日常更新步骤。
随后完成上面的 Metro 连接检查与下面的交互验证。

### 已遇到：Debug 链接使用了 Release 的 React framework

2026-09-20，Debug 链接缺少 `facebook::react::Sealable` 和
`ShadowNode::getDebugName` 符号。`React-Core-prebuilt/.last_build_configuration`
缺失时，React Native 的 `replace-rncore-version.js` 将未标记的 framework
视为 Debug，跳过替换；实际安装的却是 Release 二进制。

当且仅当遇到相同符号错误，检查当前 framework 的符号、生成的配置标记和本地
替换脚本。此前修复是将生成标记设为 Release，再用已安装的脚本切换到 Debug，
从缓存提取 Debug archive。`nm` 随后找到 Sealable 构造函数，构建通过。
这不是每次构建必做的操作；完整测量保留在当天工程日志中。

## 最后的交付验证

1. 打开受修改影响的页面，核对本次最终代码的可见变化。
2. 操作变化的控件，检查其结果；需要时保存模拟器截图：

   ```bash
   xcrun simctl io SIMULATOR_UDID screenshot /tmp/openreader-simulator-final.png
   ```

3. 在报告中区分构建、安装、启动和交互验证；调用控件处理器不等同于物理触摸测试。
4. 停止播放，保留最新应用打开在方便检查的页面。Debug 交付同时保留正确的 Metro。

纯界面检查不需要播放。需要音频时，先将模拟器音量降为零，再按测试要建立的
事实决定播放时长，并在事实建立后立即停止。凭据只按需从仓库 `.secrets/` 读取，
不得出现在截图、日志或文档中。

### 没有可操作的模拟器窗口

先检查本机 Xcode 提供的模拟器入口。本机 Xcode 27 的入口为
`Xcode-27.0.0.app/Contents/Applications/DeviceHub.app`，不应反复尝试不存在的
`Developer/Applications/Simulator.app`。启动设备、安装应用和启动应用仍可通过
`simctl` 完成；窗口不可用不等于这些步骤不可做。

截图和实际运行状态可以帮助定位问题，但截图本身不证明交互成功。
如果自动化窗口仍不可用，继续排查窗口、权限和会话状态；如用调试处理器完成
交互验证，要明确其覆盖范围，移除临时调试代码，再确认最终工作区代码已加载。
真正的外部阻塞必须明确报告，未完成的模拟器交付不能写成完成。
