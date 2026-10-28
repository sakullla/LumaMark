# LumaMark 安装与更新

## 浏览器扩展

- **Chrome**：在发布包或本地 `dist/extension/chrome` 中加载扩展。需要 `storage`、`tabs`、`contextMenus`、`commands`、`notifications` 和用户主动保存当前页所需的活动页权限。
- **Edge**：使用同一 Chromium 兼容包（`dist/extension/chrome`），在 `edge://extensions` 开启开发人员模式后加载；权限和更新方式与 Chrome 相同。
- **Firefox**：加载 `dist/extension/firefox`，在 `about:debugging` 的临时扩展页面安装；Firefox 的签名/发布更新遵循 Mozilla 发布流程。
- **Safari macOS**：使用 `dist/extension/safari` 作为 Xcode Safari Web Extension target 的输入，完成 Apple 签名与审核后安装。Safari 的权限提示、更新和包装方式与 Chromium/Firefox 不同。

扩展入口包含 popup、右键菜单和快捷键；完整书签库与设置页由扩展页面打开。更新前可从设置导出 LumaMark JSON；更新包不会要求登录 Google、Microsoft、Firefox 或 Apple 账号。

## 数据与同步

核心书签先写入本地 IndexedDB，离线时仍可保存、编辑、搜索、导入和导出。只有用户配置并执行 WebDAV 同步时，数据才会发送到指定地址；认证失败、网络中断或远端只读不会删除本地数据。卸载前请在设置中导出备份。

## 首发范围

首发支持桌面 Chrome、Edge、Firefox 和 Safari macOS。移动 Safari、团队协作、社交分享、S3/自有服务同步、浏览器厂商账号同步以及网页全文/截图/PDF 归档不在首发范围。
