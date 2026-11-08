# LumaMark 安装与更新

## 浏览器扩展

- **Chrome**：在发布包或本地 `dist/extension/chrome` 中加载扩展。需要 `storage`、`tabs`、`bookmarks`、`alarms`、`contextMenus`、`commands`、`notifications` 和用户主动保存当前页所需的活动页权限。`bookmarks` 权限用于读写浏览器自带的书签，以便同步。
- **Edge**：使用同一 Chromium 兼容包（`dist/extension/chrome`），在 `edge://extensions` 开启开发人员模式后加载；权限和更新方式与 Chrome 相同。
- **Firefox**：加载 `dist/extension/firefox`（同样需要 `bookmarks` 权限），在 `about:debugging` 的临时扩展页面安装；Firefox 的签名/发布更新遵循 Mozilla 发布流程。
- **Safari macOS**：使用 `dist/extension/safari` 作为 Xcode Safari Web Extension target 的输入，完成 Apple 签名与审核后安装。Safari 的权限提示、更新和包装方式与 Chromium/Firefox 不同；Safari 没有书签 API，因此 Safari 包不申请 `bookmarks` 权限，只同步 LumaMark 自己的书签列表。

扩展入口包含工具栏保存卡片、右键菜单和快捷键。LumaMark 不替换新标签页：保存的书签直接出现在浏览器自带的书签栏里。工具栏卡片可以打开 LumaMark 首页（单行书签栏、保存当前页、导入和本地搜索），完整书签库与设置页由扩展页面打开。更新前可从设置导出 LumaMark JSON；更新包不要求 Google、Microsoft、Firefox 或 Apple 账号。

## Chrome / Edge 更新与首次迁移

从 **v0.1.5** 起，Chrome / Edge 包包含永久公钥 `key`，固定扩展 ID 为 **`bookbjmmcebjikbdhdkmocppflemmgeb`**。后续版本必须保留此公钥，不要删除或重新生成。旧版本缺少公钥，加载已解压扩展时会因目录变化而产生不同 ID，浏览器便把它们当成不同扩展，数据和同步设置也彼此隔离。机制见 [Chrome manifest key 文档](https://developer.chrome.com/docs/extensions/reference/manifest/key)。

**从 v0.1.4 或更早版本升级，需要迁移一次：**

1. 在当前有完整数据的旧扩展设置中导出最新的 LumaMark JSON。若存在多个旧副本，分别备份；不要用较早的恢复文件覆盖最近新增的数据。
2. 记录 WebDAV 连接设置，关闭旧扩展的自动同步，并在浏览器扩展管理页停用所有旧副本。保留旧副本，直到核对迁移结果。
3. 将新包解压到一个长期保留的目录，在 `chrome://extensions` / `edge://extensions` 开启开发者模式并加载该目录，检查 ID 与上述值一致。
4. 在新扩展中导入刚导出的 JSON。首次启动会读取浏览器已有书签；导入是合并，预览遇到重复项时选择更新已有项，避免选择保留两份。核对目录、书签和最近新增项后，再配置 WebDAV 并启用同步。保存 WebDAV 连接会立即检查并开启自动同步，因此请先完成本地核对。
5. 确认备份和新扩展数据完整后，才移除旧副本。不同 ID 的本地数据库、凭据和界面偏好不会自动迁移。

**v0.1.5 之后的常规更新：**先导出备份，将新包内容覆盖到原来的固定目录，再点击扩展卡片的“重新加载”。无需卸载。即使解压目录改变，保留相同 `key` 的包也保持同一 ID；推荐固定目录，避免浏览器仍引用旧文件或误删正在使用的目录。

## Firefox 更新

从 v0.1.5 起固定 `browser_specific_settings.gecko.id` 为 **`lumamark@sakullla.github.io`**。旧包没有声明 ID，临时加载时 Firefox 会生成临时身份；固定 ID 避免后续版本再次改变身份。[Mozilla 扩展 ID 文档](https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/)

从旧包迁移时，先按上面的步骤导出最新 JSON、停用旧副本，再加载新版并导入核对、重新配置同步。开发测试时覆盖原目录，在 `about:debugging#/runtime/this-firefox` 中点击“重新加载”。临时扩展在浏览器重启后仍需重新加载；固定 ID 不会把临时安装变成永久安装。正式使用需要由 Mozilla 签名、保留同一 ID 的 XPI；当前发布的 ZIP 是开发测试包，不是已签名 XPI。[Firefox 临时安装说明](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)

## Safari macOS 打包与更新

当前 Safari ZIP 是 WebExtension 源码目录，不能直接作为 Safari 扩展安装；仓库尚未包含 Xcode 原生工程或已签名 App。需在 macOS 上用 Xcode 的 WebExtension 打包工具生成容器 App 和扩展 target。[Apple 打包说明](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)

Safari 的身份由原生工程管理，Chrome 的公钥和 Firefox 的 ID 不负责 Safari 更新。首次创建工程时确定容器 App 和扩展 target 各自的 Bundle Identifier 及签名 Team，后续版本复用同一工程、两个 Bundle Identifier 和 Team，只更新扩展资源及版本号；不要每次重新生成不同身份的 App。若已有安装，沿用其身份，不要为了匹配示例更改 Bundle Identifier。更新前导出 JSON；若确实需要改变身份，则按首次迁移处理数据。

Safari 构建会去除 Chrome 专属 `key`、`bookmarks` 和 `favicon` 权限。跨平台构建检查不能代替 macOS 上的签名、安装和升级验证。

## 自己部署的服务

Docker 镜像里只有一个 Node 进程。它提供登录、书签清单接口，以及一个可以在浏览器里打开的页面。账号、口令哈希和每个账号的一份 `lumamark-sync` 清单都写在镜像外的数据目录里，不另外启动数据库。网页和扩展都不能自行注册：管理员账号由环境变量提供，其他账号由管理员在网页上创建。

在仓库根目录构建并运行。把数据目录挂到容器内的 `/data`，并用环境变量给出管理员的用户名和密码（密码至少 8 个字符）：

```sh
docker build -t lumamark .
docker run -d --name lumamark -p 8787:8787 -v lumamark-data:/data -e LUMAMARK_DATA=/data \
  -e LUMAMARK_ADMIN_USERNAME=admin -e LUMAMARK_ADMIN_PASSWORD=你的管理员密码 lumamark
```

每次启动时，服务按这两个变量创建管理员账号；账号已经存在时，只把它的密码改成变量里的值。所以要改管理员密码，改环境变量后重新创建容器即可。两个变量只设了一个、或密码不足 8 个字符时，服务拒绝启动。两个都不设时服务照常运行，但网页上没有账号管理，只能用下面的命令行创建账号。

管理员登录网页后，点左下角的人像按钮打开“账号管理”：可以创建账号（可一键生成随机密码，创建后显示一次用户名和密码供复制）、重置其他账号的密码（对方在其他地方的登录随即失效）、删除账号（连同它的书签，需要再点一次确认）。管理员账号本身不能在网页上删除或改密码。管理员也有自己的书签库，和普通账号一样使用。

`lumamark-data` 是 Docker 卷。要改用本机目录，把 `-v lumamark-data:/data` 换成 `-v /你的目录:/data`。重启容器或用同一目录重新创建容器后，已经创建的账号和其中的书签都还在。

浏览器打开 `http://127.0.0.1:8787/`。这个页面可以登录并整理该账号的书签：搜索、新增、修改、回收站、导入导出。左侧按收藏、最近 30 天、未归类、重复网址、文件夹和标签筛选；勾选多条后可以批量移动、加标签、收藏或删除；删除后几秒内可以撤销；重复网址可以一键清理；文件夹可以直接新建、改名和删除。列表支持排序和列表、紧凑、卡片三种显示方式，深浅主题和强调色会记在这台电脑的浏览器里。刷新页面不需要重新登录，除非服务重启。新增和修改书签都在弹框里完成，`Ctrl + Enter` 保存，`Esc` 或点弹框外关闭。按 `/` 搜索，按 `n` 新增，按 `Esc` 取消选择。连不上服务时，页面不会把这种情况显示成一本空的书签库。这里不能注册，不保存当前页，也不读写浏览器书签栏。扩展仍然单独安装，不在这个镜像里。

没有配置管理员时，也可以在容器里用命令行创建账号。密码放在环境变量里，避免写进命令参数：

```sh
docker exec -e LUMAMARK_PASSWORD=你的密码 lumamark node apps/server/cli.mjs create-account --username alice
```

也可以直接对已经挂载出来的数据目录执行：

```sh
node apps/server/cli.mjs create-account --data /你的目录 --username alice --password 你的密码
```

用户名去掉首尾空白后按原文匹配，长度 1 到 64。未执行该命令时，任何登录都不会建立会话。密码错误时同样返回 401，响应里没有 token，也没有会话 cookie。重复创建同一个用户名会失败，原来的账号保持不变。

登录、读取和写入都只作用于这次会话对应的账号。账号甲的会话读不到账号乙的清单，写入也只会改自己的那一份。

登录：

```http
POST /api/session
Content-Type: application/json

{"username":"alice","password":"你的密码"}
```

成功时状态码 200，正文是 `{"username":"alice","token":"..."}`，并设置 HttpOnly cookie `lumamark_session`。随后的请求带 `Authorization: Bearer <token>`，或带这个 cookie。失败时状态码 401，正文是 `{"error":"unauthorized"}`。退出是 `DELETE /api/session`，状态码 204。

读取清单：

```http
GET /api/manifest
Authorization: Bearer <token>
```

成功时正文是 `format` 为 `lumamark-sync` 的清单，响应头 `ETag` 是这份内容的版本。服务只保存清单里的书签、文件夹和已清空 id，不保存搜索地址、主题或网页正文。

写入必须带上一次读到的 `ETag`：

```http
PUT /api/manifest
Authorization: Bearer <token>
Content-Type: application/json
If-Match: <GET 响应头 ETag 的原文>

{清单 JSON}
```

`ETag` 的原文形如 `"<64 位十六进制>"`，写回 `If-Match` 时保持这一层引号，不要再套一层。成功时状态码 200，响应头和正文里的 `etag` 都是新版本。没有 `If-Match` 时状态码是 428，版本对不上或者 `If-Match` 为 `*` 时状态码是 412。这两种情况下，原来的清单都不变。

没有 `POST /api/register`、`/api/signup` 或 `/api/accounts`。这些路径返回 404，不会创建账号。

账号管理接口只对管理员会话开放，未配置管理员时整组路径返回 404；未登录返回 401，普通账号返回 403：

- `GET /api/admin/accounts`：列出账号，正文 `{"accounts":[{"username":"admin","createdAt":"...","admin":true}]}`，不含口令哈希。
- `POST /api/admin/accounts`，正文 `{"username":"alice","password":"至少 8 个字符"}`：创建账号，成功 201；用户名已存在 409；密码太短 400（`weak_password`）。
- `PUT /api/admin/accounts/<用户名>/password`，正文 `{"password":"..."}`：重置密码，成功 204，该账号已有的会话全部失效。
- `DELETE /api/admin/accounts/<用户名>`：删除账号和它的清单，成功 204；不能删除管理员（400）。

登录和 `GET /api/session` 的正文里多一个 `admin` 字段，标明当前账号是不是管理员。

未登录时，扩展里的书签仍按原有方式使用 WebDAV。登录后的账号清单只通过上面的接口读写，不走 WebDAV。

检查镜像能否在重启后保留书签，可以运行：

```sh
node scripts/verify-server-docker.mjs
```

它会构建镜像、挂载数据目录、创建账号、写入一条书签、重启容器并确认该书签仍在，然后删除这次使用的容器。本机没有可用的 Docker 时，脚本会跳过并以成功状态退出。`npm test` 不运行这个脚本，也不需要 Docker。

## 数据与同步

首次运行时，LumaMark 读取浏览器现有的书签（书签栏和其他书签），之后双向保持一致：在浏览器里增删改书签会写进 LumaMark，WebDAV 同步带来的改动也会写回浏览器书签。第二台浏览器加入时，相同文件夹中网址相同的书签会合并成一条，不会出现重复。核心书签先写入本地 IndexedDB。离线时书签栏、菜单、本地搜索和打开已保存的链接仍然可用。搜索地址只保存在这台浏览器，不写入 WebDAV 同步文件。只有用户填入可用的 WebDAV 地址后才会同步：保存连接时立即检查，连通后自动同步默认开启，并可以关掉；手动同步仍然可用。凭据失败、远端拒绝写入、空间不足或地址不可达会暂停自动同步，已有本地书签保持不变。卸载前请在设置中导出备份。

## 首发范围

首发支持桌面 Chrome、Edge、Firefox 和 Safari macOS，以及上面的自行部署服务。移动 Safari、团队协作、社交分享、S3、浏览器厂商账号同步以及网页全文、截图或 PDF 归档不在范围内。
