# 浏览器支持矩阵

| 浏览器 | 交付包 | 浏览器自带书签 | 当前页保存 | 书签库/搜索 | 导入导出 | 同步 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Chrome | Chromium WebExtension | 双向同步（书签栏、其他书签） | 支持 | 支持 | HTML/JSON | WebDAV | 不接管新标签页；可用 WebDAV 默认开启自动同步，可以关闭 |
| Edge | Chromium WebExtension（复用 Chrome 包） | 双向同步（收藏夹栏、其他收藏夹） | 支持 | 支持 | HTML/JSON | WebDAV | 使用 `edge://extensions` 加载；行为与 Chrome 相同 |
| Firefox | Firefox WebExtension | 双向同步（书签工具栏、其他书签、书签菜单） | 支持 | 支持 | HTML/JSON | WebDAV | 临时包或签名包 |
| Safari macOS | Safari Web Extension 包装 | 不支持（Safari 没有书签 API） | 支持 | 支持 | HTML/JSON | WebDAV | 只同步 LumaMark 自己的书签列表；需要 Xcode 包装、签名和 Apple 审核 |
| Safari iOS/iPadOS | 不交付 | — | — | — | 可通过导出迁移 | — | 移动 Safari 不在首发范围 |

所有平台共享同一数据模型和核心交互语义。在 Chrome、Edge 和 Firefox 上，LumaMark 把浏览器自带的书签当作书签本身：书签栏对应 LumaMark 的书签栏文件夹，“其他书签”里的内容对应顶层文件夹和书签，Firefox 的“书签菜单”在其他浏览器里显示为名为“书签菜单”的文件夹。在浏览器里新建、改名、移动、删除书签或调整顺序，会写进 LumaMark 并通过 WebDAV 同步到其他浏览器；其他浏览器的改动也会写回这台浏览器的书签。移动设备书签、分隔线、`javascript:` 书签小程序和企业策略管理的书签不参与同步，也不会被修改。

LumaMark 不再替换新标签页；首页可以从工具栏卡片打开。配置可用的 WebDAV 后自动同步默认开启，并可以关闭。浏览器书签同步可以在设置页关闭，关闭后 LumaMark 只维护自己的列表。不使用浏览器厂商账号或厂商同步作为数据层；如果同时开启了浏览器厂商的书签同步，两者会同步同一份书签，建议只保留一种跨设备同步方式。
