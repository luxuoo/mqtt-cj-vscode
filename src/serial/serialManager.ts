import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

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

function listPortsWindows(): PortInfo[] {
    const ports: PortInfo[] = [];
    try {
        const cmd = `powershell -NoProfile -Command "Get-ItemProperty 'HKLM:\\HARDWARE\\DEVICEMAP\\SERIALCOMM' | Select-Object -Property * -ExcludeProperty PS* | ForEach-Object { $_.PSObject.Properties } | ForEach-Object { $_.Value + '|' + $_.Name }"`;
        const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim();
        if (output) {
            for (const line of output.split('\n')) {
                const parts = line.trim().split('|');
                if (parts[0]) {
                    ports.push({ path: parts[0].trim(), manufacturer: parts[1]?.trim() || '' });
                }
            }
        }
    } catch {
        try {
            const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Description, Manufacturer | ForEach-Object { $_.DeviceID + '|' + $_.Description + '|' + $_.Manufacturer }"`;
            const output = execSync(cmd, { encoding: 'utf-8', timeout: 8000 }).trim();
            if (output) {
                for (const line of output.split('\n')) {
                    const parts = line.trim().split('|');
                    if (parts[0]) {
                        ports.push({ path: parts[0].trim(), manufacturer: parts[2]?.trim() || parts[1]?.trim() || '' });
                    }
                }
            }
        } catch {
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
            } catch {}
        }
    }
    return ports;
}

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
        } catch {}
    }
    return ports;
}

export class SerialManager extends EventEmitter {
    private worker: ChildProcess | null = null;
    private workerReady: boolean = false;
    private _connected: boolean = false;
    private _connecting: boolean = false;
    private _config: SerialConfig | null = null;
    private _rxBytes: number = 0;
    private _txBytes: number = 0;
    private _autoReconnect: boolean = false;
    private _reconnectTimer: any = null;
    private _userDisconnected: boolean = false;
    private _errorFrameCount: number = 0;
    private _lineBuffer: string = '';

    get connected(): boolean { return this._connected; }
    get connecting(): boolean { return this._connecting; }
    get config(): SerialConfig | null { return this._config; }
    get rxBytes(): number { return this._rxBytes; }
    get txBytes(): number { return this._txBytes; }
    get errorFrameCount(): number { return this._errorFrameCount; }
    get autoReconnect(): boolean { return this._autoReconnect; }

    setAutoReconnect(enabled: boolean): void {
        this._autoReconnect = enabled;
        if (!enabled && this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }

    resetErrorFrameCount(): void { this._errorFrameCount = 0; }

    private getWorkerPath(): string {
        const workerPath = path.join(__dirname, 'serialWorker.js');
        if (fs.existsSync(workerPath)) return workerPath;
        const distPath = path.join(__dirname, '..', 'serial', 'serialWorker.js');
        if (fs.existsSync(distPath)) return distPath;
        const extPath = vscode.extensions.getExtension('debugger.serial-mqtt-debugger-v2')?.extensionPath;
        if (extPath) {
            const p = path.join(extPath, 'dist', 'serial', 'serialWorker.js');
            if (fs.existsSync(p)) return p;
        }
        return workerPath;
    }

    private findNodePath(): string {
        try {
            if (process.platform === 'win32') {
                const result = execSync('where node', { encoding: 'utf-8', timeout: 3000 }).trim();
                const lines = result.split('\n');
                for (const line of lines) {
                    const p = line.trim();
                    if (p && !p.toLowerCase().includes('electron') && !p.toLowerCase().includes('vscode')) {
                        return p;
                    }
                }
                return lines[0]?.trim() || 'node';
            } else {
                return execSync('which node', { encoding: 'utf-8', timeout: 3000 }).trim();
            }
        } catch {
            return 'node';
        }
    }

    private resetState(): void {
        this._connected = false;
        this._connecting = false;
    }

    private ensureWorker(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.worker && this.workerReady) {
                resolve();
                return;
            }

            this.killWorker();

            const workerPath = this.getWorkerPath();
            const nodePath = this.findNodePath();
            logger.info(`启动串口工作进程: ${nodePath} ${workerPath}`);

            try {
                this.worker = spawn(nodePath, [workerPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env },
                    windowsHide: true
                });
            } catch (err) {
                reject(err);
                return;
            }

            this.workerReady = false;
            this._lineBuffer = '';

            this.worker.stdout?.setEncoding('utf-8');
            this.worker.stdout?.on('data', (chunk: string) => {
                this._lineBuffer += chunk;
                let idx;
                while ((idx = this._lineBuffer.indexOf('\n')) >= 0) {
                    const line = this._lineBuffer.slice(0, idx).trim();
                    this._lineBuffer = this._lineBuffer.slice(idx + 1);
                    if (!line) continue;
                    try {
                        const msg = JSON.parse(line);
                        this.handleWorkerMessage(msg);
                        if (msg.type === 'ready') {
                            this.workerReady = true;
                            resolve();
                        }
                    } catch {}
                }
            });

            this.worker.stderr?.on('data', (data: Buffer) => {
                logger.warn(`串口工作进程 stderr: ${data.toString()}`);
            });

            this.worker.on('exit', (code) => {
                logger.info(`串口工作进程退出 (code: ${code})`);
                const wasConnected = this._connected;
                this.worker = null;
                this.workerReady = false;
                this.resetState();

                if (wasConnected) {
                    this.emit('disconnect');
                    if (this._autoReconnect && !this._userDisconnected && this._config) {
                        this.scheduleReconnect();
                    }
                }
            });

            this.worker.on('error', (err) => {
                logger.error('串口工作进程启动失败', err);
                this.worker = null;
                this.workerReady = false;
                this.resetState();
                reject(err);
            });

            setTimeout(() => {
                if (!this.workerReady) {
                    this.killWorker();
                    reject(new Error('串口工作进程启动超时'));
                }
            }, 5000);
        });
    }

    private killWorker(): void {
        if (this.worker) {
            try { this.worker.kill(); } catch {}
            this.worker = null;
            this.workerReady = false;
        }
        this._lineBuffer = '';
    }

    private handleWorkerMessage(msg: any): void {
        switch (msg.type) {
            case 'ready':
                break;
            case 'connected':
                this._connected = true;
                this._connecting = false;
                this._rxBytes = 0;
                this._txBytes = 0;
                this._errorFrameCount = 0;
                logger.info(`串口 ${msg.port} 已连接`);
                this.emit('connect');
                break;
            case 'disconnected':
                this._connected = false;
                this._connecting = false;
                logger.info('串口已断开');
                this.emit('disconnect');
                break;
            case 'data': {
                const buf = Buffer.from(msg.data, 'base64');
                this._rxBytes += buf.length;
                this.emit('data', buf);
                break;
            }
            case 'sent':
                this._txBytes += msg.bytes;
                this.emit('sent', Buffer.alloc(msg.bytes));
                break;
            case 'error':
                this._errorFrameCount++;
                logger.error('串口错误: ' + msg.message);
                this.emit('error', msg.message);
                break;
            case 'breakSent':
                logger.info(`Break 信号已发送 (${msg.duration}ms)`);
                this.emit('break', msg.duration);
                break;
        }
    }

    private sendToWorker(msg: any): void {
        if (this.worker && this.worker.stdin && !this.worker.stdin.destroyed) {
            try {
                this.worker.stdin.write(JSON.stringify(msg) + '\n');
            } catch (err) {
                logger.error('发送到工作进程失败', err as Error);
            }
        }
    }

    private scheduleReconnect(): void {
        logger.info('3秒后尝试自动重连...');
        this.emit('reconnecting');
        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null;
            if (!this._connected && !this._connecting && this._config) {
                logger.info(`正在重连 ${this._config.port}...`);
                const ok = await this.connect(this._config);
                if (!ok) {
                    this.emit('reconnectFailed');
                }
            }
        }, 3000);
    }

    async listPorts(): Promise<PortInfo[]> {
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
        // 如果正在连接中，先断开
        if (this._connecting) {
            this.sendToWorker({ type: 'close' });
            this.resetState();
            await new Promise(r => setTimeout(r, 300));
        }

        // 如果已连接，先断开
        if (this._connected) {
            await this.disconnect();
            await new Promise(r => setTimeout(r, 200));
        }

        this._config = config;
        this._userDisconnected = false;
        this._connecting = true;

        try {
            await this.ensureWorker();
        } catch (err) {
            logger.error('无法启动串口工作进程', err as Error);
            this._connecting = false;
            return false;
        }

        // 发送连接命令
        this.sendToWorker({
            type: 'open',
            config: {
                port: config.port,
                baudRate: config.baudRate,
                dataBits: config.dataBits,
                stopBits: config.stopBits,
                parity: config.parity,
                rtscts: config.rtscts,
                xon: config.xon,
                xoff: config.xoff,
                dtr: config.dtr,
                rts: config.rts
            }
        });

        // 等待连接结果
        return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
                this.removeListener('connect', onConnect);
                this.removeListener('error', onError);
                this.removeListener('disconnect', onDisconnect);
                if (this._connecting) {
                    this._connecting = false;
                    this.emit('error', `连接 ${config.port} 超时`);
                    resolve(false);
                }
            }, 10000);

            const cleanup = () => {
                clearTimeout(timeout);
                this.removeListener('connect', onConnect);
                this.removeListener('error', onError);
                this.removeListener('disconnect', onDisconnect);
            };

            const onConnect = () => {
                cleanup();
                resolve(true);
            };

            const onError = (errMsg: string) => {
                cleanup();
                this._connecting = false;
                resolve(false);
            };

            const onDisconnect = () => {
                cleanup();
                this._connecting = false;
                resolve(false);
            };

            this.once('connect', onConnect);
            this.once('error', onError);
            this.once('disconnect', onDisconnect);
        });
    }

    async disconnect(): Promise<void> {
        this._userDisconnected = true;
        this._connecting = false;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        return new Promise<void>((resolve) => {
            if (!this._connected && !this.worker) {
                resolve();
                return;
            }

            const onDone = () => {
                this._connected = false;
                resolve();
            };

            if (this.worker) {
                this.once('disconnect', onDone);
                this.sendToWorker({ type: 'close' });

                // 超时保护
                setTimeout(() => {
                    this.removeListener('disconnect', onDone);
                    this._connected = false;
                    this.killWorker();
                    resolve();
                }, 2000);
            } else {
                this._connected = false;
                resolve();
            }
        });
    }

    async send(data: Buffer): Promise<boolean> {
        if (!this._connected) {
            logger.error('串口未连接');
            return false;
        }
        this.sendToWorker({ type: 'send', data: data.toString('base64') });
        return true;
    }

    setDtr(value: boolean): void {
        this.sendToWorker({ type: 'set', options: { dtr: value } });
    }

    setRts(value: boolean): void {
        this.sendToWorker({ type: 'set', options: { rts: value } });
    }

    async sendBreak(duration: number = 100): Promise<void> {
        if (!this._connected) {
            logger.error('串口未连接，无法发送 Break 信号');
            return;
        }
        this.sendToWorker({ type: 'break', duration });
    }

    resetStats(): void { this._rxBytes = 0; this._txBytes = 0; }

    getStats(): { rxBytes: number; txBytes: number; errorFrameCount: number } {
        return { rxBytes: this._rxBytes, txBytes: this._txBytes, errorFrameCount: this._errorFrameCount };
    }

    dispose(): void {
        this._userDisconnected = true;
        this._connecting = false;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this.killWorker();
        this._connected = false;
        this.removeAllListeners();
    }
}
