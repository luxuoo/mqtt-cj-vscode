// @ts-nocheck
(function () {
    var vscode;
    try { vscode = acquireVsCodeApi(); } catch (e) { vscode = { postMessage: function(){} }; }
    function post(msg) { try { vscode.postMessage(msg); } catch(e) { console.error('post error', e); } }
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function fmtBytes(b) {
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }
    function val(id) { var el = $(id); return el ? el.value : ''; }
    function checked(id) { var el = $(id); return el ? el.checked : false; }
    function num(id) { return parseInt(val(id)) || 0; }

    // ===== 折叠切换 =====
    document.querySelectorAll('.section-title').forEach(function(title) {
        title.addEventListener('click', function() {
            var key = title.getAttribute('data-toggle');
            var body = document.getElementById(key + 'Body');
            if (!body) return;
            var collapsed = body.classList.toggle('collapsed');
            title.classList.toggle('open', !collapsed);
        });
    });

    // ===== 串口 =====
    var sPort = $('sPort'), sBaud = $('sBaud'), sDataBits = $('sDataBits');
    var sStopBits = $('sStopBits'), sParity = $('sParity'), sFlow = $('sFlow');
    var sDtr = $('sDtr'), sRts = $('sRts'), sInput = $('sInput');
    var sLineEnding = $('sLineEnding'), serialConnect = $('serialConnect');
    var serialStats = $('serialStats'), serialDot = $('serialDot');
    var serialState = 'disconnected';

    function setSerialState(state) {
        serialState = state;
        if (!serialConnect) return;
        switch (state) {
            case 'connecting':
                serialConnect.textContent = '连接中...';
                serialConnect.className = 'btn primary full';
                serialConnect.disabled = true;
                break;
            case 'connected':
                serialConnect.textContent = '断开';
                serialConnect.className = 'btn danger full';
                serialConnect.disabled = false;
                break;
            case 'disconnected':
            default:
                serialConnect.textContent = '连接';
                serialConnect.className = 'btn primary full';
                serialConnect.disabled = false;
                break;
        }
    }

    $('refreshPorts').addEventListener('click', function() { post({ type: 'serial.listPorts' }); });

    if (serialConnect) serialConnect.addEventListener('click', function() {
        if (serialState === 'connected') {
            setSerialState('disconnected');
            post({ type: 'serial.disconnect' });
        } else if (serialState === 'disconnected') {
            var port = val('sPort');
            if (!port) return;
            setSerialState('connecting');
            var flow = val('sFlow');
            post({
                type: 'serial.connect',
                config: {
                    port: port, baudRate: num('sBaud'), dataBits: num('sDataBits'),
                    stopBits: parseFloat(val('sStopBits')) || 1, parity: val('sParity'),
                    rtscts: flow === 'rtscts', xon: flow === 'xonxoff', xoff: flow === 'xonxoff',
                    dtr: checked('sDtr'), rts: checked('sRts')
                }
            });
        }
    });

    if ($('sDtr')) $('sDtr').addEventListener('change', function(e) { post({ type: 'serial.setDtr', value: e.target.checked }); });
    if ($('sRts')) $('sRts').addEventListener('change', function(e) { post({ type: 'serial.setRts', value: e.target.checked }); });

    if ($('serialSend')) $('serialSend').addEventListener('click', function() {
        var data = val('sInput');
        if (!data) return;
        var modeEl = document.querySelector('input[name="sMode"]:checked');
        post({ type: 'serial.send', data: data, mode: modeEl ? modeEl.value : 'ascii', lineEnding: val('sLineEnding') });
    });
    if (sInput) sInput.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter' && $('serialSend')) $('serialSend').click();
    });

    // ===== MQTT =====
    var mqttConnect = $('mqttConnect'), mqttDot = $('mqttDot');
    var subTopic = $('subTopic'), pubTopic = $('pubTopic'), pubPayload = $('pubPayload');

    if (mqttConnect) mqttConnect.addEventListener('click', function() {
        if (mqttConnect.textContent === '连接') {
            post({
                type: 'mqtt.connect',
                config: {
                    protocol: val('mProtocol'), broker: val('mBroker'), port: num('mPort'),
                    clientId: val('mClientId'), username: val('mUsername') || undefined,
                    password: val('mPassword') || undefined, cleanSession: checked('mClean'),
                    keepAlive: num('mKeepAlive'), reconnect: checked('mReconnect'), reconnectInterval: 5000,
                    willTopic: val('wTopic') || undefined, willPayload: val('wPayload') || undefined,
                    willQos: num('wQos'), willRetain: checked('wRetain')
                }
            });
        } else {
            post({ type: 'mqtt.disconnect' });
        }
    });

    if ($('mqttSub')) $('mqttSub').addEventListener('click', function() {
        var topic = val('subTopic').trim();
        if (!topic) return;
        post({ type: 'mqtt.subscribe', topic: topic, qos: num('subQos') });
        if (subTopic) subTopic.value = '';
    });
    if (subTopic) subTopic.addEventListener('keydown', function(e) { if (e.key === 'Enter' && $('mqttSub')) $('mqttSub').click(); });

    if ($('mqttPub')) $('mqttPub').addEventListener('click', function() {
        var topic = val('pubTopic').trim();
        if (!topic) return;
        post({ type: 'mqtt.publish', topic: topic, payload: val('pubPayload'), qos: num('pubQos'), retain: checked('pubRetain') });
    });
    if (pubPayload) pubPayload.addEventListener('keydown', function(e) { if (e.ctrlKey && e.key === 'Enter' && $('mqttPub')) $('mqttPub').click(); });

    var subs = new Map();
    function renderSubTags() {
        var c = $('subTags');
        if (!c) return;
        c.innerHTML = '';
        subs.forEach(function(qos, topic) {
            var tag = document.createElement('span');
            tag.className = 'tag';
            tag.innerHTML = esc(topic) + ' Q' + qos + ' <span class="rm">×</span>';
            tag.querySelector('.rm').addEventListener('click', function() { post({ type: 'mqtt.unsubscribe', topic: topic }); });
            c.appendChild(tag);
        });
    }

    // ===== 桥接 =====
    if ($('bridgeStart')) $('bridgeStart').addEventListener('click', function() {
        post({
            type: 'bridge.start',
            config: {
                serialToMqtt: checked('bS2M'), mqttToSerial: checked('bM2S'),
                serialToMqttTopic: val('bS2MTopic'), mqttToSerialTopic: val('bM2STopic'),
                transform: val('bTransform')
            }
        });
    });
    if ($('bridgeStop')) $('bridgeStop').addEventListener('click', function() { post({ type: 'bridge.stop' }); });

    // ===== 配置方案 =====
    var profileName = $('profileName');
    var profileSave = $('profileSave');

    if (profileSave) profileSave.addEventListener('click', function() {
        var name = val('profileName').trim();
        if (!name) { return; }
        var flow = val('sFlow');
        post({
            type: 'profile.save', name: name,
            data: {
                serial: {
                    port: val('sPort'), baudRate: num('sBaud'), dataBits: num('sDataBits'),
                    stopBits: parseFloat(val('sStopBits')) || 1, parity: val('sParity'),
                    rtscts: flow === 'rtscts', xon: flow === 'xonxoff', xoff: flow === 'xonxoff',
                    dtr: checked('sDtr'), rts: checked('sRts')
                },
                mqtt: {
                    protocol: val('mProtocol'), broker: val('mBroker'), port: num('mPort'),
                    clientId: val('mClientId'), username: val('mUsername') || undefined,
                    password: val('mPassword') || undefined, cleanSession: checked('mClean'),
                    keepAlive: num('mKeepAlive'), reconnect: checked('mReconnect'), reconnectInterval: 5000,
                    willTopic: val('wTopic') || undefined, willPayload: val('wPayload') || undefined,
                    willQos: num('wQos'), willRetain: checked('wRetain')
                },
                bridge: {
                    serialToMqtt: checked('bS2M'), mqttToSerial: checked('bM2S'),
                    serialToMqttTopic: val('bS2MTopic'), mqttToSerialTopic: val('bM2STopic'),
                    transform: val('bTransform')
                }
            }
        });
        if (profileName) profileName.value = '';
    });
    if (profileName) profileName.addEventListener('keydown', function(e) { if (e.key === 'Enter' && profileSave) profileSave.click(); });

    function renderProfiles(profiles) {
        var list = $('profileList');
        if (!list) return;
        list.innerHTML = '';
        if (!profiles || !profiles.length) {
            list.innerHTML = '<div style="opacity:0.5;font-size:11px;padding:4px">暂无方案</div>';
            return;
        }
        profiles.forEach(function(p) {
            var div = document.createElement('div');
            div.className = 'profile-item';
            var nameSpan = document.createElement('span');
            nameSpan.className = 'name';
            nameSpan.textContent = p.name;
            var dateSpan = document.createElement('span');
            dateSpan.className = 'date';
            dateSpan.textContent = p.createdAt || '';
            var actions = document.createElement('span');
            actions.className = 'actions';
            var loadBtn = document.createElement('button');
            loadBtn.className = 'act-btn';
            loadBtn.textContent = '\u{1F4C2}';
            loadBtn.title = '加载';
            loadBtn.addEventListener('click', function(e) { e.stopPropagation(); post({ type: 'profile.load', name: p.name }); });
            var delBtn = document.createElement('button');
            delBtn.className = 'act-btn';
            delBtn.textContent = '\u{1F5D1}';
            delBtn.title = '删除';
            delBtn.addEventListener('click', function(e) { e.stopPropagation(); post({ type: 'profile.delete', name: p.name }); });
            actions.appendChild(loadBtn);
            actions.appendChild(delBtn);
            div.appendChild(nameSpan);
            div.appendChild(dateSpan);
            div.appendChild(actions);
            list.appendChild(div);
        });
    }

    // ===== 快捷指令 =====
    var quickCmds = [];
    if ($('addQuickCmd')) $('addQuickCmd').addEventListener('click', function() {
        var v = val('quickCmdInput').trim();
        if (v && quickCmds.indexOf(v) === -1) { quickCmds.push(v); renderQuickCmds(); if ($('quickCmdInput')) $('quickCmdInput').value = ''; }
    });
    if ($('quickCmdInput')) $('quickCmdInput').addEventListener('keydown', function(e) { if (e.key === 'Enter' && $('addQuickCmd')) $('addQuickCmd').click(); });

    function renderQuickCmds() {
        var list = $('quickCmdList');
        if (!list) return;
        list.innerHTML = '';
        quickCmds.forEach(function(cmd, i) {
            var div = document.createElement('div');
            div.className = 'cmd-item';
            var textSpan = document.createElement('span');
            textSpan.className = 'cmd-text';
            textSpan.textContent = cmd;
            textSpan.addEventListener('click', function() { if ($('sInput')) $('sInput').value = cmd; if ($('serialSend')) $('serialSend').click(); });
            var rmBtn = document.createElement('button');
            rmBtn.className = 'cmd-rm';
            rmBtn.textContent = '×';
            rmBtn.addEventListener('click', function(e) { e.stopPropagation(); quickCmds.splice(i, 1); renderQuickCmds(); });
            div.appendChild(textSpan);
            div.appendChild(rmBtn);
            list.appendChild(div);
        });
    }

    // ===== 打开面板 =====
    if ($('openPanel')) $('openPanel').addEventListener('click', function() { post({ type: 'openMainPanel' }); });

    // ===== 消息处理 =====
    window.addEventListener('message', function(e) {
        var msg = e.data;
        if (!msg || !msg.type) return;
        try {
            switch (msg.type) {
                case 'serial.ports': {
                    var sel = $('sPort');
                    if (!sel) break;
                    var prevPort = sel.value;
                    sel.innerHTML = '';
                    if (!msg.ports || !msg.ports.length) { sel.innerHTML = '<option>未发现串口</option>'; return; }
                    msg.ports.forEach(function(p) {
                        var opt = document.createElement('option');
                        opt.value = p.path;
                        opt.textContent = p.manufacturer ? p.path + ' - ' + p.manufacturer : p.path;
                        if (p.path === prevPort) opt.selected = true;
                        sel.appendChild(opt);
                    });
                    break;
                }
                case 'serial.connected':
                    setSerialState('connected');
                    if (serialDot) serialDot.classList.add('connected');
                    break;
                case 'serial.disconnected':
                    setSerialState('disconnected');
                    if (serialDot) serialDot.classList.remove('connected');
                    break;
                case 'serial.stats':
                    if (serialStats) serialStats.textContent = 'RX: ' + fmtBytes(msg.rxBytes) + ' | TX: ' + fmtBytes(msg.txBytes);
                    break;
                case 'serial.error':
                    if (serialState === 'connecting') setSerialState('disconnected');
                    console.warn('Serial:', msg.message);
                    break;

                case 'mqtt.connected':
                    if (mqttConnect) { mqttConnect.textContent = '断开'; mqttConnect.classList.replace('primary', 'danger'); }
                    if (mqttDot) mqttDot.classList.add('connected');
                    break;
                case 'mqtt.disconnected':
                    if (mqttConnect) { mqttConnect.textContent = '连接'; mqttConnect.classList.replace('danger', 'primary'); }
                    if (mqttDot) mqttDot.classList.remove('connected');
                    subs.clear(); renderSubTags();
                    break;
                case 'mqtt.subscribed':
                    subs.set(msg.subscription.topic, msg.subscription.qos);
                    renderSubTags();
                    break;
                case 'mqtt.unsubscribed':
                    subs.delete(msg.topic); renderSubTags();
                    break;
                case 'mqtt.error':
                    console.warn('MQTT:', msg.message);
                    break;

                case 'bridge.started':
                    if ($('bridgeStart')) $('bridgeStart').disabled = true;
                    if ($('bridgeStop')) $('bridgeStop').disabled = false;
                    if ($('bridgeStats')) $('bridgeStats').textContent = '状态: 活跃 | 已转发: 0';
                    break;
                case 'bridge.stopped':
                    if ($('bridgeStart')) $('bridgeStart').disabled = false;
                    if ($('bridgeStop')) $('bridgeStop').disabled = true;
                    if ($('bridgeStats')) $('bridgeStats').textContent = '状态: 未启动 | 已转发: 0';
                    break;
                case 'bridge.forward':
                    if ($('bridgeStats')) $('bridgeStats').textContent = '状态: 活跃 | 已转发: ' + msg.count;
                    break;
                case 'bridge.error':
                    console.warn('Bridge:', msg.message);
                    break;

                case 'profile.list':
                    renderProfiles(msg.profiles);
                    break;
                case 'profile.loaded': {
                    var p = msg.profile;
                    if (p.serial) {
                        var s = p.serial;
                        if ($('sBaud')) $('sBaud').value = s.baudRate;
                        if ($('sDataBits')) $('sDataBits').value = s.dataBits;
                        if ($('sStopBits')) $('sStopBits').value = s.stopBits;
                        if ($('sParity')) $('sParity').value = s.parity;
                        if ($('sDtr')) $('sDtr').checked = s.dtr;
                        if ($('sRts')) $('sRts').checked = s.rts;
                        if ($('sFlow')) $('sFlow').value = s.rtscts ? 'rtscts' : (s.xon ? 'xonxoff' : 'none');
                    }
                    if (p.mqtt) {
                        var m = p.mqtt;
                        if ($('mProtocol')) $('mProtocol').value = m.protocol;
                        if ($('mBroker')) $('mBroker').value = m.broker;
                        if ($('mPort')) $('mPort').value = m.port;
                        if ($('mClientId')) $('mClientId').value = m.clientId || '';
                        if ($('mUsername')) $('mUsername').value = m.username || '';
                        if ($('mPassword')) $('mPassword').value = m.password || '';
                        if ($('mClean')) $('mClean').checked = m.cleanSession;
                        if ($('mKeepAlive')) $('mKeepAlive').value = m.keepAlive;
                        if ($('mReconnect')) $('mReconnect').checked = m.reconnect;
                        if ($('wTopic')) $('wTopic').value = m.willTopic || '';
                        if ($('wPayload')) $('wPayload').value = m.willPayload || '';
                        if ($('wQos')) $('wQos').value = m.willQos;
                        if ($('wRetain')) $('wRetain').checked = m.willRetain;
                    }
                    if (p.bridge) {
                        var b = p.bridge;
                        if ($('bS2M')) $('bS2M').checked = b.serialToMqtt;
                        if ($('bM2S')) $('bM2S').checked = b.mqttToSerial;
                        if ($('bS2MTopic')) $('bS2MTopic').value = b.serialToMqttTopic;
                        if ($('bM2STopic')) $('bM2STopic').value = b.mqttToSerialTopic;
                        if ($('bTransform')) $('bTransform').value = b.transform;
                    }
                    break;
                }
                case 'defaults': {
                    if (msg.serial) {
                        if ($('sBaud')) $('sBaud').value = msg.serial.baudRate;
                        if ($('sDataBits')) $('sDataBits').value = msg.serial.dataBits;
                        if ($('sStopBits')) $('sStopBits').value = msg.serial.stopBits;
                        if ($('sParity')) $('sParity').value = msg.serial.parity;
                        if ($('sDtr')) $('sDtr').checked = msg.serial.dtr;
                        if ($('sRts')) $('sRts').checked = msg.serial.rts;
                    }
                    if (msg.mqtt) {
                        if ($('mProtocol')) $('mProtocol').value = msg.mqtt.protocol;
                        if ($('mBroker')) $('mBroker').value = msg.mqtt.broker;
                        if ($('mPort')) $('mPort').value = msg.mqtt.port;
                        if ($('mKeepAlive')) $('mKeepAlive').value = msg.mqtt.keepAlive;
                        if ($('mClean')) $('mClean').checked = msg.mqtt.cleanSession;
                        if ($('mReconnect')) $('mReconnect').checked = msg.mqtt.reconnect;
                    }
                    if (msg.bridge) {
                        if ($('bS2MTopic')) $('bS2MTopic').value = msg.bridge.serialToMqttTopic;
                        if ($('bM2STopic')) $('bM2STopic').value = msg.bridge.mqttToSerialTopic;
                    }
                    break;
                }
            }
        } catch (err) {
            console.error('Message handler error:', err, msg);
        }
    });

    // ===== 初始化 =====
    post({ type: 'serial.listPorts' });
    post({ type: 'profile.list' });
    // 请求当前状态（同步主面板等其他视图的状态）
    setTimeout(() => post({ type: 'getState' }), 100);
})();
