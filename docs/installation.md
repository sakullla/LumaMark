# LumaMark 安装与更新

## 浏览器扩展

- **Chrome**：在发布包或本地 `dist/extension/chrome` 中加载扩展。需要 `storage`、`tabs`、`contextMenus`、`commands`、`notifications` 和用户主动保存当前页所需的活动页权限。
- **Edge**：使用同一 Chromium 兼容包（`dist/extension/chrome`），在 `edge://extensions` 开启开发人员模式后加载；权限和更新方式与 Chrome 相同。
- **Firefox**：加载 `dist/extension/firefox`，在 `about:debugging` 的临时扩展页面安装；Firefox 的签名/发布更新遵循 Mozilla 发布流程。
- **Safari macOS**：使用 `dist/extension/safari` 作为 Xcode Safari Web Extension target 的输入，完成 Apple 签名与审核后安装。Safari 的权限提示、更新和包装方式与 Chromium/Firefox 不同。

扩展入口包含新标签页首页、工具栏保存卡片、右键菜单和快捷键。新标签页是 LumaMark 首页：单行书签栏、保存当前页、导入和本地搜索都在这一页。工具栏图标仍打开保存卡片，卡片可以再打开同一首页。完整书签库与设置页由扩展页面打开。更新前可从设置导出 LumaMark JSON；更新包不要求 Google、Microsoft、Firefox 或 Apple 账号。

## 数据与同步

核心书签先写入本地 IndexedDB。离线时书签栏、菜单、本地搜索和打开已保存的链接仍然可用。搜索地址只保存在这台浏览器，不写入 WebDAV 同步文件。只有用户填入可用的 WebDAV 地址后才会同步：保存连接时立即检查，连通后自动同步默认开启，并可以关掉；手动同步仍然可用。凭据失败、远端拒绝写入、空间不足或地址不可达会暂停自动同步，已有本地书签保持不变。卸载前请在设置中导出备份。

## 首发范围

首发支持桌面 Chrome、Edge、Firefox 和 Safari macOS。移动 Safari、团队协作、社交分享、S3/自有服务同步、浏览器厂商账号同步以及网页全文/截图/PDF 归档不在首发范围。
