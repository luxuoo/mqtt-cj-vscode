import { bufferToHex } from '../utils/formatter';

export type DisplayMode = 'ascii' | 'hex';
export type LineEnding = '\r\n' | '\n' | '\r' | 'none';
export type Encoding = 'utf-8' | 'ascii' | 'gbk' | 'gb2312';

export interface SerialDataEvent {
    direction: 'TX' | 'RX';
    raw: Buffer;
    display: string;
    timestamp: string;
}

/**
 * 解析接收到的串口数据
 */
export function parseReceivedData(data: Buffer, mode: DisplayMode): string {
    if (mode === 'hex') {
        return bufferToHex(data);
    }
    return data.toString('utf-8');
}

/**
 * 准备发送数据
 */
export function prepareSendData(input: string, mode: DisplayMode, lineEnding: LineEnding): Buffer {
    let buf: Buffer;

    if (mode === 'hex') {
        const clean = input.replace(/\s+/g, '').replace(/0x/gi, '');
        if (!/^[0-9a-fA-F]*$/.test(clean)) {
            throw new Error('无效的 HEX 格式');
        }
        if (clean.length % 2 !== 0) {
            throw new Error('HEX 字符串长度必须为偶数');
        }
        buf = Buffer.from(clean, 'hex');
    } else {
        let text = input;
        switch (lineEnding) {
            case '\r\n':
                text += '\r\n';
                break;
            case '\n':
                text += '\n';
                break;
            case '\r':
                text += '\r';
                break;
            case 'none':
                break;
        }
        buf = Buffer.from(text, 'utf-8');
    }

    return buf;
}

/**
 * 检查是否为有效的 HEX 输入
 */
export function isValidHexInput(input: string): boolean {
    const clean = input.replace(/\s+/g, '').replace(/0x/gi, '');
    return clean.length > 0 && clean.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(clean);
}
