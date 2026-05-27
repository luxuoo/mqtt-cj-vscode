import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

export class ProfileManager {
    private filePath: string;
    private lastConfigPath: string;
    private profiles: Profile[] = [];
    private lastConfig: { serial?: SerialConfig; mqtt?: MqttConfig; bridge?: BridgeConfig } | null = null;

    constructor(context: vscode.ExtensionContext) {
        // 存储在插件的 globalStorageUri 目录下
        const storageDir = context.globalStorageUri.fsPath;
        this.filePath = path.join(storageDir, 'profiles.json');
        this.lastConfigPath = path.join(storageDir, 'lastConfig.json');
        this.load();
        this.loadLastConfig();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this.profiles = data;
                }
            }
        } catch (err) {
            logger.warn('读取配置方案失败，使用空列表');
            this.profiles = [];
        }
    }

    private loadLastConfig(): void {
        try {
            if (fs.existsSync(this.lastConfigPath)) {
                const raw = fs.readFileSync(this.lastConfigPath, 'utf-8');
                this.lastConfig = JSON.parse(raw);
            }
        } catch {
            this.lastConfig = null;
        }
    }

    saveLastConfig(config: { serial?: SerialConfig; mqtt?: MqttConfig; bridge?: BridgeConfig }): void {
        try {
            this.lastConfig = config;
            const dir = path.dirname(this.lastConfigPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.lastConfigPath, JSON.stringify(config, null, 2), 'utf-8');
        } catch (err) {
            logger.warn(`保存上次配置失败: ${(err as Error).message}`);
        }
    }

    getLastConfig(): { serial?: SerialConfig; mqtt?: MqttConfig; bridge?: BridgeConfig } | null {
        return this.lastConfig;
    }

    private save(): void {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(this.profiles, null, 2), 'utf-8');
        } catch (err) {
            logger.error('保存配置方案失败', err as Error);
        }
    }

    getProfiles(): Profile[] {
        return this.profiles;
    }

    getProfile(name: string): Profile | undefined {
        return this.profiles.find(p => p.name === name);
    }

    saveProfile(profile: Profile): void {
        const index = this.profiles.findIndex(p => p.name === profile.name);
        profile.createdAt = new Date().toLocaleString('zh-CN');

        // 清理 undefined 值，确保 JSON 序列化正确
        profile.serial = this.cleanObj(profile.serial) as SerialConfig;
        profile.mqtt = this.cleanObj(profile.mqtt) as MqttConfig;
        profile.bridge = this.cleanObj(profile.bridge) as BridgeConfig;

        if (index >= 0) {
            this.profiles[index] = profile;
        } else {
            this.profiles.push(profile);
        }
        this.save();
        logger.info(`配置方案 "${profile.name}" 已保存 (${this.filePath})`);
    }

    deleteProfile(name: string): boolean {
        const index = this.profiles.findIndex(p => p.name === name);
        if (index < 0) return false;
        this.profiles.splice(index, 1);
        this.save();
        logger.info(`配置方案 "${name}" 已删除`);
        return true;
    }

    private cleanObj(obj: any): any {
        if (!obj || typeof obj !== 'object') return obj;
        const result: any = {};
        for (const key of Object.keys(obj)) {
            if (obj[key] !== undefined) {
                result[key] = obj[key];
            }
        }
        return result;
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
