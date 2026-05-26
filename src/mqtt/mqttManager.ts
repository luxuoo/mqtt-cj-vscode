import * as mqtt from 'mqtt';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { generateClientId } from '../utils/formatter';

export interface MqttConfig {
    broker: string;
    port: number;
    clientId: string;
    username?: string;
    password?: string;
    protocol: 'mqtt' | 'mqtts' | 'ws' | 'wss';
    cleanSession: boolean;
    keepAlive: number;
    reconnect: boolean;
    reconnectInterval: number;
    ca?: string;
    cert?: string;
    key?: string;
    willTopic?: string;
    willPayload?: string;
    willQos: 0 | 1 | 2;
    willRetain: boolean;
}

export interface MqttMessage {
    topic: string;
    payload: string;
    qos: 0 | 1 | 2;
    retain: boolean;
    timestamp: string;
}

export interface Subscription {
    topic: string;
    qos: 0 | 1 | 2;
}

export class MqttManager extends EventEmitter {
    private client: mqtt.MqttClient | null = null;
    private _connected: boolean = false;
    private _config: MqttConfig | null = null;
    private _subscriptions: Map<string, Subscription> = new Map();

    get connected(): boolean {
        return this._connected;
    }

    get config(): MqttConfig | null {
        return this._config;
    }

    get subscriptions(): Subscription[] {
        return Array.from(this._subscriptions.values());
    }

    connect(config: MqttConfig): void {
        if (this.client) {
            this.disconnect();
        }

        this._config = config;

        const clientId = config.clientId || generateClientId('mqtt');

        const options: mqtt.IClientOptions = {
            clientId,
            clean: config.cleanSession,
            keepalive: config.keepAlive,
            reconnectPeriod: config.reconnect ? config.reconnectInterval : 0,
            connectTimeout: 10000,
        };

        if (config.username) {
            options.username = config.username;
        }
        if (config.password) {
            options.password = config.password;
        }

        // TLS
        if (config.protocol === 'mqtts' || config.protocol === 'wss') {
            options.rejectUnauthorized = false;
            if (config.ca) {
                options.ca = config.ca;
            }
            if (config.cert) {
                options.cert = config.cert;
            }
            if (config.key) {
                options.key = config.key;
            }
        }

        // 遗嘱消息
        if (config.willTopic) {
            options.will = {
                topic: config.willTopic,
                payload: config.willPayload || '',
                qos: config.willQos,
                retain: config.willRetain
            };
        }

        const url = `${config.protocol}://${config.broker}:${config.port}`;

        logger.info(`正在连接 MQTT: ${url} (ClientID: ${clientId})`);

        try {
            this.client = mqtt.connect(url, options);

            this.client.on('connect', () => {
                this._connected = true;
                logger.info('MQTT 已连接');
                this.emit('connect');

                // 重新订阅
                for (const sub of this._subscriptions.values()) {
                    this.client!.subscribe(sub.topic, { qos: sub.qos });
                }
            });

            this.client.on('message', (topic: string, payload: Buffer, packet: mqtt.IPublishPacket) => {
                const msg: MqttMessage = {
                    topic,
                    payload: payload.toString(),
                    qos: packet.qos as 0 | 1 | 2,
                    retain: packet.retain,
                    timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false })
                };
                this.emit('message', msg);
            });

            this.client.on('error', (err: Error) => {
                logger.error('MQTT 错误', err);
                this.emit('error', err.message);
            });

            this.client.on('close', () => {
                if (this._connected) {
                    this._connected = false;
                    this.emit('disconnect');
                    logger.info('MQTT 已断开');
                }
            });

            this.client.on('offline', () => {
                this._connected = false;
                this.emit('offline');
                logger.info('MQTT 离线');
            });

            this.client.on('reconnect', () => {
                logger.info('MQTT 正在重连...');
                this.emit('reconnect');
            });
        } catch (err) {
            logger.error('MQTT 连接失败', err as Error);
            this.emit('error', (err as Error).message);
        }
    }

    disconnect(): void {
        if (this.client) {
            this._connected = false;
            this.client.end(true);
            this.client = null;
            this._subscriptions.clear();
            logger.info('MQTT 已断开');
            this.emit('disconnect');
        }
    }

    subscribe(topic: string, qos: 0 | 1 | 2 = 0): boolean {
        if (!this.client || !this._connected) {
            logger.error('MQTT 未连接，无法订阅');
            return false;
        }

        this.client.subscribe(topic, { qos }, (err) => {
            if (err) {
                logger.error(`订阅 ${topic} 失败`, err);
                return;
            }
            logger.info(`已订阅: ${topic} (QoS ${qos})`);
        });

        this._subscriptions.set(topic, { topic, qos });
        this.emit('subscribe', { topic, qos });
        return true;
    }

    unsubscribe(topic: string): boolean {
        if (!this.client) {
            return false;
        }

        this.client.unsubscribe(topic, (err) => {
            if (err) {
                logger.error(`取消订阅 ${topic} 失败`, err);
                return;
            }
            logger.info(`已取消订阅: ${topic}`);
        });

        this._subscriptions.delete(topic);
        this.emit('unsubscribe', topic);
        return true;
    }

    publish(topic: string, payload: string, qos: 0 | 1 | 2 = 0, retain: boolean = false): boolean {
        if (!this.client || !this._connected) {
            logger.error('MQTT 未连接，无法发布');
            return false;
        }

        this.client.publish(topic, payload, { qos, retain }, (err) => {
            if (err) {
                logger.error(`发布到 ${topic} 失败`, err);
                return;
            }
            logger.debug(`已发布到 ${topic}: ${payload.substring(0, 100)}`);
        });

        this.emit('published', { topic, payload, qos, retain });
        return true;
    }

    dispose(): void {
        this.disconnect();
        this.removeAllListeners();
    }
}
