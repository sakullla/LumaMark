# Chrome Web Store 隐私与权限申报草稿

以下内容用于填写开发者后台的 Privacy practices。表单措辞可能调整，应按实际页面逐项映射，不要把“本地处理”误填成“完全不处理用户数据”。

## 单一用途（Single purpose）

**English:**

LumaMark is a bookmark manager that lets users save, organize, import, export, and synchronize bookmarks through the browser's built-in bookmarks and an optional user-configured WebDAV service.

**中文：**

LumaMark 是书签管理器，用于保存、整理、导入导出书签，并通过浏览器自带书签和用户可选的 WebDAV 服务进行同步。

## 远程代码（Remote code）

申报：不使用远程代码。

依据：构建产物将 TypeScript、样式和页面逻辑打包进扩展；运行时仅从用户配置的 WebDAV 地址读取或写入 JSON 同步文件，不下载或执行 JavaScript。

## 数据处理声明

| 数据类型 | 实际行为 | 申报要点 |
| --- | --- | --- |
| Web browsing activity / 网页浏览活动 | 保存用户选择的书签网址和标题；内容脚本读取当前页标题、图标地址及右键链接上下文 | 仅在本地处理，或在启用后发送到用户指定的 WebDAV；不发送给开发者 |
| Authentication information / 认证信息 | 保存用户填写的 WebDAV 用户名和密码 | 本地保存，仅向用户指定的 WebDAV 服务器认证；不要填写为完全不处理认证信息 |
| User-generated content / 用户生成内容 | 用户添加的标签、备注、文件夹名称 | 本地保存，启用后进入用户指定的 WebDAV 同步文件 |
| Website content / 网站内容 | 网址、标题、网站图标地址 | 不保存网页正文、截图、PDF 或永久快照 |
| Financial、health、location、personal communications | 当前功能不处理 | 按实际表单选择“不处理” |

如果表单询问“是否向开发者或开发者选择的第三方收集/传输数据”，当前实现没有开发者服务器，也没有分析或广告 SDK。只有用户主动配置 WebDAV 后，数据才传输给用户选择的服务商。

## 数据用途与有限使用认证

可确认的实现事实：

- 数据只用于用户可见的书签保存、整理、导入导出、浏览器书签同步和 WebDAV 同步功能。
- 不出售或出租数据，不用于个性化、再营销或基于兴趣的广告。
- 没有广告、分析或行为画像功能。
- 开发者不日常读取用户数据；用户主动提交的支持材料仅用于处理该支持请求。
- 隐私政策公开说明收集、使用、共享、保留和删除方式。

## 权限理由（可粘贴英文）

### `storage`

Required to store bookmarks, folders, preferences, synchronization configuration, and sync state locally in the browser.

### `tabs`

Required to read the active tab's URL, title, and favicon when the user saves the current page. LumaMark does not use this permission to collect browsing history.

### `bookmarks`

Required for LumaMark's core feature: reading and updating Chrome's built-in bookmarks so browser bookmarks and LumaMark stay in two-way sync. Users can disable browser-bookmark integration in Settings.

### `alarms`

Required to run optional automatic WebDAV synchronization periodically. Users can disable automatic sync.

### `contextMenus`

Required to add the “Save to LumaMark” page and link context-menu action.

### `commands`

Required for the user-configurable keyboard shortcut that saves the current page (Alt+Shift+L by default).

### `notifications`

Required to show save results and provide actions such as opening the library or undoing a save.

### `favicon`

Required to display icons from Chrome's local favicon cache. LumaMark does not use this permission to request favicons from websites.

### Host permissions: `http://*/*` and `https://*/*`

Required on HTTP(S) pages to read the limited page metadata used for saving (title, favicon address, and right-clicked link context), and to connect to a WebDAV server chosen by the user. LumaMark does not read or transmit page bodies and does not connect to a developer-operated server.

### Content scripts on HTTP(S) pages

Required to provide page metadata for saving and to identify the link selected through the context menu. Processing is limited to the page title, favicon address, and the clicked link's URL and visible text.

## 发布前人工核对

- 使用 HTTPS WebDAV 地址测试，不要在公开截图或测试说明中提供真实密码。
- 如果审核人员需要测试同步，可提供单独的测试 WebDAV 账号；不要复用个人账号。
- 确认商店截图只包含预览示例数据。
- 确保商店文案、隐私政策、数据申报与实际行为保持一致。
