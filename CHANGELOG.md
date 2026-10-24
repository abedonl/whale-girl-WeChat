# 更新记录

## 3.0.4

### 修「设置里找不到看图 API」

- **3.0.3 的包里 `web/index.html` / `web/assets/app.js` 是旧版**：改了源目录但打包时从一份没同步全的副本取，于是设置面板里根本没有「看图 API Key」，接口也没接上。以源码目录 `src/`、`web/` 同时打包为准，已修正。
- 字段改名为 **「图片识别 · 看图 API Key」**，紧跟在主 API Key 下面（设置面板可滚动，`max-height:88dvh`）。
- 新增 **`scripts/release-check.js`**：打包前跑一遍，逐项检查用户能看到的功能是否真在包里 —— 看图字段/接口、主人识别、UIA 诊断、隐私目录、版本号与 CHANGELOG 一致性。这次的事故就是它能当场拦下的。
- `npm run release-check` 可直接跑。
## 3.0.3

### 「热激活 UIA 失败」可诊断了

- **桥接预热失败时会自动说明原因**：`explain_uia_failure()` 会打印 `UIA 诊断（原因A/B/C）` 加一条下一步建议 —— 以前只有一句「UIA 不可用」，分不清是枚举不到 `Weixin.dll`、版本不支持、还是补丁校验失败。
- **新增只读诊断工具 `tools/uia-diag.py`**：
  ```
  runtime\python\python.exe tools\uia-diag.py           # 只报告：路径/位数/ffmpeg/主窗/版本/候选 RVA/当前 mmui 状态
  runtime\python\python.exe tools\uia-diag.py --probe   # 真的热激活一次并计时
  runtime\python\python.exe tools\uia-diag.py --all     # 列出所有微信进程哪个才有 Weixin.dll
  ```
  实测在 4.1.15.56（库内置版本表只到 4.1.15.53）上会显示「特征扫描命中 0xB39C9D8」，能直接看出是扫描兜底还是版本不支持。
- 文档补了「热激活 UIA 失败」三类原因的排查表（含中文路径、微信缩在托盘这两个必然失败的坑）。
- 顺手修：`tools` 里的诊断脚本会复用桥接的 ffmpeg 查找逻辑，不再误报「没有 ffmpeg」。
## 3.0.2

### 看图：微信图片根本没被转码（「有时能认、有时不能」的真凶）

- **`wxgf` 是 HEVC 容器，不是 jpeg。** 微信 4.x 把普通图片也存成 `.wxgf`；桥接只看扩展名，于是把原始容器当 `image/jpeg` 发给视觉模型，接口回「图片输入格式/解析错误」。能认的那几次，是图片本来就存成了 jpg/png。现在桥接按**文件头**判格式：`wxgf` 先用 `_wxgf_to_jpg()` 转 JPEG；转不出来就明确提示「本机 ffmpeg 没装」并跳过，不再把垃圾数据发出去。
- **自动找 ffmpeg。** `ensure_ffmpeg_env()` 启动时把 `C:\ffmpeg\bin`、`runtime\ffmpeg\bin`、`%LOCALAPPDATA%\Programs\ffmpeg\bin` 等塞进 PATH —— 很多机器装了 ffmpeg，只是没加环境变量。
- **长截图分段识别。** 高宽比 > 2.2 的截图切成 2~3 段（带 8% 重叠）分别转写再拼起来，小字不再被整张缩糊。
- **服务端按文件头校正 mime**，遇到 wxgf 直接给可操作的报错，并顺手清掉 base64 里的 data URI 前缀/空白。
- **max_tokens 修正**：智谱 GLM-4V 系列上限是 **1024**，超了直接 400。现在按服务商区分（智谱 1024、其它 1600），可用 `vision.maxTokens` 覆盖。
- 提示词放宽到 900 字，并要求「每条消息都写到：不要省略、不要合并、不要只写大意」。
- 新增 4 条测试：wxgf 嗅探、wxgf 直发拦截、智谱 max_tokens 上限、桥接的 ffmpeg/wxgf/长截图。
## 3.0.1

### 看图（视觉模型）修好了

- **网页里根本没有看图 Key 的输入项**：`/api/settings` 不收 `visionApiKey`，`src/vision.js` 也只读 `config.json` 的 `vision.apiKey` —— 注释里承诺的「留空则用 data/settings.json 里的 Key」从来没实现，所以在网页里填了也永远提示「未配置视觉模型 Key」。现在：
  - 网页「设置」新增「看图 API Key」+「测试看图」按钮（可以先测再保存）；
  - Key 查找顺序：`config.vision.apiKey` → `settings.visionApiKey` → `settings.keys.vision` → `settings.keys.zhipu` → 环境变量 `ZHIPU_API_KEY` / `VISION_API_KEY`；
  - 新增 `POST /api/vision/test`：用内置的 64×64 PNG 试一次，只回颜色，能确认 Key 与网络都通。
- **报错更像人话**：没配 Key 时直接说明去哪儿填；401/403 时提示「这里要 open.bigmodel.cn 的智谱 Key，DeepSeek 的 Key 不支持看图」。
- 新增 6 条测试：Key 优先级、掩码不回显、报错文案、内置测试图是合法 PNG。

## 3.0.0

这一次主要修「主人识别」（`persona.master`）—— 之前就算在调试台把名单填对，微信里她仍然不认。

### 主人识别

- **统一判定**：新增 `src/master.js`，`matchMaster()` / `masterWarnings()` 是全项目唯一的主人与非主人判定。
  - 微信里只认不可修改的 `senderId`（`wxid_xxx`）；
  - 网页 / 抖音这类没有稳定 id 的渠道才允许按昵称认；
  - `wxids` 里有真 `wxid_` 值时昵称不能用来提权（防止改昵称冒充）。
- **修掉「填微信号静默失效」**：`master.wxids` 写成自己设的微信号（`abc12345` 这种）时，旧逻辑会连昵称兜底一起关掉，导致谁都不算主人。现在会识别出「这不像 wxid」并告警，同时在没有任何真 wxid 时退回昵称认。
- **调试台和真实链路一致**：`server.js` 的提示词预览改用同一个 `matchMaster()`，不会再出现「调试台说认了、微信里没认」。
- **认了之后要认账**：新增提示词段 `IDENTITY_FIX`（`src/persona.js`），让「名单还没配好时她说的否认」作废；`bot.js` 的 `stripMasterDispute()` 在**主人本人**说话时，把历史里「我是你主人吗 / 我是谁 / 你的主人是谁」这类追问连同她的否认整段剔掉（只影响本轮喂给模型的内容，记忆文件不动）；`finalize()` 再兜一层：模型若仍说出「别自封了 / 就一个名字罢了 / 冒充没用」，直接改成认下来。
- **可观测**：每条微信私聊在 `data/whale.log` 写一行 `[master] 私聊 昵称（wxid）→ 主人/非主人（原因）`；昵称在名单里但 id 对不上时额外 WARN 一次，直接告诉你该把哪串填进 `master.wxids`。
- 调试台「身份 / 主人」卡片新增：主人名单告警、「最近说过话的人（真实 senderId）」，以及提示词预览里的「按 wxid 认的 / 按昵称认的 / 昵称对得上但被挡住」。

### 测试与工具链

- `npm test` 改为 `node --test "tests/*.test.js"`：原来会扫进 `runtime/python/Lib/site-packages` 里 Python 包自带的 3 个 `.js`，一直报假失败。
- 修 `tests/providers.test.js` 把 `loadConfig({ root, env })` 写成 `loadConfig(root, {})`：`root` 落到真实项目目录，**跑一次测试就会把用户的 `data/settings.json` 覆盖成测试用的假 Key**。现在只用临时目录。
- 修 `saveSettings()` 用自算的 `keys` 覆盖调用方显式传入的 `keys`，导致「别的服务商的 Key 存不住、主 Key 失效时切不到备用」。
- `tests/voice.test.js` 不再要求 `data/persona.json` 一定存在（运行时才生成的文件）。
- `一键修复并自检.bat` 由 LF 改为 CRLF（cmd 才不报语法错）。
- 新增测试：`tests/master-match.test.js`（13 条）+ `tests/master.test.js` 里 6 条（身份纠错、剔除争执段、无关历史保留、普通人不受影响、否认兜底）。

### 仓库整理

- `.gitignore` 增加 `wechatauto_db/`（微信数据库快照，含隐私）；不再忽略 `tools/`（`hotkey_daemon.py` 是项目自己的热键脚本，被 `启动热键.bat` 调用）。
- 版本号 `3.0.0`。

## 2.9.2

上一个分发包的基线版本，无单独记录。
