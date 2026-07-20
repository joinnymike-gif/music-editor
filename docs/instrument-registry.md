# 乐器注册表契约（v1）

乐器注册表是音源的唯一解析来源。它确保模板、实时试听、AI Proposal 试听、离线 WAV 与 MIDI 导出使用同一乐器含义；工程文件只存稳定 `instrument` ID 和注册表版本，不存机器路径或临时 URL。

## 工程引用与版本

- `ProjectDocument.meta.instrumentRegistryVersion` 必须引用一个随应用发布的注册表版本；新工程使用当前稳定版本。
- 打开工程时先解析它指定的版本。版本缺失、资产哈希不匹配或许可证不可用时，工程可以只读打开和导出原始 JSON，但不得播放、生成 Proposal 或导出成品。
- 注册表迁移是显式映射 `oldInstrumentId -> newInstrumentId`；迁移前显示受影响轨道和音色变化，用户确认后才更新工程版本。

## 条目结构

```ts
type InstrumentEntry = {
  id: string; // 例如 acoustic_kit、finger_bass、square_lead
  registryVersion: string;
  roles: TrackRole[];
  asset: {
    source: "bundled-recorded" | "bundled-procedural";
    path: string;
    sha256: string;
    licenseId: string;
  };
  render: { realtime: true; offline: true };
  midi: { channel: "drum" | "melodic"; program?: number };
  automation: { volume: true; filterCutoff: boolean };
  defaultGainDb: number;
};
```

- 钢琴、原声吉他、小提琴、长笛、指弹贝斯与电钢琴使用 `bundled-recorded` 实录层；每层都在注册表登记来源、归属、许可证说明、文件路径和 SHA-256。实时试听与 WAV 导出从相同的采样层取音，不允许只在其中一端替换音色。采样层还登记 `onsetSeconds`：它是对实录前导静音测得的起音偏移，实时和离线引擎必须同时跳过，不能为了即时试听而改变导出时的节奏位置。`square_lead` 是唯一明确标注为 `bundled-procedural` 且可用的合成音源：实时试听与离线 WAV 都使用方波合成实现。除此以外，缺少实录层的条目必须在选择器置灰，试听、播放、AI 写入后的播放与 WAV 导出都会被阻止，绝不回退为合成电子音。
- `drums` 角色只能解析 `midi.channel: "drum"` 的条目；其他角色只能解析 `melodic` 条目。无效 role/instrument 组合是 Schema/操作错误。
- melodic 条目的 `program` 为 0–127；drum 输出固定 MIDI channel 10，不使用 Program Change。`filterCutoff: false` 时工程可以保存该 lane，但预检必须警告并在实时/离线 RenderPlan 中标记为不支持。

## 解析与 RenderPlan

`resolveInstrument(projectRegistryVersion, instrumentId)` 返回不可变的解析条目。RenderPlan 记录每条轨道的 `instrumentId`、registryVersion、asset sha256、MIDI 映射和 automation capability；实时与离线引擎只能消费该解析结果，不能各自再按 ID 查找“最新”资源。

模板创建、AI Proposal 模拟和导出 preflight 都必须验证每条轨道条目存在、角色匹配、实时/离线能力为 true。任一项不满足时，错误需指出 track ID、instrument ID 和修复动作（迁移、换乐器或安装包含该版本的应用）。

## 验收

1. 内置三个乐器在实时试听、Proposal preview 与离线 WAV 中均能加载，且解析到相同 asset sha256。
2. 导出的 melodic MIDI 使用条目 program，drums 使用 channel 10；未知映射阻止导出并给出轨道。
3. 打开引用旧注册表的工程时，不会静默换音色；迁移预览、确认和取消都不损坏原工程。
