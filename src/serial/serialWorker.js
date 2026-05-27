// serialWorker.js - 子进程中运行，处理串口通信
// 通过 stdin/stdout JSON 消息与主进程通信

let SerialPort = null;
let port = null;
let config = null;
let useNative = false;

// 尝试加载 serialport 原生模块
try {
    SerialPort = require('serialport').SerialPort;
    useNative = true;
} catch (err) {
    // 原生模块不可用，将使用 PowerShell 后备方案
    process.stderr.write('serialport 原生模块加载失败: ' + err.message + '\n');
}

// ===== PowerShell 后备方案 =====
const { spawn: spawnChild } = require('child_process');
let psProcess = null;
let psBuffer = '';

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

function openWithPowerShell(cfg) {
    if (psProcess) {
        try { psProcess.kill(); } catch {}
    }
    config = cfg;

    // PowerShell 脚本：打开串口并持续读取
    const parityMap = { 'none': 'None', 'odd': 'Odd', 'even': 'Even', 'mark': 'Mark', 'space': 'Space' };
    const stopBitsMap = { 1: 'One', 1.5: 'OnePointFive', 2: 'Two' };

    const psScript = `
$ErrorActionPreference = 'Stop'
try {
    $port = New-Object System.IO.Ports.SerialPort
    $port.PortName = '${cfg.port}'
    $port.BaudRate = ${cfg.baudRate}
    $port.DataBits = ${cfg.dataBits}
    $port.StopBits = [System.IO.Ports.StopBits]::${stopBitsMap[cfg.stopBits] || 'One'}
    $port.Parity = [System.IO.Ports.Parity]::${parityMap[cfg.parity] || 'None'}
    $port.DtrEnable = $${cfg.dtr ? 'true' : 'false'}
    $port.RtsEnable = $${cfg.rts ? 'true' : 'false'}
    $port.ReadTimeout = 500
    $port.Open()
    [Console]::Error.WriteLine('CONNECTED|${cfg.port}')
    while ($port.IsOpen) {
        try {
            $bytes = @()
            $count = $port.BytesToRead
            if ($count -gt 0) {
                $buf = New-Object byte[] $count
                $port.Read($buf, 0, $count)
                $b64 = [Convert]::ToBase64String($buf)
                [Console]::Error.WriteLine('DATA|' + $b64)
            }
        } catch [System.TimeoutException] {
            # 超时正常，继续循环
        } catch {
            if ($port.IsOpen) {
                [Console]::Error.WriteLine('ERROR|' + $_.Exception.Message)
            }
            break
        }
        Start-Sleep -Milliseconds 10
    }
    if ($port.IsOpen) { $port.Close() }
    [Console]::Error.WriteLine('DISCONNECTED')
} catch {
    [Console]::Error.WriteLine('ERROR|' + $_.Exception.Message)
    [Console]::Error.WriteLine('DISCONNECTED')
}
`;

    try {
        psProcess = spawnChild('powershell', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-Command', psScript
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        psBuffer = '';

        psProcess.stderr?.setEncoding('utf-8');
        psProcess.stderr?.on('data', (chunk) => {
            psBuffer += chunk;
            let idx;
            while ((idx = psBuffer.indexOf('\n')) >= 0) {
                const line = psBuffer.slice(0, idx).trim();
                psBuffer = psBuffer.slice(idx + 1);
                if (!line) continue;

                if (line.startsWith('CONNECTED|')) {
                    const portName = line.split('|')[1];
                    send({ type: 'connected', port: portName });
                } else if (line.startsWith('DATA|')) {
                    const b64 = line.slice(5);
                    send({ type: 'data', data: b64 });
                } else if (line.startsWith('ERROR|')) {
                    send({ type: 'error', message: line.slice(6) });
                } else if (line === 'DISCONNECTED') {
                    send({ type: 'disconnected' });
                    psProcess = null;
                }
            }
        });

        psProcess.on('exit', () => {
            psProcess = null;
            send({ type: 'disconnected' });
        });

        psProcess.on('error', (err) => {
            send({ type: 'error', message: 'PowerShell 启动失败: ' + err.message });
            psProcess = null;
        });
    } catch (err) {
        send({ type: 'error', message: '创建 PowerShell 进程失败: ' + err.message });
        psProcess = null;
    }
}

function closePowerShell() {
    if (psProcess) {
        try {
            psProcess.stdin.write('[Console]::Error.WriteLine("DISCONNECTED"); exit\n');
            setTimeout(() => {
                if (psProcess) {
                    try { psProcess.kill(); } catch {}
                    psProcess = null;
                }
            }, 1000);
        } catch {
            try { psProcess.kill(); } catch {}
            psProcess = null;
        }
    }
    send({ type: 'disconnected' });
}

function sendViaPowerShell(dataBase64) {
    if (!psProcess || !psProcess.stdin) {
        send({ type: 'error', message: '串口未连接' });
        return;
    }
    try {
        const script = `
$bytes = [Convert]::FromBase64String('${dataBase64}')
$port.Write($bytes, 0, $bytes.Length)
[Console]::Error.WriteLine('SENT|' + $bytes.Length)
`;
        psProcess.stdin.write(script + '\n');
        // 直接发送成功
        const buf = Buffer.from(dataBase64, 'base64');
        send({ type: 'sent', bytes: buf.length });
    } catch (err) {
        send({ type: 'error', message: '发送失败: ' + err.message });
    }
}

function handleOpen(cfg) {
    if (port) {
        try { port.close(); } catch {}
    }
    config = cfg;

    if (!useNative) {
        // 使用 PowerShell 后备方案
        if (process.platform !== 'win32') {
            send({ type: 'error', message: 'serialport 原生模块不可用，且当前系统不支持 PowerShell 后备方案' });
            return;
        }
        openWithPowerShell(cfg);
        return;
    }

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
        send({ type: 'error', message: `创建串口失败: ${err.message}` });
        port = null;
    }
}

function handleClose() {
    if (!useNative && psProcess) {
        closePowerShell();
        return;
    }

    if (port) {
        try {
            if (port.isOpen) {
                port.close((err) => {
                    if (err) send({ type: 'error', message: `关闭失败: ${err.message}` });
                    else send({ type: 'disconnected' });
                    port = null;
                });
            } else {
                port = null;
                send({ type: 'disconnected' });
            }
        } catch (err) {
            port = null;
            send({ type: 'disconnected' });
        }
    } else {
        send({ type: 'disconnected' });
    }
}

function handleSend(dataBase64) {
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
    if (!useNative) return; // PowerShell 模式下不支持动态设置

    if (port && port.isOpen) {
        try {
            port.set(options);
        } catch {}
    }
}

function handleBreak(duration) {
    if (!useNative) return; // PowerShell 模式下不支持 Break

    if (!port || !port.isOpen) return;
    try {
        port.set({ brk: true });
        setTimeout(() => {
            if (port) {
                try { port.set({ brk: false }); } catch {}
            }
        }, duration || 100);
        send({ type: 'breakSent', duration: duration || 100 });
    } catch {}
}

// 主进程通信
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
            }
        } catch {}
    }
});

process.stdin.on('end', () => {
    if (port) {
        try { port.close(); } catch {}
    }
    process.exit(0);
});

// 通知主进程 worker 已就绪
send({ type: 'ready' });
