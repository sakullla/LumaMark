# LumaMark Chrome Web Store 上架包

目标版本：`0.1.1`。

## 已准备材料

- 中文商店文案：`listing.zh-CN.md`
- 英文商店文案：`listing.en-US.md`
- 公开隐私政策：`privacy-policy.md`
- 权限与隐私申报草稿：`privacy-practices.md`
- 商店截图和宣传图：`assets/`
- 待上传 ZIP：`lumamark-chrome-store-0.1.1.zip`
- ZIP 校验：`SHA256SUMS.txt`

ZIP 不在本目录中，位于 `dist/chrome-store/lumamark-chrome-store-0.1.1.zip`，避免把商店素材误打进扩展包。

## 提交步骤

1. 先将本目录和产品变更推送到 GitHub `main`，使隐私政策 URL 可公开访问。
2. 打开 https://chrome.google.com/webstore/devconsole ，注册或登录开发者账号。
3. 选择 **Add new item**，上传 `dist/chrome-store/lumamark-chrome-store-0.1.1.zip`。
4. 按对应语言粘贴商店文案，并上传 `assets/` 中的图片。
5. 按 `privacy-practices.md` 填写权限理由、单一用途、数据处理和有限使用声明。
6. 隐私政策填写：https://github.com/sakullla/LumaMark/blob/main/store/chrome/privacy-policy.md
7. 在 Distribution 中选择公开范围、地区及可见性。首次建议先设为不公开或可信测试人员检查，确认后再公开。
8. 如审核人员必须测试 WebDAV，提供专用测试账号和 HTTPS 测试地址；不要提供个人凭据。
9. 提交审核前重新检查版本号、ZIP 校验和、全部截图及隐私申报。

## 素材规格

- 截图：1280×800 PNG，1–5 张。
- 小宣传图：`assets/promo-tile-440x280.png`，440×280 PNG。
- 顶部宣传图块：`assets/marquee-promo-1400x560.png`，1400×560 PNG。
- 扩展图标：ZIP 内已有 128×128 PNG。

所有商店图片均为 24 位 RGB PNG，不含 alpha 透明层。

截图使用项目预览中的示例数据，不包含真实用户书签或 WebDAV 凭据。
