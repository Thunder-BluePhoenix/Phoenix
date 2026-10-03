# pet/animations

The animation system is split by responsibility rather than living here:

| Piece                                                          | Where                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| State → animation mapping (labels, tone, urgency, loop)        | [`pet/states`](../states/src/index.ts)                   |
| Motion itself (keyframes, still poses for reduced motion)      | the character asset, [`pet/assets`](../assets/README.md) |
| Playing it: interruption, reduced motion, pausing while hidden | [`pet/runtime`](../runtime/src/fawkes.ts)                |

Phase 10 and the [asset rules](../assets/README.md) describe the contract.
