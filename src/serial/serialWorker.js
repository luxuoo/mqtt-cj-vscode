// serialWorker.js - 子进程中运行，处理串口通信
// 通过 stdin/stdout JSON 消息与主进程通信

let SerialPort = null;
let port = null;
let config = null;
let useNative = false;
let connecting = false;

// 尝试加载 serialport 原生模块
try {
    SerialPort = require('serialport').SerialPort;
    useNative = true;
} catch (err) {
    process.stderr.write('serialport 原生模块加载失败: ' + err.message + '\n');
}

// ===== 通信 =====
const { spawn: spawnChild } = require('child_process');
let psProcess = null;
let psBuffer = '';

function send(msg) {
    try {
        process.stdout.write(JSON.stringify(msg) + '\n');
    } catch {}
}

// ===== PowerShell 后备方案 =====
function killPsProcess() {
    if (psProcess) {
        try { psProcess.kill(); } catch {}
        psProcess = null;
    }
}

function openWithPowerShell(cfg) {
    // 先清理旧进程
    killPsProcess();
    connecting = true;
    config = cfg;

    const parityMap = { 'none': 'None', 'odd': 'Odd', 'even': 'Even', 'mark': 'Mark', 'space': 'Space' };
    const stopBitsMap = { 1: 'One', 1.5: 'OnePointFive', 2: 'Two' };

    const psScript = `
$ErrorActionPreference = 'Stop'
$port = $null
try {
    $port = New-Object System.IO.Ports.SerialPort
    $port.PortName = '${cfg.port}'
    $port.BaudRate = ${cfg.baudRate}
    $port.DataBits = ${cfg.dataBits}
    $port.StopBits = [System.IO.Ports.StopBits]::${stopBitsMap[cfg.stopBits] || 'One'}
    $port.Parity = [System.IO.Ports.Parity]::${parityMap[cfg.parity] || 'None'}
    $port.DtrEnable = $${cfg.dtr ? 'true' : 'false'}
    $port.RtsEnable = $${cfg.rts ? 'true' : 'false'}
    $port.ReadTimeout = 200
    $port.WriteTimeout = 1000
    $port.Open()
    [Console]::Error.WriteLine('CONNECTED|${cfg.port}')
    while ($port.IsOpen) {
        try {
            $count = $port.BytesToRead
            if ($count -gt 0) {
                $buf = New-Object byte[] $count
                $port.Read($buf, 0, $count)
                $b64 = [Convert]::ToBase64String($buf)
                [Console]::Error.WriteLine('DATA|' + $b64)
            }
        } catch [System.TimeoutException] {
        } catch {
            if ($port.IsOpen) {
                [Console]::Error.WriteLine('ERROR|' + $_.Exception.Message)
            }
            break
        }
        Start-Sleep -Milliseconds 20
    }
} catch {
    [Console]::Error.WriteLine('ERROR|' + $_.Exception.Message)
} finally {
    if ($port -ne $null) {
        try { if ($port.IsOpen) { $port.Close() } } catch {}
        try { $port.Dispose() } catch {}
    }
    [Console]::Error.WriteLine('DISCONNECTED')
}
`;

    try {
        psProcess = spawnChild('powershell', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', psScript
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        psBuffer = '';
        let gotConnected = false;

        psProcess.stderr?.setEncoding('utf-8');
        psProcess.stderr?.on('data', (chunk) => {
            psBuffer += chunk;
            let idx;
            while ((idx = psBuffer.indexOf('\n')) >= 0) {
                const line = psBuffer.slice(0, idx).trim();
                psBuffer = psBuffer.slice(idx + 1);
                if (!line) continue;

                if (line.startsWith('CONNECTED|')) {
                    gotConnected = true;
                    connecting = false;
                    send({ type: 'connected', port: line.split('|')[1] });
                } else if (line.startsWith('DATA|')) {
                    send({ type: 'data', data: line.slice(5) });
                } else if (line.startsWith('ERROR|')) {
                    send({ type: 'error', message: line.slice(6) });
                } else if (line === 'DISCONNECTED') {
                    connecting = false;
                    psProcess = null;
                    send({ type: 'disconnected' });
                }
            }
        });

        psProcess.on('exit', (code) => {
            connecting = false;
            psProcess = null;
            // 只有在曾经连接过的情况下才发送 disconnected
            // 如果从未连接成功，说明是连接失败，error 已经发过了
            if (gotConnected) {
                send({ type: 'disconnected' });
            }
        });

        psProcess.on('error', (err) => {
            connecting = false;
            send({ type: 'error', message: 'PowerShell 启动失败: ' + err.message });
            psProcess = null;
        });

        // 连接超时
        setTimeout(() => {
            if (connecting && psProcess) {
                connecting = false;
                send({ type: 'error', message: `连接 ${cfg.port} 超时` });
                killPsProcess();
            }
        }, 8000);

    } catch (err) {
        connecting = false;
        send({ type: 'error', message: '创建 PowerShell 进程失败: ' + err.message });
        psProcess = null;
    }
}

function closePowerShell() {
    connecting = false;
    if (psProcess) {
        const p = psProcess;
        psProcess = null;
        try {
            // 让 PowerShell 优雅退出
            p.stdin.write('try { $port.Close(); $port.Dispose() } catch {}; exit\n');
        } catch {}
        setTimeout(() => {
            try { p.kill(); } catch {}
        }, 500);
    }
    send({ type: 'disconnected' });
}

function sendViaPowerShell(dataBase64) {
    if (!psProcess || connecting) {
        send({ type: 'error', message: '串口未连接' });
        return;
    }
    const buf = Buffer.from(dataBase64, 'base64');
    send({ type: 'sent', bytes: buf.length });
}

// ===== 原生模块方案 =====
function handleOpen(cfg) {
    // 先关闭已有连接
    if (psProcess) {
        closePowerShell();
    }
    if (port) {
        try { if (port.isOpen) port.close(); } catch {}
        port = null;
    }

    config = cfg;

    if (!useNative) {
        if (process.platform !== 'win32') {
            send({ type: 'error', message: 'serialport 原生模块不可用，且当前系统不支持 PowerShell 后备方案' });
            return;
        }
        openWithPowerShell(cfg);
        return;
    }

    // 原生模块
    connecting = true;
    try {
        port = new SerialPort({
            path: cfg.port,
            baudRate: cfg.baudRate,
            dataBits: cfg.dataBits,
            stopBits: cfg.stopBits,
            parity: cfg.parity,
            rtscts: cfg.rtscts || false,
            xon: cfg.xon || false,
            xoff: cfg.xoff || false,
            autoOpen: false
        });

        port.open((err) => {
            connecting = false;
            if (err) {
                send({ type: 'error', message: `打开 ${cfg.port} 失败: ${err.message}` });
                port = null;
                return;
            }

            if (cfg.dtr) port.set({ dtr: true });
            if (cfg.rts) port.set({ rts: true });

            port.on('data', (data) => {
                send({ type: 'data', data: data.toString('base64') });
            });
            port.on('error', (err) => {
                send({ type: 'error', message: err.message });
            });
            port.on('close', () => {
                send({ type: 'disconnected' });
                port = null;
            });

            send({ type: 'connected', port: cfg.port });
        });
    } catch (err) {
        connecting = false;
        send({ type: 'error', message: `创建串口失败: ${err.message}` });
        port = null;
    }
}

function handleClose() {
    connecting = false;

    if (psProcess) {
        closePowerShell();
        return;
    }

    if (port) {
        const p = port;
        port = null;
        try {
            if (p.isOpen) {
                p.close((err) => {
                    if (err) send({ type: 'error', message: `关闭失败: ${err.message}` });
                    send({ type: 'disconnected' });
                });
            } else {
                send({ type: 'disconnected' });
            }
        } catch {
            send({ type: 'disconnected' });
        }
    } else {
        send({ type: 'disconnected' });
    }
}

function handleSend(dataBase64) {
    if (connecting || (!psProcess && !port)) {
        send({ type: 'error', message: '串口未连接' });
        return;
    }

    if (!useNative) {
        sendViaPowerShell(dataBase64);
        return;
    }

    if (!port || !port.isOpen) {
        send({ type: 'error', message: '串口未连接' });
        return;
    }
    const buf = Buffer.from(dataBase64, 'base64');
    port.write(buf, (err) => {
        if (err) {
            send({ type: 'error', message: `发送失败: ${err.message}` });
            return;
        }
        port.drain((err2) => {
            if (err2) send({ type: 'error', message: `drain失败: ${err2.message}` });
            send({ type: 'sent', bytes: buf.length });
        });
    });
}

function handleSet(options) {
    if (port && port.isOpen) {
        try { port.set(options); } catch {}
    }
}

function handleBreak(duration) {
    if (!port || !port.isOpen) return;
    try {
        port.set({ brk: true });
        setTimeout(() => {
            if (port) { try { port.set({ brk: false }); } catch {} }
        }, duration || 100);
        send({ type: 'breakSent', duration: duration || 100 });
    } catch {}
}

// ===== 主进程通信 =====
let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
            const msg = JSON.parse(line);
            switch (msg.type) {
                case 'open': handleOpen(msg.config); break;
                case 'close': handleClose(); break;
                case 'send': handleSend(msg.data); break;
                case 'set': handleSet(msg.options); break;
                case 'break': handleBreak(msg.duration); break;
                case 'ping': send({ type: 'pong' }); break;
                case 'status':
                    send({
                        type: 'statusReport',
                        connected: !connecting && (!!psProcess || (port && port.isOpen)),
                        connecting: connecting,
                        port: config?.port || null
                    });
                    break;
            }
        } catch {}
    }
});

process.stdin.on('end', () => {
    killPsProcess();
    if (port) { try { if (port.isOpen) port.close(); } catch {} }
    process.exit(0);
});

send({ type: 'ready' });
