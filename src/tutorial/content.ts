import type {
  TutorialContext,
  TutorialDefinition,
  TutorialRoute,
} from "./types";

const version = 20;

const tutorials: Record<TutorialRoute, TutorialDefinition> = {
  welcome: {
    id: "welcome-basics",
    contentVersion: version,
    route: "welcome",
    title: "认识工程与教程",
    goal: "知道工程中的片段会在哪里编辑，并能随时重新打开本页教程。",
    prerequisites: "无。",
    commonMistake: "关闭教程后找不到入口。",
    recovery:
      "顶栏的“当前页面教程”始终可打开本页引导；也可使用“重新开始教程”。",
    steps: [
      {
        id: "welcome-project",
        title: "查看当前工程",
        anchor: "project-summary",
        instruction: "查看中央的工程说明，后续所有音乐片段都会属于一个工程。",
        expectedResult: "你知道可以从欢迎页开始 demo 或创建新工程。",
        accessibilityText: "工程摘要区域，说明项目和下一步入口。",
      },
      {
        id: "welcome-help",
        title: "找到帮助入口",
        anchor: "tutorial-trigger",
        instruction:
          "点击顶栏的“当前页面教程”。它不会离开工程，也不会修改音乐。",
        expectedResult: "右侧出现教程侧栏。",
        accessibilityText: "当前页面教程按钮，会打开右侧非阻塞教程。",
      },
      {
        id: "welcome-start",
        title: "选择工程起点",
        anchor: "project-start",
        instruction:
          "选择“新建空白工程”或一种内置模板；如果想先熟悉播放，也可打开内置 Demo。",
        expectedResult:
          "进入 Demo 页面，并看到新工程的 section、轨道、速度和调性。创建新工程会开始新的编辑历史。",
        accessibilityText:
          "工程起点按钮组，包含空白、Lo-fi、Electronic、Pop 模板和内置 Demo。",
      },
      {
        id: "welcome-recovery",
        title: "恢复未保存内容（如出现）",
        anchor: "recovery-actions",
        instruction:
          "若欢迎页提示存在恢复副本，可选择“恢复并继续编辑”或“丢弃恢复副本”。恢复内容仍标为未保存，请随后保存为工程文件。",
        expectedResult:
          "恢复后回到 Demo 并保留未保存状态；丢弃后可正常开始新的工程。",
        accessibilityText:
          "本地恢复副本操作区域，包含恢复并继续编辑和丢弃恢复副本按钮。",
      },
    ],
  },
  journey: {
    id: "creative-journey",
    contentVersion: version,
    route: "journey",
    title: "从 10 秒开始做第一首歌",
    goal: "不借助外部乐理教程，完成一段可试听、可编辑并可导出的短音乐。",
    prerequisites: "无；请先完成页面上的 Q W E R T 热身。",
    commonMistake:
      "误以为 AI 会直接替你完成整首歌，或认为参考音频会被自动上传。",
    recovery:
      "每次 AI 扩展都只生成当前段落的候选，接受后才写入。参考音频只在本机分析；可随时移除或跳过。",
    steps: [
      {
        id: "journey-warmup",
        title: "完成上行旋律热身",
        anchor: "creative-journey",
        instruction: "依次点击 Q、W、E、R、T，听见音高从低到高变化。",
        expectedResult: "你知道电脑键盘可以试听音阶，并解锁 10 秒音乐工坊。",
        accessibilityText: "创作旅程热身区域，包含 Q 至 T 的音阶按键。",
      },
      {
        id: "journey-seed",
        title: "创建你的 10 秒开场",
        anchor: "creative-journey",
        instruction: "选择放松、轻快或有力量，再点击创建。",
        expectedResult:
          "新工程出现鼓点、低音和旋律，后续扩展不会修改这段开场。",
        accessibilityText: "10 秒音乐工坊的感觉选项和创建按钮。",
      },
      {
        id: "journey-reference",
        title: "选择性导入参考音频",
        anchor: "creative-journey",
        instruction:
          "若有参考，先阅读本机处理说明并确认，选择文件后在时间轴保留想要的 1–45 秒并试听，再确认导入；没有也可跳过。",
        expectedResult:
          "你能看到仅针对所选片段的可修正文字摘要，并知道原始音频和路径不会发送给 AI。",
        accessibilityText: "音频参考导入与用途、权重设置区域。",
      },
      {
        id: "journey-expand",
        title: "逐段扩展并做最后微调",
        anchor: "creative-journey",
        instruction:
          "先用本机引导或 AI 候选扩展每个段落，再到 Piano Roll 改一个音符，最后去 Demo 试听导出。",
        expectedResult: "完成一首带开场、发展、高潮和收束的可编辑作品。",
        accessibilityText: "创作路线、逐段扩展、Piano Roll 与导出入口。",
      },
    ],
  },
  demo: {
    id: "demo-transport",
    contentVersion: version,
    route: "demo",
    title: "播放 demo 与试听音阶",
    goal: "了解播放控制，以及 Q W E R T Y U 的 do、re、mi、fa、sol、la、ti 试听方式。",
    prerequisites: "使用内置 demo；第一次播放需要由你主动点击播放。",
    commonMistake:
      "在文本输入框内按键、第一次未触发音频权限，或系统没有可用输出设备。",
    recovery:
      "先在应用内点击播放或按音阶键；文本输入框聚焦时不会触发试听。若看到“音频不可用”，检查系统输出设备后重试；这不会修改工程。",
    steps: [
      {
        id: "demo-play",
        title: "播放与停止",
        anchor: "transport-controls",
        instruction: "点击播放，再点击停止。循环状态和播放位置会显示在这里。",
        expectedResult: "transport 状态在播放和停止之间切换。",
        accessibilityText: "播放控制区域，含播放、停止、循环和播放位置。",
      },
      {
        id: "demo-keyboard",
        title: "QWERT 音阶试听",
        anchor: "keyboard-map",
        instruction:
          "确保未聚焦文本框，然后按 Q、W、E、R、T、Y、U，或点击页面上的对应白色键，试听当前调性的 do、re、mi、fa、sol、la、ti；Z/X 或页面按钮切换本地默认八度，I 或 Shift+按键试听高八度。",
        expectedResult:
          "每次实体键或页面白色键试听都会显示相应音阶名称，并触发 lead 音色的对应音高；反复切换八度后仍可继续试听，且不会写入工程。",
        accessibilityText:
          "电脑键盘映射区域，Q W E R T Y U 对应 do re mi fa sol la ti。",
      },
      {
        id: "demo-manual-edit",
        title: "修改内存工程",
        anchor: "quick-mix-editor",
        instruction:
          "停止播放后，在这里改速度、调性、全曲移调、轨道音量、静音或独奏；每次点击都会先校验再整体应用。",
        expectedResult:
          "工程摘要会显示新数值。点击播放可试听修改；随后可保存工程或导出 MIDI/WAV。",
        accessibilityText:
          "手工修改区，提供速度、调性、轨道音量、静音和独奏按钮。",
      },
      {
        id: "demo-undo-redo",
        title: "撤销或重做一次修改",
        anchor: "undo-redo-controls",
        instruction:
          "停止播放后，点击“撤销”回到上一个成功修改批次；点击“重做”恢复。作出新修改会清空重做记录。",
        expectedResult:
          "工程数值回到前一版本或恢复到后一版本；失败的修改不会出现在撤销历史中。",
        accessibilityText:
          "撤销与重做控制，按钮在没有相应历史时禁用，并用文字说明当前状态。",
      },
      {
        id: "demo-save-open",
        title: "保存、另存为与打开工程",
        anchor: "file-actions",
        instruction:
          "使用顶栏“保存工程”写回已选文件；首次保存或想复制版本时选择“另存为”。“打开工程”会读取 JSON；“导出 MIDI”和“导出 WAV”会输出当前可试听的轨道。有未保存修改时打开新工程会先请求确认。",
        expectedResult:
          "页面会显示已保存路径、未保存状态或 MIDI/WAV 输出路径。损坏或不兼容工程不会替换当前有效工程。",
        accessibilityText:
          "顶栏文件操作按钮组，包含打开工程、保存工程、另存为、导出 MIDI、导出 WAV 和当前页面教程。",
      },
    ],
  },
  arrangement: {
    id: "arrangement-scope",
    contentVersion: version,
    route: "arrangement",
    title: "在编排区选择修改范围",
    goal: "从工程网格选择一个轨道 × 段落，并打开对应的手工编辑位置。",
    prerequisites: "需先打开或创建工程；停止播放后再进行修改。",
    commonMistake: "把空白格误认为不能编辑，或误以为修改会作用到整首歌。",
    recovery:
      "点击任一格后会进入相同位置的 Piano Roll。空白格可先创建片段，已有片段可直接编辑音符。",
    steps: [
      {
        id: "arrangement-grid",
        title: "从工程网格选择位置",
        anchor: "arrangement-grid",
        instruction:
          "每一行对应一个轨道，每一列对应一个段落。点击“编辑片段”或“创建片段”。",
        expectedResult:
          "页面进入该轨道和段落的 Piano Roll，目标选择器显示相同的名称。",
        accessibilityText:
          "编排网格，按轨道和段落展示已有片段的音符数和空白位置。",
      },
      {
        id: "arrangement-clip",
        title: "区分已有与空白片段",
        anchor: "arrangement-clip",
        instruction:
          "已有片段会显示音符数量；空白位置显示“创建片段”。两种按钮都只作用于所在格。",
        expectedResult: "你能在正确范围编辑，而不会误改其他轨道或段落。",
        accessibilityText:
          "已有片段按钮，显示音符数量并进入对应的 Piano Roll。",
      },
    ],
  },
  "piano-roll": {
    id: "piano-roll-edit",
    contentVersion: version,
    route: "piano-roll",
    title: "手工编辑音符",
    goal: "在指定轨道和段落内创建片段，并以表格或电脑键盘精确新增、修改或删除音符。",
    prerequisites: "先停止播放；可以从任意内置工程或空白工程开始。",
    commonMistake: "把试听按键当成已写入工程的录制音符。",
    recovery:
      "试听不会修改工程。手工修改后请到 Demo 重新播放；输错数值可使用 Demo 页的撤销按钮恢复。",
    steps: [
      {
        id: "piano-roll-target",
        title: "选择要编辑的位置",
        anchor: "piano-roll-target",
        instruction: "先选择轨道和段落；这里会明确显示是否已有片段和音符数量。",
        expectedResult: "你知道本次修改只会写入所选轨道的所选段落。",
        accessibilityText:
          "Piano Roll 目标选择器，包含轨道、段落与当前音符数量。",
      },
      {
        id: "keyboard-recording",
        title: "录制电脑键盘演奏",
        anchor: "keyboard-recording",
        instruction:
          "在 melodic 轨道点击“开始键盘录制”，按 Q、W、E、R、T、Y、U 演奏；Z/X 调整默认八度，I 为高音 do。完成后点击“停止录制并写入”。",
        expectedResult:
          "新音符会量化到 1/16 拍，以一个可撤销批次写入当前轨道和段落；若不存在片段会自动创建。",
        accessibilityText:
          "电脑键盘录制控制，说明可用按键、当前录制状态和停止后写入工程的行为。",
      },
      {
        id: "piano-roll-create",
        title: "创建空片段（如有需要）",
        anchor: "piano-roll-create",
        instruction:
          "如果显示“尚无片段”，点击“创建空片段”；创建完成后才可添加音符。",
        expectedResult: "目标位置出现“添加音符（C4）”按钮。",
        accessibilityText:
          "创建空片段区域，提供一个将片段写入当前轨道和段落的按钮。",
      },
      {
        id: "piano-roll-add-note",
        title: "添加第一个音符",
        anchor: "piano-roll-add-note",
        instruction:
          "点击“添加音符（C4）”。音符会写入当前片段；空片段也会显示这个按钮。",
        expectedResult:
          "下方列表新增一行音符，并显示 MIDI 音高、开始拍、时值和力度。",
        accessibilityText: "添加音符操作区，说明新音符的默认开始拍和时值。",
      },
      {
        id: "piano-roll-grid",
        title: "查看音符网格",
        anchor: "piano-roll-grid",
        instruction:
          "直接输入 MIDI 音高、开始拍、时值与力度，再点击“更新”。数值必须留在当前段落内。",
        expectedResult: "该行显示新的音名；变更会进入撤销/重做历史。",
        accessibilityText:
          "Piano Roll 音符编辑列表，逐行输入音高、开始拍、时值和力度。",
      },
      {
        id: "piano-roll-note-actions",
        title: "删除或恢复修改",
        anchor: "piano-roll-note-actions",
        instruction:
          "点击“删除”移除该音符；需要恢复时，前往 Demo 页使用“撤销”。",
        expectedResult:
          "音符行消失，或通过撤销恢复；回到 Demo 播放可听到修改后的版本。",
        accessibilityText: "每个音符行的更新与删除操作。",
      },
    ],
  },
  chat: {
    id: "chat-proposal",
    contentVersion: version,
    route: "chat",
    title: "桌面端 OpenAI / Gemini 候选与手工替代路径",
    goal: "理解 AI 只能提出候选，不会直接改写工程；未配置服务商时仍可手工完成。",
    prerequisites:
      "如要实际请求候选，在本页选择 OpenAI 或 Gemini，并把自己的 API Key 保存到 macOS 钥匙串；不需要浏览器、Node 网关、本地端口或临时账户。",
    commonMistake: "以为发送提示词会立即覆盖当前音乐。",
    recovery:
      "候选先说明范围并通过本地工程校验，再由你接受或拒绝。候选试听尚未实现；AI 不可用时请回到编排区或 Piano Roll 手工编辑。",
    steps: [
      {
        id: "chat-status",
        title: "确认 AI 状态",
        anchor: "ai-status",
        instruction:
          "先选择 OpenAI 或 Gemini，再查看该服务商是否已在 macOS 钥匙串配置，以及会发送的数据范围。未配置时不要阻塞手工创作。",
        expectedResult: "你知道 AI 是可选能力，且候选不会直接落盘。",
        accessibilityText: "AI 连接状态和数据范围说明。",
      },
      {
        id: "chat-local-key",
        title: "配置本机 API Key（首次使用）",
        anchor: "ai-local-key",
        instruction:
          "在此页面粘贴所选 OpenAI 或 Gemini API Key，然后点击“保存到 macOS 钥匙串”。Key 不会写入工程、提示词或日志；保存后输入框会清空。",
        expectedResult:
          "页面显示所选服务商已配置；无需创建账户、启动 Node 网关或切换到浏览器，即可生成候选。",
        accessibilityText:
          "说明 macOS 钥匙串中的 OpenAI 或 Gemini API Key 配置、服务商选择与保密边界。",
      },
      {
        id: "chat-scope",
        title: "确认发送范围",
        anchor: "ai-scope",
        instruction:
          "选择轨道、段落和替换/叠加策略，再检查数据说明。只会发送该片段的必要音乐参数与有限音符，不会发送整个工程。",
        expectedResult:
          "你知道本次生成的目标范围，以及 AI 请求不会立即修改工程。",
        accessibilityText: "AI 生成范围选择区，包含轨道、段落和策略。",
      },
      {
        id: "chat-proposal",
        title: "接受或拒绝候选",
        anchor: "ai-proposal",
        instruction:
          "生成完成后阅读候选摘要、范围和音符数量；点击接受才写入一个可撤销批次，点击拒绝则不修改工程。",
        expectedResult:
          "候选在未接受前保持独立；接受后可到 Demo 页播放并可一次撤销。",
        accessibilityText: "AI 候选区域，包含摘要、范围、接受和拒绝按钮。",
      },
    ],
  },
};

export function resolveTutorial(context: TutorialContext): TutorialDefinition {
  return tutorials[context.route];
}

export function getTutorialById(id: string): TutorialDefinition | undefined {
  return Object.values(tutorials).find((tutorial) => tutorial.id === id);
}
