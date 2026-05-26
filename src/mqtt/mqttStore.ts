import { MqttMessage } from './mqttManager';

export class MqttStore {
    private messages: MqttMessage[] = [];
    private maxSize: number;

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }

    addMessage(msg: MqttMessage): void {
        this.messages.push(msg);
        if (this.messages.length > this.maxSize) {
            this.messages.shift();
        }
    }

    getMessages(filter?: string): MqttMessage[] {
        if (!filter) {
            return [...this.messages];
        }
        const lowerFilter = filter.toLowerCase();
        return this.messages.filter(
            m => m.topic.toLowerCase().includes(lowerFilter) ||
                m.payload.toLowerCase().includes(lowerFilter)
        );
    }

    clear(): void {
        this.messages = [];
    }

    get count(): number {
        return this.messages.length;
    }

    exportAsText(): string {
        return this.messages.map(m =>
            `[${m.timestamp}] [${m.topic}] QoS${m.qos}${m.retain ? ' [Retain]' : ''} ${m.payload}`
        ).join('\n');
    }
}
