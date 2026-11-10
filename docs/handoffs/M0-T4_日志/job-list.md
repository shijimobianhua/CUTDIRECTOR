# M0-T4 runtime job 列表（节选）

- 日期：2026-11-04
- 工具：`job_list`
- 只列本小样相关的四个 runtime job

```text
bash-eb89825617c8436f [bash] completed — video demo bj-1793786010513-vytvi3
bash-5b221e0cdb8744c8 [bash] failed    — video demo bj-1793786022731-asyvxw
bash-fa6049f8da57461c [bash] killed    — video demo bj-1793786030482-ors0x8
bash-8e85562c0e444a34 [bash] killed    — video demo bj-1793786038723-tsa3s0
```

说明：`kind` 使用 DSH 已注册的 `bash`，`label` 标为 `video demo <businessJobId>`；没有新增 DSH job kind，也没有把 DSH completed 直接当业务成功。
