# 串口+MQTT调试器 (Serial & MQTT Debugger)

一款功能完备的 VSCode 插件，集成串口调试与 MQTT 客户端于一体，专为嵌入式/IoT 开发者设计。

## 功能特性

### 串口调试器

- **端口自动枚举** — 自动列出可用 COM 口，支持原生模块和系统命令双重检测
- **完整连接参数** — 波特率 (300~921600)、数据位 (5/6/7/8)、停止位 (1/1.5/2)、校验 (None/Odd/Even/Mark/Space)
- **流控支持** — RTS/CTS、XON/XOFF
- **双模式收发** — ASCII / HEX 自由切换
- **DTR/RTS 控制** — 手动开关
- **时间戳** — 每条数据附加 `[HH:mm:ss.SSS]`
- **快捷指令** — 保存常用 AT 指令，一键发送
- **日志导出** — 保存收发记录为 .txt/.log
- **数据统计** — 实时显示收发字节数

### MQTT 客户端

- **多协议** — mqtt / mqtts / ws / wss
- **完整连接配置** — Broker、端口、ClientID、用户名密码、Clean Session、Keep Alive
- **TLS/SSL** — 支持 CA 证书、客户端证书
- **遗嘱消息** — Will Topic / Payload / QoS / Retain
- **多主题订阅** — 独立 QoS (0/1/2)，标签化管理
- **消息发布** — Topic + Payload + QoS + Retain
- **消息过滤** — 按主题关键词实时过滤
- **Payload 格式** — Plain Text / HEX / JSON 格式化
- **自动重连** — 断线自动恢复

### 桥接模式

- **串口 → MQTT** — 串口数据自动转发到指定 MQTT Topic
- **MQTT → 串口** — 订阅 Topic，消息自动发送到串口
- **独立开关** — 两个方向可分别启用/禁用
- **数据转换** — 可选 HEX↔文本 转换

### 通用功能

- **侧栏配置面板** — 左侧活动栏直接配置串口/MQTT/桥接参数
- **完整调试面板** — 三 Tab 布局的 Webview 主面板
- **配置方案** — 保存/加载/删除命名配置方案
- **状态栏指示器** — 底部实时显示连接状态
- **VSCode 设置集成** — 丰富的可配置选项
- **中文界面**

## 安装

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/luxuoo/mqtt-cj-vscode.git
cd mqtt-cj-vscode

# 安装依赖
npm install

# 编译
npm run build

# 在 VSCode 中按 F5 启动调试
```

### 安装 .vsix

```bash
# 打包
npx vsce package

# 安装
code --install-extension serial-mqtt-debugger-1.0.0.vsix
```

## 使用方法

### 侧栏操作

1. 点击左侧活动栏的 **串口+MQTT调试器** 图标
2. 展开 **串口配置** — 选择端口和参数，点击连接
3. 展开 **MQTT 配置** — 填写 Broker 信息，点击连接
4. 展开 **桥接模式** — 配置转发 Topic，点击启动
5. 展开 **配置方案** — 保存当前配置或加载已有方案
6. 展开 **快捷指令** — 添加常用命令，点击即发送

### 主面板操作

- 点击侧栏底部的 **打开完整调试面板** 按钮
- 或在命令面板中运行 `串口MQTT: 打开调试面板`
- 三个 Tab 切换：串口调试 / MQTT 客户端 / 桥接模式

### VSCode 设置

在 `文件 > 首选项 > 设置 > 扩展 > 串口+MQTT调试器` 中可配置：

| 设置 | 默认值 | 说明 |
|---|---|---|
| `defaultBaudRate` | 115200 | 默认波特率 |
| `defaultDataBits` | 8 | 默认数据位 |
| `defaultStopBits` | 1 | 默认停止位 |
| `defaultParity` | none | 默认校验位 |
| `defaultEncoding` | utf-8 | 默认编码 |
| `defaultLineEnding` | \r\n | 默认行尾符 |
| `defaultMqttBroker` | broker.emqx.io | 默认 MQTT Broker |
| `defaultMqttPort` | 1883 | 默认 MQTT 端口 |
| `defaultMqttProtocol` | mqtt | 默认协议 |
| `autoReconnect` | true | MQTT 自动重连 |
| `reconnectInterval` | 5000 | 重连间隔 (ms) |
| `keepAlive` | 60 | 保活间隔 (秒) |
| `maxMessageHistory` | 1000 | 最大消息历史 |
| `autoScroll` | true | 自动滚动 |
| `showTimestamp` | true | 显示时间戳 |

## 项目结构

```
├── package.json              # 插件清单
├── tsconfig.json
├── .vscodeignore
├── .vscode/launch.json       # 调试配置
├── src/
│   ├── extension.ts          # 入口
│   ├── serial/
│   │   ├── serialManager.ts  # 串口管理 (原生 + 系统命令 fallback)
│   │   └── serialParser.ts   # 数据解析
│   ├── mqtt/
│   │   ├── mqttManager.ts    # MQTT 客户端
│   │   └── mqttStore.ts      # 消息存储
│   ├── bridge/
│   │   └── bridgeManager.ts  # 串口↔MQTT 桥接
│   ├── config/
│   │   └── profileManager.ts # 配置方案管理
│   ├── views/
│   │   ├── mainPanel.ts      # 主 Webview 面板
│   │   ├── sidebarProvider.ts # 侧栏 WebviewView
│   │   └── webviewHtml.ts    # 主面板 HTML
│   └── utils/
│       ├── logger.ts         # 日志
│       └── formatter.ts      # 工具函数
└── media/
    ├── icon.svg              # 图标
    ├── main.css              # 主面板样式
    ├── main.js               # 主面板逻辑
    ├── sidebar.css           # 侧栏样式
    └── sidebar.js            # 侧栏逻辑
```

## 技术栈

- **TypeScript** — 类型安全的扩展开发
- **serialport** — 串口通信 (含 Windows 注册表/WMI fallback)
- **mqtt.js** — MQTT v3.1.1/v5 客户端
- **esbuild** — 快速打包
- **WebviewView** — 侧栏配置面板
- **WebviewPanel** — 主调试面板

## 许可证

MIT
