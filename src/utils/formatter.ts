/**
 * HEX 字符串转 Buffer
 */
export function hexToBuffer(hex: string): Buffer {
    const clean = hex.replace(/\s+/g, '').replace(/0x/gi, '');
    if (clean.length % 2 !== 0) {
        throw new Error('HEX 字符串长度必须为偶数');
    }
    if (!/^[0-9a-fA-F]*$/.test(clean)) {
        throw new Error('HEX 字符串包含无效字符');
    }
    return Buffer.from(clean, 'hex');
}

/**
 * Buffer 转 HEX 字符串（空格分隔，大写）
 */
export function bufferToHex(buf: Buffer): string {
    return Array.from(buf)
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
}

/**
 * 获取当前时间戳字符串 [HH:mm:ss.SSS]
 */
export function timestamp(): string {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `[${h}:${m}:${s}.${ms}]`;
}

/**
 * 格式化数据行
 */
export function formatDataLine(direction: 'TX' | 'RX', data: Buffer, mode: 'ascii' | 'hex'): string {
    const ts = timestamp();
    const content = mode === 'hex' ? bufferToHex(data) : data.toString('utf-8').replace(/\r?\n/g, '');
    return `${ts} ${direction}: ${content}`;
}

/**
 * 验证 HEX 字符串格式
 */
export function isValidHex(hex: string): boolean {
    const clean = hex.replace(/\s+/g, '').replace(/0x/gi, '');
    return clean.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(clean);
}

/**
 * 尝试格式化 JSON
 */
export function tryFormatJson(str: string): string {
    try {
        const obj = JSON.parse(str);
        return JSON.stringify(obj, null, 2);
    } catch {
        return str;
    }
}

/**
 * 生成随机 Client ID
 */
export function generateClientId(prefix: string = 'vscode'): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 字节数格式化
 */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
