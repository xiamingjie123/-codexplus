# Legacy Final 基线执行记录

日期：2026-07-16

状态：自动化与本地 Windows release 基线完成；正式切换前的双平台和长稳实机验收不在本记录中冒充完成。

## 1. 基线范围

- 产品代码 commit：`10a0663522bb765036ad340a7acbbab1a355247c`
- 产品版本：`1.2.47`
- 计划标签：`legacy-final-v1.2.47-20260716`
- 本地分支：`main`
- 对比远端：本地比 `origin/main` 多 `feat(manager): redesign Codex Deck pages`
- 基线测试修正：只更新 UI 契约测试，使其验证新标题结构和新删除按钮行为，不修改产品行为。

## 2. 自动化结果

| 项目 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm run vite:build` | 通过；1606 modules，存在已有的单 chunk 大于 500 kB 警告 |
| `cargo fmt --all -- --check` | 通过 |
| `git diff --check` | 通过；Git 仅提示 Windows 下未来可能转换 LF/CRLF |
| core library | 149 通过，1 个联网测试 ignored |
| core integration | ads 7、bridge_routes 27、cdp_bridge 78、app_state 5、sqlite 11、locale 5、installers 10、launcher 67、catalog 8、suffix 14、paste 5、proxy 82、relay config 114、rotation 15、switch 5、updater 9、worktree 14、watcher 17、Zed 27，全部通过 |
| codex-plus-data | 4 + 23 + 22 通过 |
| codex-plus-launcher | 8 通过 |
| codex-plus-manager | unit 31、windows_subsystem 24，全部通过 |
| `cargo build --release` | 通过 |

## 3. Windows 740 说明

Windows 拒绝直接启动以下 Cargo 测试二进制并返回 `os error 740`：

- 文件名命中系统 installer/updater 启发式的测试目标；
- 继承产品 `requireAdministrator` manifest 的 launcher/manager 测试目标。

验证方式：

1. 保留 Cargo 编译出的原测试二进制不变。
2. 复制到 `target/debug/deps` 下的中性临时文件名。
3. 对 launcher/manager 的复制品使用 Windows SDK `mt.exe` 写入测试专用 `asInvoker` manifest。
4. 在原 package working directory 执行相同 Rust test harness。

该方式没有修改产品 manifest、产品源代码或测试逻辑。对应测试全部通过。

## 4. Release 产物

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `target/release/codex-plus-plus.exe` | 21,627,392 bytes | `92831AD10AA9F1A136B26F000A03D0354DA672299ABF9D9CC9CC0D85698A11CC` |
| `target/release/codex-plus-plus-manager.exe` | 26,657,792 bytes | `C99D63C945E281CFA6E4D2AF3D0E63CD90ED182E23CAB564E693144810FFF011` |

## 5. 已知边界

- `update::live_update_manifest_is_reachable` 需要访问公开 GitHub Release，按现有定义为 ignored；本记录未把它算作通过的离线测试。
- 当前机器只生成并验证 Windows release 二进制；macOS x64/arm64 必须由后续独立 Deck CI 和真实 macOS 设备验收。
- 本记录冻结 Legacy 的功能和自动化基线，不等于 Codex Deck 已满足 2 小时、100 次切换和三次迁移演练。
- 未在用户真实会话数据上执行破坏性删除、provider 重写或安装/卸载操作；这些能力由现有测试和功能矩阵固定，Deck 正式切换前必须在隔离副本与真实链路中重新验收。
- 正式发布、推送标签和停止 Legacy 维护均未获本记录自动授权。

## 6. 结论

Legacy 本地最终版本具备可编译、可测试的基线。Codex Deck 新仓库应以功能等价矩阵为迁移契约，不得将 Legacy crate 作为生产依赖，也不得把当前长期 CDP bridge 和无界日志结构复制到新 Runtime。
