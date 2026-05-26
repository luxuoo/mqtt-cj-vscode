// @ts-nocheck
(function () {
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    const post = (msg) => vscode.postMessage(msg);

    // ===== 折叠切换 =====
    document.querySelectorAll('.section-title').forEach(title => {
        title.addEventListener('click', () => {
            const key = title.dataset.toggle;
            const body = document.getElementById(key + 'Body');
            if (!body) return;
            const collapsed = body.classList.toggle('collapsed');
            title.classList.toggle('open', !collapsed);
        });
    });

    // ===== 串口 =====
    $('refreshPorts').addEventListener('click', () => post({ type: 'serial.listPorts' }));

    $('serialConnect').addEventListener('click', () => {
        const btn = $('serialConnect');
        if (btn.textContent === '连接') {
            const flow = $('sFlow').value;
            post({
                type: 'serial.connect',
                config: {
                    port: $('sPort').value,
                    baudRate: parseInt($('sBaud').value),
                    dataBits: parseInt($('sDataBits').value),
                    stopBits: parseFloat($('sStopBits').value),
                    parity: $('sParity').value,
                    rtscts: flow === 'rtscts',
                    xon: flow === 'xonxoff',
                    xoff: flow === 'xonxoff',
                    dtr: $('sDtr').checked,
                    rts: $('sRts').checked
                }
            });
        } else {
            post({ type: 'serial.disconnect' });
        }
    });

    $('sDtr').addEventListener('change', (e) => post({ type: 'serial.setDtr', value: e.target.checked }));
    $('sRts').addEventListener('change', (e) => post({ type: 'serial.setRts', value: e.target.checked }));

    $('serialSend').addEventListener('click', () => {
        const data = $('sInput').value;
        if (!data) return;
        const mode = document.querySelector('input[name="sMode"]:checked').value;
        post({ type: 'serial.send', data, mode, lineEnding: $('sLineEnding').value });
    });

    $('sInput').addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') $('serialSend').click();
    });

    // ===== MQTT =====
    $('mqttConnect').addEventListener('click', () => {
        const btn = $('mqttConnect');
        if (btn.textContent === '连接') {
            post({
                type: 'mqtt.connect',
                config: {
                    protocol: $('mProtocol').value,
                    broker: $('mBroker').value,
                    port: parseInt($('mPort').value),
                    clientId: $('mClientId').value,
                    username: $('mUsername').value || undefined,
                    password: $('mPassword').value || undefined,
                    cleanSession: $('mClean').checked,
                    keepAlive: parseInt($('mKeepAlive').value),
                    reconnect: $('mReconnect').checked,
                    reconnectInterval: 5000,
                    willTopic: $('wTopic').value || undefined,
                    willPayload: $('wPayload').value || undefined,
                    willQos: parseInt($('wQos').value),
                    willRetain: $('wRetain').checked
                }
            });
        } else {
            post({ type: 'mqtt.disconnect' });
        }
    });

    $('mqttSub').addEventListener('click', () => {
        const topic = $('subTopic').value.trim();
        if (!topic) return;
        post({ type: 'mqtt.subscribe', topic, qos: parseInt($('subQos').value) });
        $('subTopic').value = '';
    });
    $('subTopic').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mqttSub').click(); });

    $('mqttPub').addEventListener('click', () => {
        const topic = $('pubTopic').value.trim();
        if (!topic) return;
        post({ type: 'mqtt.publish', topic, payload: $('pubPayload').value, qos: parseInt($('pubQos').value), retain: $('pubRetain').checked });
    });
    $('pubPayload').addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter') $('mqttPub').click(); });

    const subs = new Map();
    function renderSubTags() {
        const c = $('subTags');
        c.innerHTML = '';
        subs.forEach((qos, topic) => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.innerHTML = esc(topic) + ' Q' + qos + ' <span class="rm">×</span>';
            tag.querySelector('.rm').addEventListener('click', () => post({ type: 'mqtt.unsubscribe', topic }));
            c.appendChild(tag);
        });
    }

    // ===== 桥接 =====
    $('bridgeStart').addEventListener('click', () => {
        post({
            type: 'bridge.start',
            config: {
                serialToMqtt: $('bS2M').checked,
                mqttToSerial: $('bM2S').checked,
                serialToMqttTopic: $('bS2MTopic').value,
                mqttToSerialTopic: $('bM2STopic').value,
                transform: $('bTransform').value
            }
        });
    });
    $('bridgeStop').addEventListener('click', () => post({ type: 'bridge.stop' }));

    // ===== 配置方案 =====
    $('profileSave').addEventListener('click', () => {
        const name = $('profileName').value.trim();
        if (!name) return;
        post({ type: 'profile.save', name });
        $('profileName').value = '';
    });
    $('profileName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('profileSave').click(); });

    function renderProfiles(profiles) {
        const list = $('profileList');
        list.innerHTML = '';
        if (!profiles.length) {
            list.innerHTML = '<div style="opacity:0.5;font-size:11px;padding:4px">暂无方案</div>';
            return;
        }
        profiles.forEach(p => {
            const div = document.createElement('div');
            div.className = 'profile-item';
            div.innerHTML = '<span class="name">' + esc(p.name) + '</span><span class="date">' + (p.createdAt || '') + '</span>' +
                '<span class="actions"><button class="act-btn load" title="加载">📂</button><button class="act-btn del" title="删除">🗑</button></span>';
            div.querySelector('.load').addEventListener('click', (e) => { e.stopPropagation(); post({ type: 'profile.load', name: p.name }); });
            div.querySelector('.del').addEventListener('click', (e) => { e.stopPropagation(); if (confirm('删除方案 "' + p.name + '"?')) post({ type: 'profile.delete', name: p.name }); });
            list.appendChild(div);
        });
    }

    // ===== 快捷指令 =====
    let quickCmds = [];
    $('addQuickCmd').addEventListener('click', () => {
        const v = $('quickCmdInput').value.trim();
        if (v && !quickCmds.includes(v)) { quickCmds.push(v); renderQuickCmds(); $('quickCmdInput').value = ''; }
    });
    $('quickCmdInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addQuickCmd').click(); });

    function renderQuickCmds() {
        const list = $('quickCmdList');
        list.innerHTML = '';
        quickCmds.forEach((cmd, i) => {
            const div = document.createElement('div');
            div.className = 'cmd-item';
            div.innerHTML = '<span class="cmd-text">' + esc(cmd) + '</span><button class="cmd-rm">×</button>';
            div.querySelector('.cmd-text').addEventListener('click', () => { $('sInput').value = cmd; $('serialSend').click(); });
            div.querySelector('.cmd-rm').addEventListener('click', (e) => { e.stopPropagation(); quickCmds.splice(i, 1); renderQuickCmds(); });
            list.appendChild(div);
        });
    }

    // ===== 打开面板 =====
    $('openPanel').addEventListener('click', () => post({ type: 'openMainPanel' }));

    // ===== 消息处理 =====
    window.addEventListener('message', (e) => {
        const msg = e.data;
        switch (msg.type) {
            case 'serial.ports': {
                const sel = $('sPort');
                sel.innerHTML = '';
                if (!msg.ports.length) { sel.innerHTML = '<option>未发现串口</option>'; return; }
                msg.ports.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.path;
                    opt.textContent = p.manufacturer ? p.path + ' - ' + p.manufacturer : p.path;
                    sel.appendChild(opt);
                });
                break;
            }
            case 'serial.connected':
                $('serialConnect').textContent = '断开';
                $('serialConnect').classList.replace('primary', 'danger');
                $('serialDot').classList.add('connected');
                break;
            case 'serial.disconnected':
                $('serialConnect').textContent = '连接';
                $('serialConnect').classList.replace('danger', 'primary');
                $('serialDot').classList.remove('connected');
                break;
            case 'serial.stats':
                $('serialStats').textContent = 'RX: ' + fmtBytes(msg.rxBytes) + ' | TX: ' + fmtBytes(msg.txBytes);
                break;
            case 'serial.error':
                // 可以用 vscode 通知，这里简单 alert
                console.warn('Serial:', msg.message);
                break;

            case 'mqtt.connected':
                $('mqttConnect').textContent = '断开';
                $('mqttConnect').classList.replace('primary', 'danger');
                $('mqttDot').classList.add('connected');
                break;
            case 'mqtt.disconnected':
                $('mqttConnect').textContent = '连接';
                $('mqttConnect').classList.replace('danger', 'primary');
                $('mqttDot').classList.remove('connected');
                subs.clear();
                renderSubTags();
                break;
            case 'mqtt.subscribed':
                subs.set(msg.subscription.topic, msg.subscription.qos);
                renderSubTags();
                break;
            case 'mqtt.unsubscribed':
                subs.delete(msg.topic);
                renderSubTags();
                break;
            case 'mqtt.error':
                console.warn('MQTT:', msg.message);
                break;

            case 'bridge.started':
                $('bridgeStart').disabled = true;
                $('bridgeStop').disabled = false;
                $('bridgeStats').textContent = '状态: 活跃 | 已转发: 0';
                break;
            case 'bridge.stopped':
                $('bridgeStart').disabled = false;
                $('bridgeStop').disabled = true;
                $('bridgeStats').textContent = '状态: 未启动 | 已转发: 0';
                break;
            case 'bridge.forward':
                $('bridgeStats').textContent = '状态: 活跃 | 已转发: ' + msg.count;
                break;
            case 'bridge.error':
                console.warn('Bridge:', msg.message);
                break;

            case 'profile.list':
                renderProfiles(msg.profiles);
                break;
            case 'profile.loaded': {
                const p = msg.profile;
                if (p.serial) {
                    const s = p.serial;
                    $('sBaud').value = s.baudRate;
                    $('sDataBits').value = s.dataBits;
                    $('sStopBits').value = s.stopBits;
                    $('sParity').value = s.parity;
                    $('sDtr').checked = s.dtr;
                    $('sRts').checked = s.rts;
                    $('sFlow').value = s.rtscts ? 'rtscts' : (s.xon ? 'xonxoff' : 'none');
                }
                if (p.mqtt) {
                    const m = p.mqtt;
                    $('mProtocol').value = m.protocol;
                    $('mBroker').value = m.broker;
                    $('mPort').value = m.port;
                    $('mClientId').value = m.clientId || '';
                    $('mUsername').value = m.username || '';
                    $('mPassword').value = m.password || '';
                    $('mClean').checked = m.cleanSession;
                    $('mKeepAlive').value = m.keepAlive;
                    $('mReconnect').checked = m.reconnect;
                    $('wTopic').value = m.willTopic || '';
                    $('wPayload').value = m.willPayload || '';
                    $('wQos').value = m.willQos;
                    $('wRetain').checked = m.willRetain;
                }
                if (p.bridge) {
                    const b = p.bridge;
                    $('bS2M').checked = b.serialToMqtt;
                    $('bM2S').checked = b.mqttToSerial;
                    $('bS2MTopic').value = b.serialToMqttTopic;
                    $('bM2STopic').value = b.mqttToSerialTopic;
                    $('bTransform').value = b.transform;
                }
                break;
            }
            case 'defaults': {
                if (msg.serial) {
                    $('sBaud').value = msg.serial.baudRate;
                    $('sDataBits').value = msg.serial.dataBits;
                    $('sStopBits').value = msg.serial.stopBits;
                    $('sParity').value = msg.serial.parity;
                    $('sDtr').checked = msg.serial.dtr;
                    $('sRts').checked = msg.serial.rts;
                }
                if (msg.mqtt) {
                    $('mProtocol').value = msg.mqtt.protocol;
                    $('mBroker').value = msg.mqtt.broker;
                    $('mPort').value = msg.mqtt.port;
                    $('mKeepAlive').value = msg.mqtt.keepAlive;
                    $('mClean').checked = msg.mqtt.cleanSession;
                    $('mReconnect').checked = msg.mqtt.reconnect;
                }
                if (msg.bridge) {
                    $('bS2MTopic').value = msg.bridge.serialToMqttTopic;
                    $('bM2STopic').value = msg.bridge.mqttToSerialTopic;
                }
                break;
            }
        }
    });

    function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function fmtBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }

    // 初始化
    post({ type: 'serial.listPorts' });
    post({ type: 'profile.list' });
})();
