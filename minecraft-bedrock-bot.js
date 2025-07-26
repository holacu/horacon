const bedrock = require('bedrock-protocol');
const { EventEmitter } = require('events');

class MinecraftBedrockBot extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.client = null;
        this.isConnected = false;
        this.connectionTime = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 ثواني
        this.shouldReconnect = true; // للتحكم في إعادة الاتصال
        this.reconnectTimeout = null; // لحفظ timeout إعادة الاتصال
        this.playerInfo = {};
    }

    async connect() {
        try {
            console.log(`🔄 محاولة الاتصال بسيرفر Bedrock: ${this.config.host}:${this.config.port}`);
            
            const clientOptions = {
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                version: this.config.version,
                offline: true, // للسيرفرات التي لا تتطلب مصادقة Xbox Live
                skipPing: true, // تخطي ping للاتصال السريع
                keepAlive: true,
                connectTimeout: 10000, // 10 ثواني timeout
                onMsaCode: (data) => {
                    console.log(`🔐 كود المصادقة: ${data.user_code}`);
                    console.log(`🌐 اذهب إلى: ${data.verification_uri}`);
                }
            };

            // إضافة مصادقة Xbox Live إذا كانت متطلبة
            if (this.config.xboxAuth) {
                clientOptions.offline = false;
                clientOptions.authTitle = '00000000441cc96b'; // Minecraft Bedrock Edition
            }

            this.client = bedrock.createClient(clientOptions);
            this.setupEventHandlers();
            
        } catch (error) {
            console.error(`❌ خطأ في إنشاء البوت Bedrock: ${error.message}`);
            this.emit('error', error);
        }
    }

    setupEventHandlers() {
        // عند الاتصال بنجاح
        this.client.on('join', () => {
            console.log(`✅ تم الاتصال بنجاح بسيرفر Bedrock ${this.config.host}:${this.config.port}`);
            this.isConnected = true;
            this.connectionTime = new Date();
            this.reconnectAttempts = 0;
            this.emit('connected', {
                server: `${this.config.host}:${this.config.port}`,
                username: this.config.username,
                version: this.config.version
            });
        });

        // عند دخول العالم
        this.client.on('spawn', () => {
            console.log(`🌍 دخل البوت ${this.config.username} إلى عالم Bedrock`);
            this.emit('spawned', {
                position: this.playerInfo.position || { x: 0, y: 0, z: 0 },
                health: this.playerInfo.health || 20
            });
        });

        // عند استقبال رسالة في الشات
        this.client.on('text', (packet) => {
            if (packet.type === 'chat' && packet.source_name !== this.config.username) {
                console.log(`💬 ${packet.source_name}: ${packet.message}`);
                this.emit('chat', { 
                    username: packet.source_name, 
                    message: packet.message 
                });
            }
        });

        // عند تحديث موقع اللاعب
        this.client.on('move_player', (packet) => {
            if (packet.runtime_id === this.client.entityId) {
                this.playerInfo.position = {
                    x: packet.position.x,
                    y: packet.position.y,
                    z: packet.position.z
                };
                this.emit('position', this.playerInfo.position);
            }
        });

        // عند تحديث الصحة
        this.client.on('set_health', (packet) => {
            this.playerInfo.health = packet.health;
            this.emit('health', {
                health: packet.health
            });
        });

        // عند حدوث خطأ
        this.client.on('error', (err) => {
            // تجاهل أخطاء "Connect timed out" لأنها مزعجة ولا تفيد
            if (err.message && err.message.includes('Connect timed out')) {
                // لا نطبع شيئاً ولا نرسل إشعار
                this.isConnected = false;
                this.handleReconnect();
                return;
            }

            // طباعة الأخطاء الأخرى فقط
            console.error(`❌ خطأ في البوت Bedrock: ${err.message}`);
            this.isConnected = false;
            this.emit('error', err);

            // محاولة إعادة الاتصال
            this.handleReconnect();
        });

        // عند انقطاع الاتصال
        this.client.on('close', () => {
            console.log(`🔌 السيرفر ${this.config.host}:${this.config.port} مطفي أو غير متصل`);
            this.isConnected = false;
            this.emit('disconnected', {
                connectionTime: this.connectionTime,
                disconnectionTime: new Date()
            });

            // محاولة إعادة الاتصال
            this.handleReconnect();
        });

        // عند الركل من السيرفر
        this.client.on('disconnect', (packet) => {
            const reason = packet.message || 'سبب غير معروف';
            console.log(`👢 تم ركل البوت من سيرفر Bedrock: ${reason}`);

            // تحديد نوع الانقطاع
            const isServerDown = this.isServerDownReason(reason);

            this.emit('kicked', {
                reason: reason,
                isServerDown: isServerDown
            });
        });

        // عند استقبال معلومات السيرفر
        this.client.on('server_to_client_handshake', () => {
            console.log(`🤝 تم تأسيس الاتصال مع سيرفر Bedrock`);
        });

        // عند استقبال معلومات العالم
        this.client.on('start_game', (packet) => {
            console.log(`🎮 بدء اللعبة في عالم Bedrock`);
            this.playerInfo.gameMode = packet.player_gamemode;
            this.playerInfo.dimension = packet.dimension;
            this.emit('gameStart', {
                gameMode: packet.player_gamemode,
                dimension: packet.dimension,
                worldName: packet.level_id
            });
        });

        // عند تغيير وضع اللعبة
        this.client.on('set_player_game_type', (packet) => {
            this.playerInfo.gameMode = packet.gamemode;
            this.emit('gameModeChange', { gameMode: packet.gamemode });
        });

        // عند استقبال معلومات اللاعبين
        this.client.on('player_list', (packet) => {
            if (packet.type === 'add') {
                packet.records.forEach(player => {
                    console.log(`👤 انضم لاعب جديد: ${player.username}`);
                    this.emit('playerJoin', { username: player.username, uuid: player.uuid });
                });
            } else if (packet.type === 'remove') {
                packet.records.forEach(player => {
                    console.log(`👋 غادر لاعب: ${player.uuid}`);
                    this.emit('playerLeave', { uuid: player.uuid });
                });
            }
        });
    }

    handleReconnect() {
        if (!this.shouldReconnect) {
            console.log(`🛑 تم إيقاف إعادة الاتصال للبوت ${this.config.username}`);
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log(`❌ السيرفر ${this.config.host}:${this.config.port} مطفي - فشل الاتصال بعد ${this.maxReconnectAttempts} محاولات`);
            this.emit('reconnectFailed');
            return;
        }

        this.reconnectAttempts++;
        console.log(`🔄 محاولة إعادة الاتصال بسيرفر Bedrock ${this.reconnectAttempts}/${this.maxReconnectAttempts} خلال ${this.reconnectDelay/1000} ثواني...`);

        this.reconnectTimeout = setTimeout(() => {
            if (this.shouldReconnect) {
                this.connect();
            }
        }, this.reconnectDelay);
    }

    // إيقاف محاولات إعادة الاتصال
    stopReconnecting() {
        this.shouldReconnect = false;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        console.log(`🛑 تم إيقاف محاولات إعادة الاتصال للبوت ${this.config.username}`);
    }

    // قطع الاتصال نهائياً
    forceDisconnect() {
        this.stopReconnecting();
        if (this.client) {
            this.client.close();
        }
        this.isConnected = false;
        console.log(`🔌 قطع الاتصال نهائياً مع البوت ${this.config.username}`);
    }

    // إرسال رسالة في الشات
    sendMessage(message) {
        if (this.isConnected && this.client) {
            try {
                this.client.write('text', {
                    type: 'chat',
                    needs_translation: false,
                    source_name: this.config.username,
                    message: message,
                    parameters: [],
                    xuid: '',
                    platform_chat_id: ''
                });
                console.log(`📤 تم إرسال رسالة Bedrock: ${message}`);
                return true;
            } catch (error) {
                console.error(`❌ خطأ في إرسال الرسالة: ${error.message}`);
                return false;
            }
        }
        return false;
    }

    // تنفيذ أمر
    executeCommand(command) {
        if (this.isConnected && this.client) {
            try {
                this.client.write('command_request', {
                    command: `/${command}`,
                    origin: {
                        type: 'player',
                        uuid: this.client.profile?.uuid || '',
                        request_id: ''
                    },
                    internal: false,
                    version: 1
                });
                console.log(`⚡ تم تنفيذ أمر Bedrock: /${command}`);
                return true;
            } catch (error) {
                console.error(`❌ خطأ في تنفيذ الأمر: ${error.message}`);
                return false;
            }
        }
        return false;
    }

    // الحصول على معلومات البوت
    getInfo() {
        if (!this.isConnected || !this.client) {
            return {
                connected: false,
                username: this.config.username,
                server: `${this.config.host}:${this.config.port}`,
                edition: 'bedrock'
            };
        }

        return {
            connected: true,
            username: this.config.username,
            server: `${this.config.host}:${this.config.port}`,
            version: this.config.version,
            edition: 'bedrock',
            position: this.playerInfo.position || { x: 0, y: 0, z: 0 },
            health: this.playerInfo.health || 20,
            gameMode: this.playerInfo.gameMode || 0,
            dimension: this.playerInfo.dimension || 0,
            connectionTime: this.connectionTime,
            uptime: this.connectionTime ? Date.now() - this.connectionTime.getTime() : 0
        };
    }

    // قطع الاتصال
    disconnect() {
        if (this.client) {
            console.log(`🔌 قطع الاتصال مع البوت Bedrock ${this.config.username}`);
            try {
                this.client.disconnect('تم إيقاف البوت');
            } catch (error) {
                console.error(`خطأ في قطع الاتصال: ${error.message}`);
            }
            this.client = null;
            this.isConnected = false;
            this.connectionTime = null;
            this.reconnectAttempts = this.maxReconnectAttempts; // منع إعادة الاتصال التلقائي
        }
    }

    // تحديث إعدادات البوت
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    // فحص حالة الاتصال
    isAlive() {
        return this.isConnected && this.client;
    }

    // الحصول على إحصائيات الأداء
    getPerformanceStats() {
        if (!this.isConnected || !this.client) {
            return null;
        }

        return {
            memoryUsage: process.memoryUsage(),
            uptime: this.connectionTime ? Date.now() - this.connectionTime.getTime() : 0,
            packetsReceived: this.client.packetsReceived || 0,
            packetsSent: this.client.packetsSent || 0
        };
    }

    // تحديد ما إذا كان سبب الانقطاع يعني أن السيرفر مطفي
    isServerDownReason(reason) {
        if (!reason) return true;

        const serverDownReasons = [
            'connection timed out',
            'connection refused',
            'network unreachable',
            'host unreachable',
            'no route to host',
            'connection reset',
            'server closed',
            'timeout'
        ];

        const reasonLower = reason.toLowerCase();

        // إذا كان السبب يحتوي على أي من أسباب إغلاق السيرفر
        for (const serverReason of serverDownReasons) {
            if (reasonLower.includes(serverReason)) {
                return true;
            }
        }

        // أسباب أخرى لا تعني أن السيرفر مطفي
        const notServerDownReasons = [
            'please log into xbox',
            'loggedinotherlocation',
            'logged in other location',
            'authentication',
            'xbox live',
            'microsoft account',
            'premium account',
            'whitelist',
            'banned',
            'kicked',
            'full server'
        ];

        for (const notServerReason of notServerDownReasons) {
            if (reasonLower.includes(notServerReason)) {
                return false; // السيرفر شغال لكن هناك مشكلة أخرى
            }
        }

        // افتراضياً، إذا لم نتمكن من تحديد السبب، نعتبر أن السيرفر مطفي
        return true;
    }
}

module.exports = MinecraftBedrockBot;
