// @ts-nocheck
(function () {
    const vscode = acquireVsCodeApi();

    // ===== 工具函数 =====
    function post(msg) {
        vscode.postMessage(msg);
    }

    function $(id) {
        return document.getElementById(id);
    }

    function appendLog(container, html) {
        const div = document.createElement('div');
        div.className = 'log-line';
        div.innerHTML = html;
        container.appendChild(div);
        // 限制日志行数
        while (container.children.length > 5000) {
            container.removeChild(container.firstChild);
        }
        return div;
    }

    function scrollToBottom(el) {
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ===== 标签切换 =====
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });

    // ===== 串口模块 =====
    const serialLog = $('serialLog');
    const autoScroll = $('autoScroll');
    let serialState = 'disconnected'; // disconnected, connecting, connected

    function setSerialState(state) {
        serialState = state;
        const btn = $('serialConnect');
        switch (state) {
            case 'connecting':
                btn.textContent = '连接中...';
                btn.className = 'btn-primary';
                btn.disabled = true;
                break;
            case 'connected':
                btn.textContent = '断开';
                btn.className = 'btn-danger';
                btn.disabled = false;
                break;
            case 'disconnected':
            default:
                btn.textContent = '连接';
                btn.className = 'btn-primary';
                btn.disabled = false;
                break;
        }
    }

    // 刷新端口（保持当前选中）
    $('refreshPorts').addEventListener('click', () => {
        post({ type: 'serial.listPorts' });
    });

    // 连接/断开
    $('serialConnect').addEventListener('click', () => {
        if (serialState === 'connected') {
            setSerialState('disconnected');
            post({ type: 'serial.disconnect' });
        } else if (serialState === 'disconnected') {
            const port = $('serialPort').value;
            if (!port) return;
            setSerialState('connecting');
            const flow = $('flowControl').value;
            post({
                type: 'serial.connect',
                config: {
                    port: port,
                    baudRate: parseInt($('baudRate').value),
                    dataBits: parseInt($('dataBits').value),
                    stopBits: parseFloat($('stopBits').value),
                    parity: $('parity').value,
                    rtscts: flow === 'rtscts',
                    xon: flow === 'xonxoff',
                    xoff: flow === 'xonxoff',
                    dtr: $('dtrCtrl').checked,
                    rts: $('rtsCtrl').checked
                }
            });
        }
    });

    // DTR/RTS
    $('dtrCtrl').addEventListener('change', (e) => {
        post({ type: 'serial.setDtr', value: e.target.checked });
    });
    $('rtsCtrl').addEventListener('change', (e) => {
        post({ type: 'serial.setRts', value: e.target.checked });
    });

    // 自动重连
    $('autoReconnect').addEventListener('change', (e) => {
        post({ type: 'serial.setAutoReconnect', value: e.target.checked });
    });

    // Break 信号
    $('sendBreak').addEventListener('click', () => {
        post({ type: 'serial.setBreak', duration: 100 });
    });

    // 接收区搜索/过滤
    $('serialSearch').addEventListener('input', (e) => {
        const filter = e.target.value.toLowerCase();
        const lines = serialLog.querySelectorAll('.log-line');
        lines.forEach(line => {
            if (!filter || line.textContent.toLowerCase().includes(filter)) {
                line.style.display = '';
            } else {
                line.style.display = 'none';
            }
        });
    });

    // 发送
    $('serialSend').addEventListener('click', () => {
        const input = $('serialInput').value;
        if (!input) return;
        const mode = document.querySelector('input[name="sendMode"]:checked').value;
        const lineEnding = $('lineEnding').value;
        post({ type: 'serial.send', data: input, mode, lineEnding });
    });

    // Ctrl+Enter 发送
    $('serialInput').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            $('serialSend').click();
        }
    });

    // 清空/导出
    $('clearSerialLog').addEventListener('click', () => {
        serialLog.innerHTML = '';
        post({ type: 'serial.clearLog' });
    });
    $('exportSerialLog').addEventListener('click', () => {
        post({ type: 'serial.exportLog' });
    });

    // 快捷指令
    let quickCommands = [];
    $('addQuickCmd').addEventListener('click', () => {
        const input = $('quickCmdInput');
        const cmd = input.value.trim();
        if (cmd && !quickCommands.includes(cmd)) {
            quickCommands.push(cmd);
            renderQuickCommands();
            input.value = '';
        }
    });

    $('quickCmdInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            $('addQuickCmd').click();
        }
    });

    function renderQuickCommands() {
        const list = $('quickCmdList');
        list.innerHTML = '';
        quickCommands.forEach((cmd, i) => {
            const btn = document.createElement('button');
            btn.className = 'quick-cmd';
            btn.innerHTML = escapeHtml(cmd) + '<span class="remove">×</span>';
            btn.querySelector('.remove').addEventListener('click', (e) => {
                e.stopPropagation();
                quickCommands.splice(i, 1);
                renderQuickCommands();
            });
            btn.addEventListener('click', () => {
                $('serialInput').value = cmd;
                $('serialSend').click();
            });
            list.appendChild(btn);
        });
    }

    // ===== MQTT 模块 =====
    const mqttLog = $('mqttLog');
    const mqttAutoScroll = $('mqttAutoScroll');
    const subscriptions = new Map();
    let mqttPayloadFormat = 'text';
    let mqttMsgCount = 0;
    let mqttConnected = false;

    function setMqttConnected(connected) {
        mqttConnected = connected;
        const btn = $('mqttConnect');
        if (connected) {
            btn.textContent = '断开';
            btn.className = 'btn-danger';
            btn.disabled = false;
        } else {
            btn.textContent = '连接';
            btn.className = 'btn-primary';
            btn.disabled = false;
            subscriptions.clear();
            renderSubTags();
            mqttMsgCount = 0;
            $('mqttMsgCount').textContent = '(0 条)';
        }
    }

    // 连接/断开
    $('mqttConnect').addEventListener('click', () => {
        if (!mqttConnected) {
            const willTopic = $('willTopic').value;
            post({
                type: 'mqtt.connect',
                config: {
                    protocol: $('mqttProtocol').value,
                    broker: $('mqttBroker').value,
                    port: parseInt($('mqttPort').value),
                    clientId: $('mqttClientId').value,
                    username: $('mqttUsername').value || undefined,
                    password: $('mqttPassword').value || undefined,
                    cleanSession: $('mqttCleanSession').checked,
                    keepAlive: parseInt($('mqttKeepAlive').value),
                    reconnect: $('mqttReconnect').checked,
                    reconnectInterval: 5000,
                    willTopic: willTopic || undefined,
                    willPayload: $('willPayload').value || undefined,
                    willQos: parseInt($('willQos').value),
                    willRetain: $('willRetain').checked
                }
            });
        } else {
            post({ type: 'mqtt.disconnect' });
        }
    });

    // 订阅
    $('mqttSubscribe').addEventListener('click', () => {
        const topic = $('subTopic').value.trim();
        if (!topic) return;
        const qos = parseInt($('subQos').value);
        post({ type: 'mqtt.subscribe', topic, qos });
        $('subTopic').value = '';
    });

    $('subTopic').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('mqttSubscribe').click();
    });

    // 发布
    $('mqttPublish').addEventListener('click', () => {
        const topic = $('pubTopic').value.trim();
        const payload = $('pubPayload').value;
        if (!topic) return;
        const qos = parseInt($('pubQos').value);
        const retain = $('pubRetain').checked;
        post({ type: 'mqtt.publish', topic, payload, qos, retain });
    });

    $('pubPayload').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            $('mqttPublish').click();
        }
    });

    // 过滤
    $('mqttFilter').addEventListener('input', (e) => {
        filterMqttMessages(e.target.value);
    });

    function filterMqttMessages(filter) {
        const lines = mqttLog.querySelectorAll('.msg-line');
        const lowerFilter = filter.toLowerCase();
        lines.forEach(line => {
            if (!lowerFilter || line.textContent.toLowerCase().includes(lowerFilter)) {
                line.style.display = '';
            } else {
                line.style.display = 'none';
            }
        });
    }

    // 格式切换
    $('mqttPayloadFormat').addEventListener('change', (e) => {
        mqttPayloadFormat = e.target.value;
    });

    // 清空/导出
    $('clearMqttMessages').addEventListener('click', () => {
        mqttLog.innerHTML = '';
        post({ type: 'mqtt.clearMessages' });
    });
    $('exportMqttMessages').addEventListener('click', () => {
        post({ type: 'mqtt.exportMessages' });
    });

    function renderSubTags() {
        const container = $('subTags');
        container.innerHTML = '';
        subscriptions.forEach((qos, topic) => {
            const tag = document.createElement('span');
            tag.className = 'sub-tag';
            tag.innerHTML = `${escapeHtml(topic)} QoS${qos} <span class="remove">×</span>`;
            tag.querySelector('.remove').addEventListener('click', () => {
                post({ type: 'mqtt.unsubscribe', topic });
            });
            container.appendChild(tag);
        });
    }

    function formatPayload(payload) {
        switch (mqttPayloadFormat) {
            case 'hex':
                return Array.from(new TextEncoder().encode(payload))
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ');
            case 'json':
                try {
                    return JSON.stringify(JSON.parse(payload), null, 2);
                } catch {
                    return payload;
                }
            default:
                return payload;
        }
    }

    // ===== 桥接模块 =====
    const bridgeLog = $('bridgeLog');

    $('bridgeStart').addEventListener('click', () => {
        post({
            type: 'bridge.start',
            config: {
                serialToMqtt: $('bridgeS2M').checked,
                mqttToSerial: $('bridgeM2S').checked,
                serialToMqttTopic: $('bridgeS2MTopic').value,
                mqttToSerialTopic: $('bridgeM2STopic').value,
                transform: $('bridgeTransform').value
            }
        });
    });

    $('bridgeStop').addEventListener('click', () => {
        post({ type: 'bridge.stop' });
    });

    $('clearBridgeLog').addEventListener('click', () => {
        bridgeLog.innerHTML = '';
    });

    // ===== 配置方案 =====
    $('saveProfile').addEventListener('click', () => {
        const name = $('profileNameInput').value.trim();
        if (!name) return;
        const flow = $('flowControl').value;
        post({
            type: 'profile.save', name,
            data: {
                serial: {
                    port: $('serialPort').value, baudRate: parseInt($('baudRate').value),
                    dataBits: parseInt($('dataBits').value), stopBits: parseFloat($('stopBits').value),
                    parity: $('parity').value, rtscts: flow === 'rtscts',
                    xon: flow === 'xonxoff', xoff: flow === 'xonxoff',
                    dtr: $('dtrCtrl').checked, rts: $('rtsCtrl').checked
                },
                mqtt: {
                    protocol: $('mqttProtocol').value, broker: $('mqttBroker').value,
                    port: parseInt($('mqttPort').value), clientId: $('mqttClientId').value,
                    username: $('mqttUsername').value || undefined, password: $('mqttPassword').value || undefined,
                    cleanSession: $('mqttCleanSession').checked, keepAlive: parseInt($('mqttKeepAlive').value),
                    reconnect: $('mqttReconnect').checked, reconnectInterval: 5000,
                    willTopic: $('willTopic').value || undefined, willPayload: $('willPayload').value || undefined,
                    willQos: parseInt($('willQos').value), willRetain: $('willRetain').checked
                },
                bridge: {
                    serialToMqtt: $('bridgeS2M').checked, mqttToSerial: $('bridgeM2S').checked,
                    serialToMqttTopic: $('bridgeS2MTopic').value, mqttToSerialTopic: $('bridgeM2STopic').value,
                    transform: $('bridgeTransform').value
                }
            }
        });
        $('profileNameInput').value = '';
    });

    $('profileNameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('saveProfile').click();
    });

    $('loadProfile').addEventListener('click', () => {
        const name = $('profileSelect').value;
        if (name) {
            post({ type: 'profile.load', name });
        }
    });

    $('deleteProfile').addEventListener('click', () => {
        const name = $('profileSelect').value;
        if (name) {
            post({ type: 'profile.delete', name });
        }
    });

    function renderProfileList(profiles) {
        const select = $('profileSelect');
        select.innerHTML = '<option value="">-- 配置方案 --</option>';
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name} (${p.createdAt || ''})`;
            select.appendChild(opt);
        });
    }

    function applyProfile(profile) {
        // 串口配置
        if (profile.serial) {
            const s = profile.serial;
            $('baudRate').value = s.baudRate;
            $('dataBits').value = s.dataBits;
            $('stopBits').value = s.stopBits;
            $('parity').value = s.parity;
            $('dtrCtrl').checked = s.dtr;
            $('rtsCtrl').checked = s.rts;
            if (s.rtscts) $('flowControl').value = 'rtscts';
            else if (s.xon) $('flowControl').value = 'xonxoff';
            else $('flowControl').value = 'none';
        }
        // MQTT 配置
        if (profile.mqtt) {
            const m = profile.mqtt;
            $('mqttProtocol').value = m.protocol;
            $('mqttBroker').value = m.broker;
            $('mqttPort').value = m.port;
            $('mqttClientId').value = m.clientId || '';
            $('mqttUsername').value = m.username || '';
            $('mqttPassword').value = m.password || '';
            $('mqttCleanSession').checked = m.cleanSession;
            $('mqttKeepAlive').value = m.keepAlive;
            $('mqttReconnect').checked = m.reconnect;
            $('willTopic').value = m.willTopic || '';
            $('willPayload').value = m.willPayload || '';
            $('willQos').value = m.willQos;
            $('willRetain').checked = m.willRetain;
        }
        // 桥接配置
        if (profile.bridge) {
            const b = profile.bridge;
            $('bridgeS2M').checked = b.serialToMqtt;
            $('bridgeM2S').checked = b.mqttToSerial;
            $('bridgeS2MTopic').value = b.serialToMqttTopic;
            $('bridgeM2STopic').value = b.mqttToSerialTopic;
            $('bridgeTransform').value = b.transform;
        }
    }

    // ===== 消息处理 =====
    window.addEventListener('message', (event) => {
        const msg = event.data;

        switch (msg.type) {
            // 串口
            case 'serial.ports': {
                const select = $('serialPort');
                const prevPort = select.value;
                select.innerHTML = '';
                if (msg.ports.length === 0) {
                    select.innerHTML = '<option value="">未发现串口</option>';
                } else {
                    let found = false;
                    msg.ports.forEach(p => {
                        const opt = document.createElement('option');
                        opt.value = p.path;
                        const label = p.manufacturer
                            ? `${p.path} - ${p.manufacturer}`
                            : p.path;
                        opt.textContent = label;
                        if (p.path === prevPort) {
                            opt.selected = true;
                            found = true;
                        }
                        select.appendChild(opt);
                    });
                    // 如果之前选中的端口不在新列表中，保持选择不变（但可能已断开）
                    if (!found && prevPort) {
                        // 之前选中的端口消失了，不用管
                    }
                }
                break;
            }

            case 'serial.connected': {
                setSerialState('connected');
                $('serialStatus').textContent = '串口: ' + msg.port;
                $('serialStatus').className = 'status connected';
                appendLog(serialLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="dir-rx">✓ 已连接 ${escapeHtml(msg.port)}</span>`);
                break;
            }

            case 'serial.disconnected': {
                setSerialState('disconnected');
                $('serialStatus').textContent = '串口: 未连接';
                $('serialStatus').className = 'status disconnected';
                appendLog(serialLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="error">✗ 已断开</span>`);
                break;
            }

            case 'serial.error': {
                // 连接失败时恢复按钮状态
                if (serialState === 'connecting') {
                    setSerialState('disconnected');
                }
                appendLog(serialLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="error">✗ ${escapeHtml(msg.message)}</span>`);
                break;
            }

            case 'serial.data': {
                const dirClass = msg.direction === 'RX' ? 'dir-rx' : 'dir-tx';
                const mode = $('serialDisplayMode').value;
                const content = mode === 'hex' ? msg.hex : escapeHtml(msg.ascii);
                appendLog(serialLog,
                    `<span class="timestamp">${msg.timestamp}</span> <span class="${dirClass}">${msg.direction}:</span> <span class="hex">${content}</span>`
                );
                if (autoScroll.checked) {
                    scrollToBottom(serialLog);
                }
                break;
            }

            case 'serial.stats': {
                $('serialStats').textContent = `RX: ${formatBytes(msg.rxBytes)} | TX: ${formatBytes(msg.txBytes)} | ERR: ${msg.errorFrames || 0}`;
                break;
            }

            case 'serial.reconnecting': {
                appendLog(serialLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="dir-rx">⟳ 正在尝试自动重连...</span>`);
                break;
            }

            case 'serial.reconnectFailed': {
                appendLog(serialLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="error">✗ 自动重连失败</span>`);
                break;
            }

            case 'serial.breakSent': {
                appendLog(serialLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="dir-tx">⚡ Break 信号已发送 (${msg.duration}ms)</span>`);
                break;
            }

            case 'serial.logCleared':
                serialLog.innerHTML = '';
                break;

            // MQTT
            case 'mqtt.connected': {
                setMqttConnected(true);
                $('mqttStatus').textContent = 'MQTT: 已连接';
                $('mqttStatus').className = 'status connected';
                break;
            }

            case 'mqtt.disconnected': {
                setMqttConnected(false);
                $('mqttStatus').textContent = 'MQTT: 未连接';
                $('mqttStatus').className = 'status disconnected';
                break;
            }

            case 'mqtt.message': {
                const m = msg.message;
                const payload = formatPayload(m.payload);
                const payloadClass = mqttPayloadFormat === 'json' ? 'json' : '';
                appendLog(mqttLog,
                    `<span class="msg-time">[${m.timestamp}]</span> <span class="msg-topic">${escapeHtml(m.topic)}</span> <span class="msg-qos">QoS${m.qos}</span> <span class="msg-payload ${payloadClass}">${escapeHtml(payload)}</span>`
                );
                mqttMsgCount++;
                $('mqttMsgCount').textContent = `(${mqttMsgCount} 条)`;
                const filter = $('mqttFilter').value;
                if (filter) {
                    filterMqttMessages(filter);
                }
                if (mqttAutoScroll.checked) {
                    scrollToBottom(mqttLog);
                }
                break;
            }

            case 'mqtt.subscribed': {
                subscriptions.set(msg.subscription.topic, msg.subscription.qos);
                renderSubTags();
                break;
            }

            case 'mqtt.unsubscribed': {
                subscriptions.delete(msg.topic);
                renderSubTags();
                break;
            }

            case 'mqtt.messagesCleared':
                mqttLog.innerHTML = '';
                mqttMsgCount = 0;
                $('mqttMsgCount').textContent = '(0 条)';
                break;

            case 'mqtt.error': {
                appendLog(mqttLog, `<span class="msg-time">[${new Date().toLocaleTimeString()}]</span> <span class="error">✗ ${escapeHtml(msg.message)}</span>`);
                break;
            }

            // 桥接
            case 'bridge.started': {
                $('bridgeStart').disabled = true;
                $('bridgeStop').disabled = false;
                $('bridgeStatus').textContent = '活跃';
                $('bridgeStatus').className = 'status-value active';
                $('bridgeStatusText').textContent = '桥接: 活跃';
                $('bridgeStatusText').className = 'status connected';
                appendLog(bridgeLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="dir-rx">✓ 桥接已启动</span>`);
                break;
            }

            case 'bridge.stopped': {
                $('bridgeStart').disabled = false;
                $('bridgeStop').disabled = true;
                $('bridgeStatus').textContent = '未启动';
                $('bridgeStatus').className = 'status-value inactive';
                $('bridgeStatusText').textContent = '桥接: 未启动';
                $('bridgeStatusText').className = 'status disconnected';
                appendLog(bridgeLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="error">✗ 桥接已停止</span>`);
                break;
            }

            case 'bridge.forward': {
                const arrow = msg.direction === 'serial-to-mqtt' ? '→' : '←';
                appendLog(bridgeLog,
                    `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> ${arrow} ${escapeHtml(msg.data)}`
                );
                $('bridgeCount').textContent = msg.count;
                scrollToBottom(bridgeLog);
                break;
            }

            case 'bridge.error': {
                appendLog(bridgeLog, `<span class="timestamp">[${new Date().toLocaleTimeString()}]</span> <span class="error">✗ ${escapeHtml(msg.message)}</span>`);
                break;
            }

            // 配置方案
            case 'profile.list':
                renderProfileList(msg.profiles);
                break;

            case 'profile.loaded':
                applyProfile(msg.profile);
                break;

            // 上次使用的配置
            case 'config.lastConfig': {
                const cfg = msg.config;
                if (cfg.serial) {
                    $('baudRate').value = cfg.serial.baudRate;
                    $('dataBits').value = cfg.serial.dataBits;
                    $('stopBits').value = cfg.serial.stopBits;
                    $('parity').value = cfg.serial.parity;
                    $('dtrCtrl').checked = cfg.serial.dtr;
                    $('rtsCtrl').checked = cfg.serial.rts;
                    if (cfg.serial.rtscts) $('flowControl').value = 'rtscts';
                    else if (cfg.serial.xon) $('flowControl').value = 'xonxoff';
                    else $('flowControl').value = 'none';
                }
                if (cfg.mqtt) {
                    $('mqttProtocol').value = cfg.mqtt.protocol;
                    $('mqttBroker').value = cfg.mqtt.broker;
                    $('mqttPort').value = cfg.mqtt.port;
                    $('mqttClientId').value = cfg.mqtt.clientId || '';
                    $('mqttUsername').value = cfg.mqtt.username || '';
                    $('mqttPassword').value = cfg.mqtt.password || '';
                    $('mqttCleanSession').checked = cfg.mqtt.cleanSession;
                    $('mqttKeepAlive').value = cfg.mqtt.keepAlive;
                    $('mqttReconnect').checked = cfg.mqtt.reconnect;
                    $('willTopic').value = cfg.mqtt.willTopic || '';
                    $('willPayload').value = cfg.mqtt.willPayload || '';
                    $('willQos').value = cfg.mqtt.willQos;
                    $('willRetain').checked = cfg.mqtt.willRetain;
                }
                if (cfg.bridge) {
                    $('bridgeS2M').checked = cfg.bridge.serialToMqtt;
                    $('bridgeM2S').checked = cfg.bridge.mqttToSerial;
                    $('bridgeS2MTopic').value = cfg.bridge.serialToMqttTopic;
                    $('bridgeM2STopic').value = cfg.bridge.mqttToSerialTopic;
                    $('bridgeTransform').value = cfg.bridge.transform;
                }
                break;
            }
        }
    });

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ===== 初始化 =====
    post({ type: 'serial.listPorts' });
    post({ type: 'profile.list' });
    // 请求当前状态（同步侧边栏等其他视图的状态）
    setTimeout(() => post({ type: 'getState' }), 100);
})();
