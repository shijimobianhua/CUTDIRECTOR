# M0-T4 DSH runtime job 输出

- 日期：2026-11-04
- 工具：`job_output`（DSH runtime job）
- 业务 job 与 runtime id 的映射见 [M0-T4_证据](../M0-T4_证据.md) §2

```text
bash-eb89825617c8436f  (success / bj-1793786010513-vytvi3)
started success
verifying
ok
[status: completed]

bash-5b221e0cdb8744c8  (failure / bj-1793786022731-asyvxw)
started failure
FAILED injected failure
[status: failed, injected failure]

bash-fa6049f8da57461c  (cancel / bj-1793786030482-ors0x8)
started slow
cancel requested: user canceled from M0-T4 demo
[status: killed, user canceled from M0-T4 demo]

bash-8e85562c0e444a34  (simulated restart / bj-1793786038723-tsa3s0)
started slow
cancel requested: simulated restart
[status: killed, simulated restart]
```
