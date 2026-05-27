import * as vscode from 'vscode';
import { SerialManager } from './serial/serialManager';
import { MqttManager } from './mqtt/mqttManager';
import { ProfileManager } from './config/profileManager';
import { BridgeManager } from './bridge/bridgeManager';
import { MainPanel } from './views/mainPanel';
import { SidebarProvider } from './views/sidebarProvider';
import { logger } from './utils/logger';

let serialManager: SerialManager;
let mqttManager: MqttManager;
let profileManager: ProfileManager;
let bridgeManager: BridgeManager;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: SidebarProvider;

export function activate(context: vscode.ExtensionContext) {
    try {
        logger.info('串口+MQTT调试器 已激活');

        serialManager = new SerialManager();
        mqttManager = new MqttManager();
        profileManager = new ProfileManager(context);
        bridgeManager = new BridgeManager(serialManager, mqttManager);

        // 侧栏 WebviewView
        sidebarProvider = new SidebarProvider(
            context.extensionUri,
            serialManager,
            mqttManager,
            profileManager,
            bridgeManager
        );
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
                webviewOptions: { retainContextWhenHidden: true }
            })
        );

        // 状态栏
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.text = '$(plug) 串口MQTT';
        statusBarItem.tooltip = '打开串口+MQTT调试面板';
        statusBarItem.command = 'serialMqtt.openPanel';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        const updateStatusBar = () => {
            if (!statusBarItem) return;
            const s = serialManager.connected ? '●' : '○';
            const m = mqttManager.connected ? '●' : '○';
            statusBarItem.text = `$(plug) 串口${s} MQTT${m}`;
        };
        serialManager.on('connect', updateStatusBar);
        serialManager.on('disconnect', updateStatusBar);
        mqttManager.on('connect', updateStatusBar);
        mqttManager.on('disconnect', updateStatusBar);

        // 命令
        context.subscriptions.push(
            vscode.commands.registerCommand('serialMqtt.openPanel', () => {
                MainPanel.createOrShow(context.extensionUri, serialManager, mqttManager, profileManager, bridgeManager);
            })
        );

        context.subscriptions.push({
            dispose: () => {
                serialManager?.dispose();
                mqttManager?.dispose();
                sidebarProvider?.dispose();
                logger.dispose();
            }
        });

    } catch (err) {
        logger.error('插件激活失败', err as Error);
        vscode.window.showErrorMessage('串口MQTT调试器激活失败: ' + (err as Error).message);
    }
}

export function deactivate() {
    serialManager?.dispose();
    mqttManager?.dispose();
    sidebarProvider?.dispose();
    logger?.dispose();
}
