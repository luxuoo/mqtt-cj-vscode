import { EventEmitter } from 'events';
import { SerialManager } from '../serial/serialManager';
import { MqttManager } from '../mqtt/mqttManager';
import { logger } from '../utils/logger';
import { bufferToHex, hexToBuffer } from '../utils/formatter';

export type BridgeTransform = 'none' | 'hex-to-text' | 'text-to-hex';

export interface BridgeConfig {
    serialToMqtt: boolean;
    mqttToSerial: boolean;
    serialToMqttTopic: string;
    mqttToSerialTopic: string;
    transform: BridgeTransform;
}

export class BridgeManager extends EventEmitter {
    private serialManager: SerialManager;
    private mqttManager: MqttManager;
    private _active: boolean = false;
    private _config: BridgeConfig | null = null;
    private _forwardCount: number = 0;

    constructor(serialManager: SerialManager, mqttManager: MqttManager) {
        super();
        this.serialManager = serialManager;
        this.mqttManager = mqttManager;
    }

    get active(): boolean {
        return this._active;
    }

    get config(): BridgeConfig | null {
        return this._config;
    }

    get forwardCount(): number {
        return this._forwardCount;
    }

    start(config: BridgeConfig): boolean {
        if (!this.serialManager.connected || !this.mqttManager.connected) {
            logger.error('桥接需要串口和MQTT都已连接');
            return false;
        }

        this._config = config;
        this._active = true;
        this._forwardCount = 0;

        // 串口 → MQTT
        if (config.serialToMqtt) {
            this.serialManager.on('data', this.handleSerialData);
            logger.info(`桥接已启动: 串口 → MQTT (${config.serialToMqttTopic})`);
        }

        // MQTT → 串口
        if (config.mqttToSerial) {
            this.mqttManager.on('message', this.handleMqttMessage);
            this.mqttManager.subscribe(config.mqttToSerialTopic, 0);
            logger.info(`桥接已启动: MQTT → 串口 (${config.mqttToSerialTopic})`);
        }

        this.emit('start');
        return true;
    }

    stop(): void {
        if (!this._active) return;

        this.serialManager.removeListener('data', this.handleSerialData);
        this.mqttManager.removeListener('message', this.handleMqttMessage);

        if (this._config?.mqttToSerialTopic) {
            this.mqttManager.unsubscribe(this._config.mqttToSerialTopic);
        }

        this._active = false;
        this._config = null;
        logger.info('桥接已停止');
        this.emit('stop');
    }

    private handleSerialData = (data: Buffer): void => {
        if (!this._config || !this.mqttManager.connected) return;

        let payload: string;
        switch (this._config.transform) {
            case 'hex-to-text':
                payload = data.toString('utf-8');
                break;
            case 'text-to-hex':
                payload = bufferToHex(data);
                break;
            default:
                payload = data.toString('utf-8');
                break;
        }

        this.mqttManager.publish(this._config.serialToMqttTopic, payload, 0);
        this._forwardCount++;
        this.emit('forward', { direction: 'serial-to-mqtt', data: payload });
    };

    private handleMqttMessage = (msg: { topic: string; payload: string }): void => {
        if (!this._config || !this.serialManager.connected) return;
        if (msg.topic !== this._config.mqttToSerialTopic) return;

        let buf: Buffer;
        switch (this._config.transform) {
            case 'text-to-hex':
                buf = Buffer.from(msg.payload, 'utf-8');
                break;
            case 'hex-to-text':
                try {
                    buf = hexToBuffer(msg.payload);
                } catch {
                    buf = Buffer.from(msg.payload, 'utf-8');
                }
                break;
            default:
                buf = Buffer.from(msg.payload, 'utf-8');
                break;
        }

        this.serialManager.send(buf);
        this._forwardCount++;
        this.emit('forward', { direction: 'mqtt-to-serial', data: msg.payload });
    };

    dispose(): void {
        this.stop();
        this.removeAllListeners();
    }
}
