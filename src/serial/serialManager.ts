import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { execSync } from 'child_process';

export interface SerialConfig {
    port: string;
    baudRate: number;
    dataBits: 5 | 6 | 7 | 8;
    stopBits: 1 | 1.5 | 2;
    parity: 'none' | 'odd' | 'even' | 'mark' | 'space';
    rtscts: boolean;
    xon: boolean;
    xoff: boolean;
    dtr: boolean;
    rts: boolean;
}

export interface PortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
    pnpId?: string;
}

// 尝试加载 serialport 原生模块
let SerialPortClass: any = null;
try {
    SerialPortClass = require('serialport').SerialPort;
} catch {
    // 原生模块不可用，使用 fallback
}

/**
 * Windows fallback: 通过 PowerShell 注册表枚举串口
 */
function listPortsWindows(): PortInfo[] {
    const ports: PortInfo[] = [];
    try {
        // 方法1: 通过注册表
        const cmd = `powershell -NoProfile -Command "Get-ItemProperty 'HKLM:\\HARDWARE\\DEVICEMAP\\SERIALCOMM' | Select-Object -Property * -ExcludeProperty PS* | ForEach-Object { $_.PSObject.Properties } | ForEach-Object { $_.Value + '|' + $_.Name }"`;
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
        if (output) {
            for (const line of output.split('\n')) {
                const parts = line.trim().split('|');
                if (parts[0]) {
                    ports.push({
                        path: parts[0].trim(),
                        manufacturer: parts[1]?.trim() || ''
                    });
                }
            }
        }
    } catch {
        // 方法2: 通过 WMI
        try {
            const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Description, Manufacturer | ForEach-Object { $_.DeviceID + '|' + $_.Description + '|' + $_.Manufacturer }"`;
            const output = execSync(cmd, { encoding: 'utf-8', timeout: 8000 }).trim();
            if (output) {
                for (const line of output.split('\n')) {
                    const parts = line.trim().split('|');
                    if (parts[0]) {
                        ports.push({
                            path: parts[0].trim(),
                            manufacturer: parts[2]?.trim() || parts[1]?.trim() || ''
                        });
                    }
                }
            }
        } catch {
            // 方法3: 枚举 COM 端口名称
            try {
                const cmd = `powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames()"`;
                const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
                if (output) {
                    for (const line of output.split('\n')) {
                        const port = line.trim();
                        if (port && port.startsWith('COM')) {
                            ports.push({ path: port });
                        }
                    }
                }
            } catch {
                // 所有方法都失败
            }
        }
    }
    return ports;
}

/**
 * Linux/Mac fallback
 */
function listPortsUnix(): PortInfo[] {
    const ports: PortInfo[] = [];
    const patterns = ['/dev/ttyUSB*', '/dev/ttyACM*', '/dev/tty.usb*', '/dev/cu.usb*', '/dev/cu.*'];
    for (const pattern of patterns) {
        try {
            const output = execSync(`ls ${pattern} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
            if (output) {
                for (const line of output.split('\n')) {
                    const p = line.trim();
                    if (p) { ports.push({ path: p }); }
                }
            }
        } catch { /* ignore */ }
    }
    return ports;
}

export class SerialManager extends EventEmitter {
    private port: any = null;
    private _connected: boolean = false;
    private _config: SerialConfig | null = null;
    private _rxBytes: number = 0;
    private _txBytes: number = 0;

    get connected(): boolean { return this._connected; }
    get config(): SerialConfig | null { return this._config; }
    get rxBytes(): number { return this._rxBytes; }
    get txBytes(): number { return this._txBytes; }

    async listPorts(): Promise<PortInfo[]> {
        // 优先使用原生模块
        if (SerialPortClass) {
            try {
                const ports = await SerialPortClass.list();
                return ports.map((p: any) => ({
                    path: p.path,
                    manufacturer: p.manufacturer,
                    serialNumber: p.serialNumber,
                    vendorId: p.vendorId,
                    productId: p.productId,
                    pnpId: p.pnpId
                }));
            } catch (err) {
                logger.warn('原生枚举失败，使用系统命令 fallback');
            }
        }

        // Fallback: 系统命令
        try {
            if (process.platform === 'win32') {
                return listPortsWindows();
            }
            return listPortsUnix();
        } catch (err) {
            logger.error('枚举串口失败', err as Error);
            return [];
        }
    }

    async connect(config: SerialConfig): Promise<boolean> {
        if (!SerialPortClass) {
            logger.error('串口原生模块不可用，无法连接。请运行: npm rebuild serialport --runtime=electron --target=最新Electron版本');
            return false;
        }

        if (this.port) { await this.disconnect(); }
        this._config = config;

        return new Promise((resolve) => {
            try {
                this.port = new SerialPortClass({
                    path: config.port,
                    baudRate: config.baudRate,
                    dataBits: config.dataBits,
                    stopBits: config.stopBits as 1 | 1.5 | 2,
                    parity: config.parity,
                    rtscts: config.rtscts,
                    xon: config.xon,
                    xoff: config.xoff,
                    autoOpen: false
                });

                this.port.open((err: any) => {
                    if (err) {
                        logger.error(`打开串口 ${config.port} 失败`, err);
                        this.port = null;
                        resolve(false);
                        return;
                    }

                    this._connected = true;
                    this._rxBytes = 0;
                    this._txBytes = 0;

                    if (config.dtr) { this.port!.set({ dtr: true }); }
                    if (config.rts) { this.port!.set({ rts: true }); }

                    this.port!.on('data', (data: Buffer) => {
                        this._rxBytes += data.length;
                        this.emit('data', data);
                    });
                    this.port!.on('error', (err: any) => {
                        logger.error('串口错误', err);
                        this.emit('error', err.message);
                    });
                    this.port!.on('close', () => {
                        this._connected = false;
                        this.emit('disconnect');
                        logger.info(`串口 ${config.port} 已断开`);
                    });

                    logger.info(`串口 ${config.port} 已连接 (${config.baudRate}bps)`);
                    this.emit('connect');
                    resolve(true);
                });
            } catch (err) {
                logger.error('连接串口异常', err as Error);
                resolve(false);
            }
        });
    }

    async disconnect(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.port) { this._connected = false; resolve(); return; }
            const port = this.port;
            this.port = null;
            this._connected = false;
            if (port.isOpen) {
                port.close((err: any) => { if (err) { logger.error('关闭串口失败', err); } resolve(); });
            } else { resolve(); }
        });
    }

    async send(data: Buffer): Promise<boolean> {
        if (!this.port || !this._connected) { logger.error('串口未连接'); return false; }
        return new Promise((resolve) => {
            this.port!.write(data, (err: any) => {
                if (err) { logger.error('发送失败', err); resolve(false); return; }
                this.port!.drain((err: any) => {
                    if (err) { logger.error('drain 失败', err); }
                    this._txBytes += data.length;
                    this.emit('sent', data);
                    resolve(true);
                });
            });
        });
    }

    setDtr(value: boolean): void {
        if (this.port && this._connected) { this.port.set({ dtr: value }); }
    }

    setRts(value: boolean): void {
        if (this.port && this._connected) { this.port.set({ rts: value }); }
    }

    resetStats(): void { this._rxBytes = 0; this._txBytes = 0; }

    dispose(): void { this.disconnect(); this.removeAllListeners(); }
}
