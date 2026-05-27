import * as vscode from 'vscode';

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
    <link rel="stylesheet" href="${styleUri}">
    <title>串口+MQTT调试器</title>
</head>
<body>
    <!-- 标签栏 -->
    <div class="tab-bar">
        <button class="tab active" data-tab="serial">串口调试</button>
        <button class="tab" data-tab="mqtt">MQTT 客户端</button>
        <button class="tab" data-tab="bridge">桥接模式</button>
        <div class="tab-spacer"></div>
        <div class="profile-bar">
            <input id="profileNameInput" placeholder="方案名称" style="width:100px" />
            <button id="saveProfile" title="保存方案" class="btn-small">保存</button>
            <select id="profileSelect"><option value="">-- 已保存方案 --</option></select>
            <button id="loadProfile" title="加载方案" class="btn-small">加载</button>
            <button id="deleteProfile" title="删除方案" class="btn-small">删除</button>
        </div>
    </div>

    <!-- ==================== 串口调试 ==================== -->
    <div class="tab-content active" id="tab-serial">
        <div class="config-bar">
            <div class="config-row">
                <label>端口</label>
                <select id="serialPort"></select>
                <button id="refreshPorts" title="刷新端口">⟳</button>
                <label>波特率</label>
                <select id="baudRate">
                    <option value="300">300</option><option value="1200">1200</option>
                    <option value="2400">2400</option><option value="4800">4800</option>
                    <option value="9600">9600</option><option value="19200">19200</option>
                    <option value="38400">38400</option><option value="57600">57600</option>
                    <option value="115200" selected>115200</option>
                    <option value="230400">230400</option><option value="460800">460800</option>
                    <option value="921600">921600</option>
                </select>
                <button id="serialConnect" class="btn-primary">连接</button>
            </div>
            <div class="config-row">
                <label>数据位</label>
                <select id="dataBits">
                    <option value="5">5</option><option value="6">6</option>
                    <option value="7">7</option><option value="8" selected>8</option>
                </select>
                <label>停止位</label>
                <select id="stopBits">
                    <option value="1" selected>1</option>
                    <option value="1.5">1.5</option><option value="2">2</option>
                </select>
                <label>校验</label>
                <select id="parity">
                    <option value="none" selected>None</option>
                    <option value="odd">Odd</option><option value="even">Even</option>
                    <option value="mark">Mark</option><option value="space">Space</option>
                </select>
                <label>流控</label>
                <select id="flowControl">
                    <option value="none" selected>无</option>
                    <option value="rtscts">RTS/CTS</option>
                    <option value="xonxoff">XON/XOFF</option>
                </select>
            </div>
        </div>

        <div class="control-bar">
            <label class="checkbox-label"><input type="checkbox" id="dtrCtrl" checked> DTR</label>
            <label class="checkbox-label"><input type="checkbox" id="rtsCtrl"> RTS</label>
            <label class="checkbox-label"><input type="checkbox" id="autoReconnect"> 自动重连</label>
            <button id="sendBreak" class="btn-small" title="发送Break信号">Break</button>
            <div class="spacer"></div>
            <span class="stats" id="serialStats">RX: 0 B | TX: 0 B | ERR: 0</span>
        </div>

        <div class="section-header">
            <span>接收区</span>
            <div class="toolbar">
                <input id="serialSearch" placeholder="搜索..." style="width:120px" />
                <select id="serialDisplayMode">
                    <option value="ascii">ASCII</option><option value="hex">HEX</option>
                </select>
                <button id="clearSerialLog" title="清空">🗑️</button>
                <button id="exportSerialLog" title="保存日志">💾</button>
                <label class="checkbox-label"><input type="checkbox" id="autoScroll" checked> 自动滚动</label>
            </div>
        </div>
        <div class="log-area" id="serialLog"></div>

        <div class="section-header">
            <span>发送区</span>
            <div class="toolbar">
                <label class="radio-label"><input type="radio" name="sendMode" value="ascii" checked> ASCII</label>
                <label class="radio-label"><input type="radio" name="sendMode" value="hex"> HEX</label>
                <label>行尾</label>
                <select id="lineEnding">
                    <option value="\\r\\n">\\r\\n</option><option value="\\n">\\n</option>
                    <option value="\\r">\\r</option><option value="none">无</option>
                </select>
            </div>
        </div>
        <div class="send-area">
            <textarea id="serialInput" placeholder="输入要发送的数据... Ctrl+Enter发送" rows="3"></textarea>
            <button id="serialSend" class="btn-primary">发送</button>
        </div>

        <div class="quick-commands">
            <span class="label">快捷指令:</span>
            <div id="quickCmdList"></div>
            <input id="quickCmdInput" placeholder="新指令" />
            <button id="addQuickCmd" title="添加">+</button>
        </div>
    </div>

    <!-- ==================== MQTT 客户端 ==================== -->
    <div class="tab-content" id="tab-mqtt">
        <div class="config-bar">
            <div class="config-row">
                <label>协议</label>
                <select id="mqttProtocol">
                    <option value="mqtt">mqtt://</option><option value="mqtts">mqtts://</option>
                    <option value="ws">ws://</option><option value="wss">wss://</option>
                </select>
                <label>Broker</label>
                <input id="mqttBroker" value="broker.emqx.io" placeholder="broker地址" />
                <label>端口</label>
                <input id="mqttPort" type="number" value="1883" />
                <button id="mqttConnect" class="btn-primary">连接</button>
            </div>
            <div class="config-row">
                <label>ClientID</label>
                <input id="mqttClientId" placeholder="留空自动生成" />
                <label>用户名</label>
                <input id="mqttUsername" placeholder="可选" />
                <label>密码</label>
                <input id="mqttPassword" type="password" placeholder="可选" />
            </div>
            <div class="config-row">
                <label class="checkbox-label"><input type="checkbox" id="mqttCleanSession" checked> Clean Session</label>
                <label>Keep Alive</label>
                <input id="mqttKeepAlive" type="number" value="60" style="width:60px" /> s
                <label class="checkbox-label"><input type="checkbox" id="mqttReconnect" checked> 自动重连</label>
            </div>
            <details class="will-section">
                <summary>遗嘱消息 (Will)</summary>
                <div class="config-row">
                    <label>Topic</label><input id="willTopic" placeholder="遗嘱主题" />
                    <label>Payload</label><input id="willPayload" placeholder="遗嘱消息" />
                    <label>QoS</label>
                    <select id="willQos"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select>
                    <label class="checkbox-label"><input type="checkbox" id="willRetain"> Retain</label>
                </div>
            </details>
        </div>

        <div class="section-header"><span>订阅</span></div>
        <div class="subscribe-bar">
            <input id="subTopic" placeholder="主题 (如 sensor/#)" />
            <label>QoS</label>
            <select id="subQos"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select>
            <button id="mqttSubscribe" class="btn-primary">订阅</button>
        </div>
        <div class="saved-topics" id="savedSubTopics"></div>
        <div class="sub-tags" id="subTags"></div>

        <div class="section-header">
            <span>消息列表 <span class="stats" id="mqttMsgCount">(0 条)</span></span>
            <div class="toolbar">
                <input id="mqttFilter" placeholder="过滤主题..." style="width:150px" />
                <select id="mqttPayloadFormat">
                    <option value="text">Text</option><option value="hex">HEX</option><option value="json">JSON</option>
                </select>
                <button id="clearMqttMessages" title="清空">🗑️</button>
                <button id="exportMqttMessages" title="导出">💾</button>
                <label class="checkbox-label"><input type="checkbox" id="mqttAutoScroll" checked> 自动滚动</label>
            </div>
        </div>
        <div class="log-area" id="mqttLog"></div>

        <div class="section-header"><span>发布</span></div>
        <div class="publish-bar">
            <input id="pubTopic" placeholder="Topic" />
            <label>QoS</label>
            <select id="pubQos"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select>
            <label class="checkbox-label"><input type="checkbox" id="pubRetain"> Retain</label>
        </div>
        <div class="send-area">
            <textarea id="pubPayload" placeholder="Payload... Ctrl+Enter发布" rows="3"></textarea>
            <button id="mqttPublish" class="btn-primary">发布</button>
            <button id="addMqttQuickCmd" class="btn-small" title="保存为快捷指令">+快捷</button>
        </div>

        <div class="quick-commands">
            <span class="label">MQTT快捷指令:</span>
            <div id="mqttQuickCmdList"></div>
        </div>
    </div>

    <!-- ==================== 桥接模式 ==================== -->
    <div class="tab-content" id="tab-bridge">
        <div class="bridge-info">
            <p>桥接模式将串口数据与 MQTT 消息双向转发。使用前请先连接串口和 MQTT。</p>
        </div>
        <div class="bridge-config">
            <div class="bridge-row">
                <label class="checkbox-label"><input type="checkbox" id="bridgeS2M"> 串口 → MQTT</label>
                <label>Topic</label><input id="bridgeS2MTopic" value="serial/rx" />
            </div>
            <div class="bridge-row">
                <label class="checkbox-label"><input type="checkbox" id="bridgeM2S"> MQTT → 串口</label>
                <label>Topic</label><input id="bridgeM2STopic" value="serial/tx" />
            </div>
            <div class="bridge-row">
                <label>数据转换</label>
                <select id="bridgeTransform">
                    <option value="none">无</option>
                    <option value="hex-to-text">HEX ↔ 文本</option>
                    <option value="text-to-hex">文本 ↔ HEX</option>
                </select>
            </div>
            <div class="bridge-row">
                <button id="bridgeStart" class="btn-primary">启动桥接</button>
                <button id="bridgeStop" class="btn-danger" disabled>停止桥接</button>
            </div>
        </div>
        <div class="bridge-status">
            <div class="status-item">
                <span class="status-label">状态:</span>
                <span id="bridgeStatus" class="status-value">未启动</span>
            </div>
            <div class="status-item">
                <span class="status-label">已转发:</span>
                <span id="bridgeCount" class="status-value">0</span>
            </div>
        </div>
        <div class="section-header">
            <span>转发日志</span>
            <div class="toolbar">
                <button id="clearBridgeLog" title="清空">🗑️</button>
            </div>
        </div>
        <div class="log-area" id="bridgeLog"></div>
    </div>

    <!-- 状态栏 -->
    <div class="status-bar">
        <span id="serialStatus" class="status disconnected">串口: 未连接</span>
        <span id="mqttStatus" class="status disconnected">MQTT: 未连接</span>
        <span id="bridgeStatusText" class="status">桥接: 未启动</span>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
