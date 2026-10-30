# 验证与发布前检查

在仓库根目录运行：

```sh
npm run verify
```

验证脚本依次执行 TypeScript 类型检查、已配置的 lint、全量 Vitest 测试和扩展构建，并检查 Chrome、Edge（复用 Chromium 包）、Firefox、Safari macOS 所需文件。测试覆盖本地离线存储、URL 重复处理、HTML/JSON 导入导出、WebDAV 错误与冲突、集合层级、保存/撤销、筛选/视图和可访问 UI。

发布前还需人工检查：

1. 在四类桌面浏览器安装包中完成当前页保存、打开书签库、搜索和导出。
2. 断网、错误凭据、远端只读和冲突时确认本地数据仍可读写，自动同步暂停并显示重试。
3. 在窄 popup、深色主题和纯键盘操作下确认焦点可见、控件有语义名称、长文本不横向溢出。
4. 在 Safari macOS 的 Xcode 包装中核对签名、权限提示、更新方式和 Apple 审核材料。
5. 在书签库核对批量操作：Shift 连选、全选、移动、改标签、查找替换、清理重复项和拖到侧栏，每一步都能撤销（Ctrl+Z 或提示条）。

界面预览：`npm run preview` 用内存数据运行真实后台逻辑。`?reset=1&bulk=10000` 可以生成大型书签库，`?theme=dark`、`?accent=ember`、`?lang=zh` 用于切换外观和语言。
