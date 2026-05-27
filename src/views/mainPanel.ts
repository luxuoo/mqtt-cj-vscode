import * as vscode from 'vscode';
import { getWebviewContent } from './webviewHtml';
import { SerialManager, SerialConfig, PortInfo } from '../serial/serialManager';
import { MqttManager, MqttConfig, MqttMessage, Subscription } from '../mqtt/mqttManager';
import { BridgeManager, BridgeConfig } from '../bridge/bridgeManager';
import { ProfileManager, Profile } from '../config/profileManager';
import { MqttStore } from '../mqtt/mqttStore';
import { prepareSendData, DisplayMode } from '../serial/serialParser';
import { formatDataLine, timestamp } from '../utils/formatter';
import { logger } from '../utils/logger';

export class MainPanel {
    public static currentPanel: MainPanel | undefined;
    private panel: vscode.WebviewPanel;
    private extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    private serialManager: SerialManager;
    private mqttManager: MqttManager;
    private bridgeManager: BridgeManager;
    private profileManager: ProfileManager;
    private mqttStore: MqttStore;
    private serialLog: string[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        serialManager: SerialManager,
        mqttManager: MqttManager,
        profileManager: ProfileManager
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.serialManager = serialManager;
        this.mqttManager = mqttManager;
        this.profileManager = profileManager;
        this.bridgeManager = new BridgeManager(serialManager, mqttManager);
        this.mqttStore = new MqttStore(
            vscode.workspace.getConfiguration('serialMqtt').get<number>('maxMessageHistory', 1000)
        );

        this.panel.webview.html = getWebviewContent(this.panel.webview, this.extensionUri);

        this.setupMessageHandlers();
        this.setupEventListeners();

        // 发送上次保存的配置
        const lastConfig = this.profileManager.getLastConfig();
        if (lastConfig) {
            setTimeout(() => {
                this.postToWebview({ type: 'config.lastConfig', config: lastConfig });
            }, 500);
        }

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    static createOrShow(
        extensionUri: vscode.Uri,
        serialManager: SerialManager,
        mqttManager: MqttManager,
        profileManager: ProfileManager
    ): void {
        const column = vscode.ViewColumn.One;

        if (MainPanel.currentPanel) {
            MainPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'serialMqttDebugger',
            '串口+MQTT调试器',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );

        MainPanel.currentPanel = new MainPanel(panel, extensionUri, serialManager, mqttManager, profileManager);
    }

    private setupMessageHandlers(): void {
        this.panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                // 串口相关
                case 'serial.listPorts':
                    await this.handleListPorts();
                    break;
                case 'serial.connect':
                    await this.handleSerialConnect(msg.config);
                    break;
                case 'serial.disconnect':
                    await this.handleSerialDisconnect();
                    break;
                case 'serial.send':
                    await this.handleSerialSend(msg.data, msg.mode, msg.lineEnding);
                    break;
                case 'serial.setDtr':
                    this.serialManager.setDtr(msg.value);
                    break;
                case 'serial.setRts':
                    this.serialManager.setRts(msg.value);
                    break;
                case 'serial.setBreak':
                    await this.serialManager.sendBreak(msg.duration || 100);
                    break;
                case 'serial.setAutoReconnect':
                    this.serialManager.setAutoReconnect(msg.value);
                    break;
                case 'serial.getStats':
                    this.sendSerialStats();
                    break;
                case 'serial.clearLog':
                    this.serialLog = [];
                    this.postToWebview({ type: 'serial.logCleared' });
                    break;
                case 'serial.exportLog':
                    await this.handleExportLog();
                    break;
                case 'serial.resetStats':
                    this.serialManager.resetStats();
                    this.sendSerialStats();
                    break;

                // MQTT 相关
                case 'mqtt.connect':
                    this.handleMqttConnect(msg.config);
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
                    this.mqttStore.clear();
                    this.postToWebview({ type: 'mqtt.messagesCleared' });
                    break;
                case 'mqtt.exportMessages':
                    await this.handleExportMqttMessages();
                    break;

                // 桥接相关
                case 'bridge.start':
                    this.handleBridgeStart(msg.config);
                    break;
                case 'bridge.stop':
                    this.bridgeManager.stop();
                    break;

                // 配置方案
                case 'profile.save':
                    this.handleSaveProfile(msg.name, msg.data);
                    break;
                case 'profile.load':
                    this.handleLoadProfile(msg.name);
                    break;
                case 'profile.delete':
                    this.handleDeleteProfile(msg.name);
                    break;
                case 'profile.list':
                    this.sendProfileList();
                    break;
            }
        }, null, this.disposables);
    }

    private setupEventListeners(): void {
        // 串口事件
        this.serialManager.on('connect', () => {
            this.postToWebview({ type: 'serial.connected', port: this.serialManager.config?.port });
            // 保存上次使用的串口配置
            if (this.serialManager.config) {
                this.profileManager.saveLastConfig({
                    serial: this.serialManager.config,
                    mqtt: this.mqttManager.config || undefined,
                    bridge: this.bridgeManager.config || undefined
                });
            }
        });

        this.serialManager.on('disconnect', () => {
            this.postToWebview({ type: 'serial.disconnected' });
        });

        this.serialManager.on('data', (data: Buffer) => {
            const line = formatDataLine('RX', data, 'ascii');
            this.serialLog.push(line);
            this.postToWebview({
                type: 'serial.data',
                direction: 'RX',
                hex: Buffer.from(data).toString('hex').toUpperCase().match(/.{2}/g)?.join(' ') || '',
                ascii: data.toString('utf-8'),
                timestamp: timestamp()
            });
            this.sendSerialStats();
        });

        this.serialManager.on('sent', (data: Buffer) => {
            const line = formatDataLine('TX', data, 'ascii');
            this.serialLog.push(line);
            this.postToWebview({
                type: 'serial.data',
                direction: 'TX',
                hex: Buffer.from(data).toString('hex').toUpperCase().match(/.{2}/g)?.join(' ') || '',
                ascii: data.toString('utf-8'),
                timestamp: timestamp()
            });
            this.sendSerialStats();
        });

        this.serialManager.on('error', (msg: string) => {
            this.postToWebview({ type: 'serial.error', message: msg });
        });

        this.serialManager.on('reconnecting', () => {
            this.postToWebview({ type: 'serial.reconnecting' });
        });

        this.serialManager.on('reconnectFailed', () => {
            this.postToWebview({ type: 'serial.reconnectFailed' });
        });

        this.serialManager.on('break', (duration: number) => {
            this.postToWebview({ type: 'serial.breakSent', duration });
        });

        // MQTT 事件
        this.mqttManager.on('connect', () => {
            this.postToWebview({ type: 'mqtt.connected' });
            // 保存上次使用的MQTT配置
            if (this.mqttManager.config) {
                this.profileManager.saveLastConfig({
                    serial: this.serialManager.config || undefined,
                    mqtt: this.mqttManager.config,
                    bridge: this.bridgeManager.config || undefined
                });
            }
        });

        this.mqttManager.on('disconnect', () => {
            this.postToWebview({ type: 'mqtt.disconnected' });
        });

        this.mqttManager.on('message', (msg: MqttMessage) => {
            this.mqttStore.addMessage(msg);
            this.postToWebview({ type: 'mqtt.message', message: msg });
        });

        this.mqttManager.on('error', (msg: string) => {
            this.postToWebview({ type: 'mqtt.error', message: msg });
        });

        this.mqttManager.on('subscribe', (sub: Subscription) => {
            this.postToWebview({ type: 'mqtt.subscribed', subscription: sub });
        });

        this.mqttManager.on('unsubscribe', (topic: string) => {
            this.postToWebview({ type: 'mqtt.unsubscribed', topic });
        });

        // 桥接事件
        this.bridgeManager.on('start', () => {
            this.postToWebview({ type: 'bridge.started', config: this.bridgeManager.config });
        });

        this.bridgeManager.on('stop', () => {
            this.postToWebview({ type: 'bridge.stopped' });
        });

        this.bridgeManager.on('forward', (info: { direction: string; data: string }) => {
            this.postToWebview({ type: 'bridge.forward', ...info, count: this.bridgeManager.forwardCount });
        });
    }

    // === 串口处理 ===

    private async handleListPorts(): Promise<void> {
        const ports = await this.serialManager.listPorts();
        this.postToWebview({ type: 'serial.ports', ports });
    }

    private async handleSerialConnect(config: SerialConfig): Promise<void> {
        const ok = await this.serialManager.connect(config);
        if (!ok) {
            this.postToWebview({ type: 'serial.error', message: `连接 ${config.port} 失败` });
        }
    }

    private async handleSerialDisconnect(): Promise<void> {
        if (this.bridgeManager.active) {
            this.bridgeManager.stop();
        }
        await this.serialManager.disconnect();
    }

    private async handleSerialSend(data: string, mode: DisplayMode, lineEnding: string): Promise<void> {
        try {
            const buf = prepareSendData(data, mode, lineEnding as any);
            await this.serialManager.send(buf);
        } catch (err) {
            this.postToWebview({ type: 'serial.error', message: (err as Error).message });
        }
    }

    private sendSerialStats(): void {
        this.postToWebview({
            type: 'serial.stats',
            rxBytes: this.serialManager.rxBytes,
            txBytes: this.serialManager.txBytes,
            errorFrames: this.serialManager.errorFrameCount
        });
    }

    private async handleExportLog(): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            filters: { '日志文件': ['txt', 'log'] },
            defaultUri: vscode.Uri.file('serial_log.txt')
        });
        if (uri) {
            const content = this.serialLog.join('\n');
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
            logger.info(`串口日志已导出: ${uri.fsPath}`);
        }
    }

    // === MQTT 处理 ===

    private handleMqttConnect(config: MqttConfig): void {
        this.mqttManager.connect(config);
    }

    private async handleExportMqttMessages(): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            filters: { '日志文件': ['txt', 'log'] },
            defaultUri: vscode.Uri.file('mqtt_log.txt')
        });
        if (uri) {
            const content = this.mqttStore.exportAsText();
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
            logger.info(`MQTT 日志已导出: ${uri.fsPath}`);
        }
    }

    // === 桥接处理 ===

    private handleBridgeStart(config: BridgeConfig): void {
        const ok = this.bridgeManager.start(config);
        if (!ok) {
            this.postToWebview({ type: 'bridge.error', message: '桥接启动失败，请确保串口和MQTT都已连接' });
        }
    }

    // === 配置方案 ===

    private handleSaveProfile(name: string, data?: any): void {
        const profile: Profile = {
            name,
            serial: data?.serial || this.serialManager.config || this.profileManager.getDefaultSerialConfig(),
            mqtt: data?.mqtt || this.mqttManager.config || this.profileManager.getDefaultMqttConfig(),
            bridge: data?.bridge || this.bridgeManager.config || this.profileManager.getDefaultBridgeConfig(),
            createdAt: ''
        };
        this.profileManager.saveProfile(profile);
        this.sendProfileList();
    }

    private handleLoadProfile(name: string): void {
        const profile = this.profileManager.getProfile(name);
        if (profile) {
            this.postToWebview({ type: 'profile.loaded', profile });
        }
    }

    private handleDeleteProfile(name: string): void {
        this.profileManager.deleteProfile(name);
        this.sendProfileList();
    }

    private sendProfileList(): void {
        const profiles = this.profileManager.getProfiles();
        this.postToWebview({ type: 'profile.list', profiles });
    }

    // === 通信 ===

    private postToWebview(message: any): void {
        this.panel.webview.postMessage(message);
    }

    dispose(): void {
        MainPanel.currentPanel = undefined;
        this.bridgeManager.dispose();
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) d.dispose();
        }
    }
}
