# LumaMark

[![CI](https://github.com/sakullla/LumaMark/actions/workflows/ci.yml/badge.svg)](https://github.com/sakullla/LumaMark/actions/workflows/ci.yml)

本地优先的跨浏览器书签管理。浏览器扩展负责保存和整理书签；可选的自部署服务提供账号制同步和网页书签库，数据留在自己的服务器上。

## 组成

| 部分 | 说明 |
| --- | --- |
| 浏览器扩展 | Chrome / Edge / Firefox / Safari macOS：工具栏卡片、右键菜单、快捷键保存当前页，与浏览器自带书签双向同步 |
| 同步服务 | 单个 Node 进程（Docker 镜像）：账号登录、ETag 清单接口；账号与数据只写在镜像外的数据目录里 |
| 网页书签库 | 服务自带的 Web 页面：登录后搜索、新增、整理、批量管理、导入导出 |

扩展不登录账号时仍按原方式使用 WebDAV 同步；登录后改走自部署服务的账号清单接口。

## 快速开始：自部署服务

用仓库里的 `docker-compose.yml`（先把 `.env.example` 复制为 `.env` 并设置管理员账号）：

```sh
cp .env.example .env
docker compose up -d
```

打开 `http://127.0.0.1:8787/`，用管理员账号登录，在左下角“账号管理”里创建日常使用的账号。

也可以直接使用 CI 发布到 GitHub Container Registry 的镜像：

```sh
docker login ghcr.io -u <GitHub 用户名>   # 需要具有 read:packages 权限的令牌
docker run -d --name lumamark -p 8787:8787 -v lumamark-data:/data \
  -e LUMAMARK_DATA=/data \
  -e LUMAMARK_ADMIN_USERNAME=admin -e LUMAMARK_ADMIN_PASSWORD=<至少 8 位> \
  ghcr.io/sakullla/lumamark:latest
```

镜像标签：`latest`（main 分支最新）、`X.Y.Z` 和 `X.Y`（对应 `vX.Y.Z` 发布标签）、`sha-<commit>`（指定提交）。GHCR 包默认私有；首次发布后可在 package 设置中改为公开，或按上面的 `docker login` 拉取。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `LUMAMARK_DATA` | `/data`（镜像内） | 数据目录：账号口令哈希 + 每个账号一份 `lumamark-sync` 清单 |
| `LUMAMARK_ADMIN_USERNAME` / `LUMAMARK_ADMIN_PASSWORD` | 未设置 | 管理员账号；需同时设置，密码至少 8 位；不设则用 CLI 建号 |

接口与账号管理的完整说明见 [docs/installation.md](docs/installation.md)。

## 快速开始：浏览器扩展

从 [Releases](https://github.com/sakullla/LumaMark/releases) 下载对应平台 zip，或自行构建：

```sh
npm ci
npm run verify   # 类型检查 + 测试 + 构建 dist/extension/{chrome,firefox,safari}
```

各浏览器加载方式、固定扩展 ID 与升级迁移说明见 [docs/installation.md](docs/installation.md)。

## 开发

需要 Node 26（与 CI 和 Docker 镜像一致）。

```sh
npm ci
npm test                             # 单元测试，不需要 Docker
npm run typecheck
npm run verify                       # typecheck + 测试 + 三平台构建校验
npm run preview                      # 构建并本地预览扩展页面
node scripts/verify-server-docker.mjs  # 构建镜像，验证容器重启后数据保留；本机无 Docker 时跳过
```

## CI 与发布

- `ci.yml`：每次 push / PR 运行 `npm run verify`。
- `docker.yml`：先构建镜像并验证容器重启后数据保留，再发布 amd64/arm64 镜像到 GHCR；`v*` 标签额外打 `X.Y.Z` / `X.Y` 版本标签。
- `release.yml`：`v*` 标签把三平台扩展 zip 发布到 GitHub Releases（要求标签与 manifest 版本一致）。

## 文档

- [安装与更新](docs/installation.md) — 各浏览器安装、迁移、服务部署与接口
- [支持矩阵](docs/support-matrix.md)
- [隐私与数据](docs/privacy-and-data.md)
- [测试](docs/testing.md)
- [版本说明](docs/releases/)

## 许可证

[GPL-3.0](LICENSE)
