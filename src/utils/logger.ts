import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

class Logger {
    private outputChannel: vscode.OutputChannel;
    private level: LogLevel = LogLevel.DEBUG;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('串口MQTT调试器');
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    private log(level: LogLevel, prefix: string, message: string): void {
        if (level < this.level) return;
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        this.outputChannel.appendLine(`[${time}] [${prefix}] ${message}`);
    }

    debug(message: string): void {
        this.log(LogLevel.DEBUG, 'DEBUG', message);
    }

    info(message: string): void {
        this.log(LogLevel.INFO, 'INFO', message);
    }

    warn(message: string): void {
        this.log(LogLevel.WARN, 'WARN', message);
    }

    error(message: string, err?: Error): void {
        let msg = message;
        if (err) {
            msg += `: ${err.message}`;
        }
        this.log(LogLevel.ERROR, 'ERROR', msg);
    }

    show(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

export const logger = new Logger();
