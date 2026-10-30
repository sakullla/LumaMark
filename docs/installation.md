# LumaMark 安装与更新

## 浏览器扩展

- **Chrome**：在发布包或本地 `dist/extension/chrome` 中加载扩展。需要 `storage`、`tabs`、`bookmarks`、`alarms`、`contextMenus`、`commands`、`notifications` 和用户主动保存当前页所需的活动页权限。`bookmarks` 权限用于读写浏览器自带的书签，以便同步。
- **Edge**：使用同一 Chromium 兼容包（`dist/extension/chrome`），在 `edge://extensions` 开启开发人员模式后加载；权限和更新方式与 Chrome 相同。
- **Firefox**：加载 `dist/extension/firefox`（同样需要 `bookmarks` 权限），在 `about:debugging` 的临时扩展页面安装；Firefox 的签名/发布更新遵循 Mozilla 发布流程。
- **Safari macOS**：使用 `dist/extension/safari` 作为 Xcode Safari Web Extension target 的输入，完成 Apple 签名与审核后安装。Safari 的权限提示、更新和包装方式与 Chromium/Firefox 不同；Safari 没有书签 API，因此 Safari 包不申请 `bookmarks` 权限，只同步 LumaMark 自己的书签列表。

扩展入口包含工具栏保存卡片、右键菜单和快捷键。LumaMark 不替换新标签页：保存的书签直接出现在浏览器自带的书签栏里。工具栏卡片可以打开 LumaMark 首页（单行书签栏、保存当前页、导入和本地搜索），完整书签库与设置页由扩展页面打开。更新前可从设置导出 LumaMark JSON；更新包不要求 Google、Microsoft、Firefox 或 Apple 账号。

## 数据与同步

首次运行时，LumaMark 读取浏览器现有的书签（书签栏和其他书签），之后双向保持一致：在浏览器里增删改书签会写进 LumaMark，WebDAV 同步带来的改动也会写回浏览器书签。第二台浏览器加入时，相同文件夹中网址相同的书签会合并成一条，不会出现重复。核心书签先写入本地 IndexedDB。离线时书签栏、菜单、本地搜索和打开已保存的链接仍然可用。搜索地址只保存在这台浏览器，不写入 WebDAV 同步文件。只有用户填入可用的 WebDAV 地址后才会同步：保存连接时立即检查，连通后自动同步默认开启，并可以关掉；手动同步仍然可用。凭据失败、远端拒绝写入、空间不足或地址不可达会暂停自动同步，已有本地书签保持不变。卸载前请在设置中导出备份。

## 首发范围

首发支持桌面 Chrome、Edge、Firefox 和 Safari macOS。移动 Safari、团队协作、社交分享、S3/自有服务同步、浏览器厂商账号同步以及网页全文/截图/PDF 归档不在首发范围。
