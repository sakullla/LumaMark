# 浏览器支持矩阵

| 浏览器 | 交付包 | 当前页保存 | 书签库/搜索 | 导入导出 | 同步 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| Chrome | Chromium WebExtension | 支持 | 支持 | HTML/JSON | WebDAV | MV3 权限提示 |
| Edge | Chromium WebExtension（复用 Chrome 包） | 支持 | 支持 | HTML/JSON | WebDAV | 使用 `edge://extensions` 加载 |
| Firefox | Firefox WebExtension | 支持 | 支持 | HTML/JSON | WebDAV | 临时包或签名包 |
| Safari macOS | Safari Web Extension 包装 | 支持 | 支持 | HTML/JSON | WebDAV | 需要 Xcode 包装、签名和 Apple 审核 |
| Safari iOS/iPadOS | 不交付 | — | — | 可通过导出迁移 | — | 移动 Safari 不在首发范围 |

所有平台共享同一数据模型和核心交互语义。浏览器不支持某项 API 时，popup、书签库页或设置页提供等价入口；不使用浏览器厂商同步作为数据层。
