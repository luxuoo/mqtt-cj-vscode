import * as vscode from 'vscode';
import { SerialManager, PortInfo } from '../serial/serialManager';
import { MqttManager, MqttMessage, Subscription } from '../mqtt/mqttManager';
import { ProfileManager, Profile } from '../config/profileManager';
import { BridgeManager, BridgeConfig } from '../bridge/bridgeManager';
import { formatDataLine, timestamp, bufferToHex, generateClientId } from '../utils/formatter';
import { logger } from '../utils/logger';
import { prepareSendData } from '../serial/serialParser';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'serialMqtt.sidebar';
    private view?: vscode.WebviewView;
    private serialManager: SerialManager;
    private mqttManager: MqttManager;
    private profileManager: ProfileManager;
    private bridgeManager: BridgeManager;
    private serialLog: string[] = [];
    private _disposed: boolean = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        serialManager: SerialManager,
        mqttManager: MqttManager,
        profileManager: ProfileManager,
        bridgeManager: BridgeManager
    ) {
        this.serialManager = serialManager;
        this.mqttManager = mqttManager;
        this.profileManager = profileManager;
        this.bridgeManager = bridgeManager;

        this.setupEventListeners();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            await this.handleMessage(msg);
        });

        // 发送默认配置
        const cfg = vscode.workspace.getConfiguration('serialMqtt');
        this.post({
            type: 'defaults',
            serial: this.profileManager.getDefaultSerialConfig(),
            mqtt: this.profileManager.getDefaultMqttConfig(),
            bridge: this.profileManager.getDefaultBridgeConfig()
        });

        // 延迟发送当前状态，确保webview已加载完成
        setTimeout(() => this.sendCurrentState(), 200);

        webviewView.onDidDispose(() => {
            this.view = undefined;
        });

        // 当webview变为可见时，刷新状态
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.sendCurrentState();
            }
        });
    }

    private sendCurrentState(): void {
        // 发送当前串口连接状态
        if (this.serialManager.connected) {
            this.post({ type: 'serial.connected', port: this.serialManager.config?.port });
        }
        // 发送当前MQTT连接状态
        if (this.mqttManager.connected) {
            this.post({ type: 'mqtt.connected' });
        }
        // 发送当前桥接状态
        if (this.bridgeManager.active) {
            this.post({ type: 'bridge.started', config: this.bridgeManager.config });
        }
        // 发送统计数据
        this.post({
            type: 'serial.stats',
            rxBytes: this.serialManager.rxBytes,
            txBytes: this.serialManager.txBytes
        });
    }

    private setupEventListeners(): void {
        this.serialManager.on('connect', () => {
            this.post({ type: 'serial.connected', port: this.serialManager.config?.port });
        });
        this.serialManager.on('disconnect', () => {
            this.post({ type: 'serial.disconnected' });
        });
        this.serialManager.on('data', (data: Buffer) => {
            const hex = bufferToHex(data);
            const ascii = data.toString('utf-8').replace(/[\r\n]/g, '');
            this.post({ type: 'serial.data', direction: 'RX', hex, ascii, timestamp: timestamp() });
            this.post({ type: 'serial.stats', rxBytes: this.serialManager.rxBytes, txBytes: this.serialManager.txBytes });
        });
        this.serialManager.on('sent', (data: Buffer) => {
            const hex = bufferToHex(data);
            const ascii = data.toString('utf-8').replace(/[\r\n]/g, '');
            this.post({ type: 'serial.data', direction: 'TX', hex, ascii, timestamp: timestamp() });
            this.post({ type: 'serial.stats', rxBytes: this.serialManager.rxBytes, txBytes: this.serialManager.txBytes });
        });
        this.serialManager.on('error', (msg: string) => {
            this.post({ type: 'serial.error', message: msg });
        });

        this.mqttManager.on('connect', () => {
            this.post({ type: 'mqtt.connected' });
        });
        this.mqttManager.on('disconnect', () => {
            this.post({ type: 'mqtt.disconnected' });
        });
        this.mqttManager.on('message', (msg: MqttMessage) => {
            this.post({ type: 'mqtt.message', message: msg });
        });
        this.mqttManager.on('subscribe', (sub: Subscription) => {
            this.post({ type: 'mqtt.subscribed', subscription: sub });
        });
        this.mqttManager.on('unsubscribe', (topic: string) => {
            this.post({ type: 'mqtt.unsubscribed', topic });
        });
        this.mqttManager.on('error', (msg: string) => {
            this.post({ type: 'mqtt.error', message: msg });
        });

        this.bridgeManager.on('start', () => {
            this.post({ type: 'bridge.started', config: this.bridgeManager.config });
        });
        this.bridgeManager.on('stop', () => {
            this.post({ type: 'bridge.stopped' });
        });
        this.bridgeManager.on('forward', (info: any) => {
            this.post({ type: 'bridge.forward', ...info, count: this.bridgeManager.forwardCount });
        });
    }

    private async handleMessage(msg: any): Promise<void> {
        switch (msg.type) {
            case 'getState':
                this.sendCurrentState();
                break;

            case 'serial.listPorts': {
                const ports = await this.serialManager.listPorts();
                this.post({ type: 'serial.ports', ports });
                break;
            }
            case 'serial.connect': {
                const ok = await this.serialManager.connect(msg.config);
                if (!ok) {
                    this.post({ type: 'serial.error', message: '连接失败' });
                }
                break;
            }
            case 'serial.disconnect':
                if (this.bridgeManager.active) { this.bridgeManager.stop(); }
                await this.serialManager.disconnect();
                break;
            case 'serial.send': {
                try {
                    const buf = prepareSendData(msg.data, msg.mode, msg.lineEnding);
                    await this.serialManager.send(buf);
                } catch (e) {
                    this.post({ type: 'serial.error', message: (e as Error).message });
                }
                break;
            }
            case 'serial.setDtr':
                this.serialManager.setDtr(msg.value);
                break;
            case 'serial.setRts':
                this.serialManager.setRts(msg.value);
                break;
            case 'serial.clearLog':
                this.serialLog = [];
                this.post({ type: 'serial.logCleared' });
                break;
            case 'serial.exportLog': {
                const uri = await vscode.window.showSaveDialog({
                    filters: { '日志': ['txt', 'log'] },
                    defaultUri: vscode.Uri.file('serial_log.txt')
                });
                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(this.serialLog.join('\n'), 'utf-8'));
                }
                break;
            }
            case 'serial.resetStats':
                this.serialManager.resetStats();
                this.post({ type: 'serial.stats', rxBytes: 0, txBytes: 0 });
                break;

            case 'mqtt.connect':
                this.mqttManager.connect(msg.config);
                break;
            case 'mqtt.disconnect':
                this.mqttManager.disconnect();
                break;
            case 'mqtt.subscribe':
                this.mqttManager.subscribe(msg.topic, msg.qos);
                break;
            case 'mqtt.unsubscribe':
                this.mqttManager.unsubscribe(msg.topic);
                break;
            case 'mqtt.publish':
                this.mqttManager.publish(msg.topic, msg.payload, msg.qos, msg.retain);
                break;
            case 'mqtt.clearMessages':
                this.post({ type: 'mqtt.messagesCleared' });
                break;

            case 'bridge.start': {
                const ok = this.bridgeManager.start(msg.config);
                if (!ok) {
                    this.post({ type: 'bridge.error', message: '请先连接串口和MQTT' });
                }
                break;
            }
            case 'bridge.stop':
                this.bridgeManager.stop();
                break;

            case 'profile.save': {
                const d = msg.data || {};
                const profile: Profile = {
                    name: msg.name,
                    serial: d.serial || this.serialManager.config || this.profileManager.getDefaultSerialConfig(),
                    mqtt: d.mqtt || this.mqttManager.config || this.profileManager.getDefaultMqttConfig(),
                    bridge: d.bridge || this.bridgeManager.config || this.profileManager.getDefaultBridgeConfig(),
                    createdAt: ''
                };
                this.profileManager.saveProfile(profile);
                this.sendProfileList();
                break;
            }
            case 'profile.load': {
                const p = this.profileManager.getProfile(msg.name);
                if (p) { this.post({ type: 'profile.loaded', profile: p }); }
                break;
            }
            case 'profile.delete':
                this.profileManager.deleteProfile(msg.name);
                this.sendProfileList();
                break;
            case 'profile.list':
                this.sendProfileList();
                break;

            case 'openMainPanel':
                vscode.commands.executeCommand('serialMqtt.openPanel');
                break;
        }
    }

    private sendProfileList(): void {
        this.post({ type: 'profile.list', profiles: this.profileManager.getProfiles() });
    }

    private post(msg: any): void {
        if (this._disposed || !this.view) return;
        try {
            this.view.webview.postMessage(msg);
        } catch {
            // webview 已销毁，忽略
        }
    }

    public refresh(): void {
        if (this.view) {
            this.view.webview.html = this.getHtml(this.view.webview);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'));
        const nonce = Date.now().toString(36);

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <!-- 串口配置 -->
    <div class="section">
        <div class="section-title" data-toggle="serial">
            <span class="arrow">▶</span> 串口配置
            <span class="status-dot" id="serialDot"></span>
        </div>
        <div class="section-body collapsed" id="serialBody">
            <div class="field">
                <label>端口</label>
                <div class="field-row">
                    <select id="sPort"></select>
                    <button id="refreshPorts" class="icon-btn" title="刷新">⟳</button>
                </div>
            </div>
            <div class="field">
                <label>波特率</label>
                <select id="sBaud">
                    <option value="300">300</option><option value="1200">1200</option>
                    <option value="2400">2400</option><option value="4800">4800</option>
                    <option value="9600">9600</option><option value="19200">19200</option>
                    <option value="38400">38400</option><option value="57600">57600</option>
                    <option value="115200" selected>115200</option>
                    <option value="230400">230400</option><option value="460800">460800</option>
                    <option value="921600">921600</option>
                </select>
            </div>
            <div class="field-row-3">
                <div class="field"><label>数据位</label>
                    <select id="sDataBits"><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8" selected>8</option></select>
                </div>
                <div class="field"><label>停止位</label>
                    <select id="sStopBits"><option value="1" selected>1</option><option value="1.5">1.5</option><option value="2">2</option></select>
                </div>
                <div class="field"><label>校验</label>
                    <select id="sParity"><option value="none">None</option><option value="odd">Odd</option><option value="even">Even</option></select>
                </div>
            </div>
            <div class="field">
                <label>流控</label>
                <select id="sFlow"><option value="none">无</option><option value="rtscts">RTS/CTS</option><option value="xonxoff">XON/XOFF</option></select>
            </div>
            <div class="field-row-2">
                <label class="cb"><input type="checkbox" id="sDtr" checked> DTR</label>
                <label class="cb"><input type="checkbox" id="sRts"> RTS</label>
            </div>
            <button id="serialConnect" class="btn primary full">连接</button>
            <div class="stats" id="serialStats">RX: 0 B | TX: 0 B</div>

            <!-- 发送 -->
            <div class="sub-title">发送数据</div>
            <div class="field-row-2">
                <label class="cb"><input type="radio" name="sMode" value="ascii" checked> ASCII</label>
                <label class="cb"><input type="radio" name="sMode" value="hex"> HEX</label>
            </div>
            <div class="field">
                <label>行尾</label>
                <select id="sLineEnding">
                    <option value="\\r\\n">\\r\\n</option><option value="\\n">\\n</option>
                    <option value="\\r">\\r</option><option value="none">无</option>
                </select>
            </div>
            <textarea id="sInput" placeholder="输入数据... Ctrl+Enter发送" rows="2"></textarea>
            <button id="serialSend" class="btn full">发送</button>
        </div>
    </div>

    <!-- MQTT 配置 -->
    <div class="section">
        <div class="section-title" data-toggle="mqtt">
            <span class="arrow">▶</span> MQTT 配置
            <span class="status-dot" id="mqttDot"></span>
        </div>
        <div class="section-body collapsed" id="mqttBody">
            <div class="field">
                <label>协议</label>
                <select id="mProtocol">
                    <option value="mqtt">mqtt://</option><option value="mqtts">mqtts://</option>
                    <option value="ws">ws://</option><option value="wss">wss://</option>
                </select>
            </div>
            <div class="field">
                <label>Broker</label>
                <input id="mBroker" value="broker.emqx.io" />
            </div>
            <div class="field-row-2">
                <div class="field"><label>端口</label><input id="mPort" type="number" value="1883" /></div>
                <div class="field"><label>Keep Alive</label><input id="mKeepAlive" type="number" value="60" /></div>
            </div>
            <div class="field">
                <label>Client ID</label>
                <input id="mClientId" placeholder="留空自动生成" />
            </div>
            <div class="field">
                <label>用户名</label>
                <input id="mUsername" placeholder="可选" />
            </div>
            <div class="field">
                <label>密码</label>
                <input id="mPassword" type="password" placeholder="可选" />
            </div>
            <div class="field-row-2">
                <label class="cb"><input type="checkbox" id="mClean" checked> Clean Session</label>
                <label class="cb"><input type="checkbox" id="mReconnect" checked> 自动重连</label>
            </div>
            <details class="sub-section">
                <summary>遗嘱消息</summary>
                <div class="field"><label>Topic</label><input id="wTopic" /></div>
                <div class="field"><label>Payload</label><input id="wPayload" /></div>
                <div class="field-row-2">
                    <div class="field"><label>QoS</label><select id="wQos"><option>0</option><option>1</option><option>2</option></select></div>
                    <label class="cb"><input type="checkbox" id="wRetain"> Retain</label>
                </div>
            </details>
            <button id="mqttConnect" class="btn primary full">连接</button>

            <!-- 订阅 -->
            <div class="sub-title">订阅</div>
            <div class="field-row-2">
                <input id="subTopic" placeholder="主题 如 sensor/#" />
                <select id="subQos"><option value="0">QoS0</option><option value="1">QoS1</option><option value="2">QoS2</option></select>
            </div>
            <button id="mqttSub" class="btn full">订阅</button>
            <div id="subTags" class="tags"></div>

            <!-- 发布 -->
            <div class="sub-title">发布</div>
            <div class="field"><label>Topic</label><input id="pubTopic" /></div>
            <div class="field-row-2">
                <div class="field"><label>QoS</label><select id="pubQos"><option>0</option><option>1</option><option>2</option></select></div>
                <label class="cb"><input type="checkbox" id="pubRetain"> Retain</label>
            </div>
            <textarea id="pubPayload" placeholder="Payload... Ctrl+Enter发布" rows="2"></textarea>
            <button id="mqttPub" class="btn full">发布</button>
        </div>
    </div>

    <!-- 桥接 -->
    <div class="section">
        <div class="section-title" data-toggle="bridge">
            <span class="arrow">▶</span> 桥接模式
        </div>
        <div class="section-body collapsed" id="bridgeBody">
            <label class="cb"><input type="checkbox" id="bS2M"> 串口 → MQTT</label>
            <div class="field"><label>Topic</label><input id="bS2MTopic" value="serial/rx" /></div>
            <label class="cb"><input type="checkbox" id="bM2S"> MQTT → 串口</label>
            <div class="field"><label>Topic</label><input id="bM2STopic" value="serial/tx" /></div>
            <div class="field">
                <label>转换</label>
                <select id="bTransform"><option value="none">无</option><option value="hex-to-text">HEX↔文本</option><option value="text-to-hex">文本↔HEX</option></select>
            </div>
            <div class="field-row-2">
                <button id="bridgeStart" class="btn primary">启动</button>
                <button id="bridgeStop" class="btn danger" disabled>停止</button>
            </div>
            <div class="stats" id="bridgeStats">状态: 未启动 | 已转发: 0</div>
        </div>
    </div>

    <!-- 配置方案 -->
    <div class="section">
        <div class="section-title" data-toggle="profiles">
            <span class="arrow">▶</span> 配置方案
        </div>
        <div class="section-body collapsed" id="profilesBody">
            <div class="field-row-2">
                <input id="profileName" placeholder="方案名称" />
                <button id="profileSave" class="btn primary">保存</button>
            </div>
            <div id="profileList" class="profile-list"></div>
        </div>
    </div>

    <!-- 快捷操作 -->
    <div class="section">
        <div class="section-title" data-toggle="quick">
            <span class="arrow">▶</span> 快捷指令
        </div>
        <div class="section-body collapsed" id="quickBody">
            <div class="field-row-2">
                <input id="quickCmdInput" placeholder="新指令" />
                <button id="addQuickCmd" class="btn">添加</button>
            </div>
            <div id="quickCmdList" class="cmd-list"></div>
        </div>
    </div>

    <!-- 打开完整面板 -->
    <button id="openPanel" class="btn full open-panel">打开完整调试面板</button>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this._disposed = true;
        this.view = undefined;
    }
}
