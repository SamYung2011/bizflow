# 测试与 CI

每次 push 和 Pull Request 都会自动执行轻量测试：

```bash
npm run test:quick
```

完整 PostgreSQL 套件在 GitHub Actions 里走手动档：打开 `Tests` workflow，
选择 `Run workflow`，并把 `run_pg` 设为 `true`。本地等价命令是：

```bash
npm run test:pg
```

## DB 函数合并红线

分支只要新增或修改 PostgreSQL 函数/RPC（包括 migration 里的
`CREATE OR REPLACE FUNCTION`），合并前必须跑完 `npm run test:pg` 并确认两套
PostgreSQL 测试都通过。轻量测试通过不能代替这一步。
