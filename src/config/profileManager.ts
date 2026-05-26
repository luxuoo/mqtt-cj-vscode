import * as vscode from 'vscode';
import { SerialConfig } from '../serial/serialManager';
import { MqttConfig } from '../mqtt/mqttManager';
import { BridgeConfig } from '../bridge/bridgeManager';
import { logger } from '../utils/logger';

export interface Profile {
    name: string;
    serial: SerialConfig;
    mqtt: MqttConfig;
    bridge: BridgeConfig;
    createdAt: string;
}

const STORAGE_KEY = 'serialMqtt.profiles';

export class ProfileManager {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    getProfiles(): Profile[] {
        return this.context.globalState.get<Profile[]>(STORAGE_KEY, []);
    }

    getProfile(name: string): Profile | undefined {
        return this.getProfiles().find(p => p.name === name);
    }

    saveProfile(profile: Profile): void {
        const profiles = this.getProfiles();
        const index = profiles.findIndex(p => p.name === profile.name);
        profile.createdAt = new Date().toLocaleString('zh-CN');
        if (index >= 0) {
            profiles[index] = profile;
        } else {
            profiles.push(profile);
        }
        this.context.globalState.update(STORAGE_KEY, profiles);
        logger.info(`配置方案 "${profile.name}" 已保存`);
    }

    deleteProfile(name: string): boolean {
        const profiles = this.getProfiles();
        const index = profiles.findIndex(p => p.name === name);
        if (index < 0) return false;
        profiles.splice(index, 1);
        this.context.globalState.update(STORAGE_KEY, profiles);
        logger.info(`配置方案 "${name}" 已删除`);
        return true;
    }

    getDefaultSerialConfig(): SerialConfig {
        const cfg = vscode.workspace.getConfiguration('serialMqtt');
        return {
            port: '',
            baudRate: cfg.get<number>('defaultBaudRate', 115200),
            dataBits: cfg.get<number>('defaultDataBits', 8) as 5 | 6 | 7 | 8,
            stopBits: cfg.get<number>('defaultStopBits', 1) as 1 | 1.5 | 2,
            parity: cfg.get<string>('defaultParity', 'none') as 'none' | 'odd' | 'even' | 'mark' | 'space',
            rtscts: false,
            xon: false,
            xoff: false,
            dtr: true,
            rts: false
        };
    }

    getDefaultMqttConfig(): MqttConfig {
        const cfg = vscode.workspace.getConfiguration('serialMqtt');
        return {
            broker: cfg.get<string>('defaultMqttBroker', 'broker.emqx.io'),
            port: cfg.get<number>('defaultMqttPort', 1883),
            clientId: '',
            protocol: cfg.get<string>('defaultMqttProtocol', 'mqtt') as 'mqtt' | 'mqtts' | 'ws' | 'wss',
            cleanSession: true,
            keepAlive: cfg.get<number>('keepAlive', 60),
            reconnect: cfg.get<boolean>('autoReconnect', true),
            reconnectInterval: cfg.get<number>('reconnectInterval', 5000),
            willQos: 0,
            willRetain: false
        };
    }

    getDefaultBridgeConfig(): BridgeConfig {
        const cfg = vscode.workspace.getConfiguration('serialMqtt');
        return {
            serialToMqtt: false,
            mqttToSerial: false,
            serialToMqttTopic: cfg.get<string>('bridgeDefaultSerialToMqttTopic', 'serial/rx'),
            mqttToSerialTopic: cfg.get<string>('bridgeDefaultMqttToSerialTopic', 'serial/tx'),
            transform: 'none'
        };
    }
}
