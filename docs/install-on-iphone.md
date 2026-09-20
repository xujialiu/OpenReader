# 将 OpenReader 安装到 iPhone

适用：用本地 Mac 给自己的 iPhone 安装可脱离电脑运行的 Release 版本。
以下流程来自 2026-09-20 的实际安装。项目含自定义原生模块，需编译原生应用，不能用 Expo Go 代替。

## 本次验证的结果

- 环境：Expo SDK 57、Xcode 27.0（27A266a）；项目最低 iOS 版本为 17.2。
- 真机：`Xujia’s iPhone`，UDID `00008140-001651843E40801C`。
- Workspace：`ios/OpenReader.xcworkspace`；scheme：`OpenReader`。
- Bundle ID：`top.xujialiu.openreader`。
- 使用 `Xujia Liu (Personal Team)` 自动签名，证书为 Apple Development。
- 下文的 `xcodebuild` 命令返回 0；`devicectl` 确认应用安装成功。
- 自动启动返回 Security 错误，包含“profile has not been explicitly trusted by the user”。已提示用户在手机信任开发者；本次记录没有确认信任后的启动、阅读或音频功能。

设备、账号和路径是此次记录，换电脑或手机时应重新查询。后续若用户已完成信任并成功启动，应更新验证结果。

## 首次准备

1. iPhone 用数据线连接 Mac，解锁并选择“信任此电脑”。在手机“设置 → 隐私与安全性 → 开发者模式”开启开发者模式，按手机提示完成重启和确认。
2. Xcode → Settings → Accounts 登录 Apple ID。选中账号，在 Manage Certificates → ＋ → Apple Development 创建证书（已有有效证书时跳过）。
3. 从仓库根目录打开 workspace：

   ```bash
   open ios/OpenReader.xcworkspace
   ```

4. 按 ⌘1 显示项目导航，点击最左侧蓝色 OpenReader 项目。中间窄栏有 PROJECT 和 TARGETS 两组，点击 **TARGETS 下的 OpenReader**。选 PROJECT 或 Pods 都不是应用的签名设置。
5. 右侧 Signing & Capabilities → All，勾选 Automatically manage signing，在 Team 选择自己的团队。顶部运行设备选择真机 `Xujia’s iPhone`，而非 iPhone 18 Pro 等模拟器。

此仓库的 `ios/` 是生成目录；若不存在，先安装项目依赖并执行 `npx expo prebuild --platform ios`，然后打开 workspace。重新生成原生目录后应复查签名团队。无需为日常安装删除或清理原生目录。

## 后续安装：检查、构建、安装、启动

以下命令从仓库根目录执行。手机保持连接并解锁。

### 1. 确认真机和证书

```bash
xcrun devicectl list devices
security find-identity -v -p codesigning
xcodebuild -version
```

应看到真实 iPhone，以及至少一个有效 Apple Development identity。`0 valid identities found` 表示仅登录账号仍不够，需要创建证书。设备列表也包含模拟器，按真实设备的 UDID 选择。

### 2. 编译可独立运行的 Release 版本

本项目此次成功使用的命令：

```bash
xcodebuild \
  -workspace ios/OpenReader.xcworkspace \
  -scheme OpenReader \
  -configuration Release \
  -destination 'id=00008140-001651843E40801C' \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  ENABLE_USER_SCRIPT_SANDBOXING=NO \
  -quiet build
```

换手机时替换 destination 的 UDID。首次构建会编译原生依赖，耗时明显长于后续增量构建。以退出码 0 为成功依据，不以日志出现 warning 或生成了 `.app` 目录判断成功。

- `-allowProvisioningUpdates`：允许 Xcode 使用已登录账号创建或更新签名描述文件。
- `-allowProvisioningDeviceRegistration`：允许自动签名时注册目标设备。
- `ENABLE_USER_SCRIPT_SANDBOXING=NO`：此次构建需要的 Xcode 构建选项，让 React Native 打包脚本可以读取项目并写入 JS bundle；仅作用于该次命令，没有修改项目配置。
- Release 将 JavaScript 和资源打包进应用，运行时无需 Metro 或保持电脑连接。在线语音服务等功能仍需要网络。

### 3. 找到并安装构建产物

此次构建产物位于：

```text
/Users/xujialiu/Library/Developer/Xcode/DerivedData/OpenReader-buxlmytdygazkfacxjuwdxvtamkb/Build/Products/Release-iphoneos/OpenReader.app
```

同一 checkout 可使用下方已验证命令。换电脑、checkout 或 DerivedData 配置后，先用构建设置查询 `TARGET_BUILD_DIR` 与 `FULL_PRODUCT_NAME`，取 **OpenReader target** 对应的值拼成应用路径：

```bash
xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader \
  -configuration Release -sdk iphoneos -showBuildSettings \
  | rg 'Build settings for action|TARGET_BUILD_DIR =|FULL_PRODUCT_NAME ='
```

```bash
xcrun devicectl device install app \
  --device 00008140-001651843E40801C \
  /Users/xujialiu/Library/Developer/Xcode/DerivedData/OpenReader-buxlmytdygazkfacxjuwdxvtamkb/Build/Products/Release-iphoneos/OpenReader.app
```

成功输出应包含 `App installed` 和 `bundleID: top.xujialiu.openreader`。

### 4. 信任开发者并启动

首次安装后，在 iPhone“设置 → 通用 → VPN 与设备管理”中找到 Apple ID 对应的开发者条目，点击“信任”，按系统提示完成。此操作由用户在手机上完成。

从桌面点击 OpenReader，或执行：

```bash
xcrun devicectl device process launch \
  --device 00008140-001651843E40801C \
  top.xujialiu.openreader
```

验收分开记录：构建成功、安装成功、启动成功。确认应用正常显示后，可断开电脑再次打开，验证独立运行。安装成功本身不证明启动或业务功能正常。

## 已遇到的问题：直接按对应分支处理

| 现象 | 本次结论与处理 |
| --- | --- |
| Expo 报 `No code signing certificates are available to use` | `security find-identity` 确认为 0；在 Xcode 创建 Apple Development 证书后解决。 |
| Xcode 显示 `Communication with Apple failed`，具体说明 team 没有设备；同时提示没有 profile | 选择真实 iPhone，并使用上面的自动签名及设备注册参数；此次因此继续进入编译。该标题本身不足以判断是网络故障，应读取其详细原因。 |
| `npx expo run:ios --device … --configuration Release` 报 `No profiles … found`，要求 `-allowProvisioningUpdates` | 此次 Expo 命令没有完成 profile 创建，改用上面的 `xcodebuild` 命令成功。不要反复执行同一条 Expo 命令期待签名自动恢复。 |
| `Sandbox: node … deny(1) file-read-data` 或写入 `main.jsbundle` 被拒绝 | 是 Xcode 构建脚本沙盒限制；加 `ENABLE_USER_SCRIPT_SANDBOXING=NO` 后本次构建返回 0。 |
| 安装成功，启动报 `CoreDeviceError 10002` / `Security` | 错误列出签名、entitlements 或尚未信任 profile 等可能原因；先在手机完成开发者信任，再重试。若已信任仍失败，继续检查实际签名与描述文件，不把所有 Security 错误都归为未信任。 |

个人团队安装受描述文件有效期限制；Release 只表示构建方式，不代表永久签名。到期后需重新签名安装。不要为此卸载旧应用：卸载可能删除本地书库和设置。

## 参考

- [Expo SDK 57 文档](https://docs.expo.dev/versions/v57.0.0/)
- [Expo 本地编译和真机选择](https://docs.expo.dev/guides/local-app-development/)

具体故障和成功命令以上面的实测为准；无需每次重新探索安装路径。
