const mineflayer = require('mineflayer');
const { EventEmitter } = require('events');

class MinecraftJavaBot extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.bot = null;
        this.isConnected = false;
        this.connectionTime = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 ثواني
        this.shouldReconnect = true; // للتحكم في إعادة الاتصال
        this.reconnectTimeout = null; // لحفظ timeout إعادة الاتصال
    }

    async connect() {
        try {
            console.log(`🔄 محاولة الاتصال بسيرفر Java: ${this.config.host}:${this.config.port}`);
            
            const botOptions = {
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                version: this.config.version,
                auth: 'offline', // للسيرفرات التي لا تتطلب مصادقة
                hideErrors: false,
                checkTimeoutInterval: 30000, // 30 ثانية
                keepAlive: true,
                respawn: true,
                skipValidation: true, // تخطي التحقق من الإصدار
                connect: (client) => {
                    console.log(`🔗 محاولة الاتصال بـ ${this.config.host}:${this.config.port}`);
                }
            };

            // إضافة كلمة مرور إذا كانت متوفرة
            if (this.config.password) {
                botOptions.password = this.config.password;
                botOptions.auth = 'microsoft'; // أو 'mojang' حسب نوع الحساب
            }

            this.bot = mineflayer.createBot(botOptions);
            this.setupEventHandlers();
            
        } catch (error) {
            console.error(`❌ خطأ في إنشاء البوت: ${error.message}`);
            this.emit('error', error);
        }
    }

    setupEventHandlers() {
        // عند الاتصال بنجاح
        this.bot.on('login', () => {
            console.log(`✅ تم الاتصال بنجاح بسيرفر ${this.config.host}:${this.config.port}`);
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
        this.bot.on('spawn', () => {
            console.log(`🌍 دخل البوت ${this.config.username} إلى العالم`);
            this.emit('spawned', {
                position: this.bot.entity.position,
                health: this.bot.health,
                food: this.bot.food
            });
        });

        // عند استقبال رسالة في الشات
        this.bot.on('chat', (username, message) => {
            if (username === this.bot.username) return;
            
            console.log(`💬 ${username}: ${message}`);
            this.emit('chat', { username, message });
        });

        // عند حدوث خطأ
        this.bot.on('error', (err) => {
            // تجاهل أخطاء "Connect timed out" لأنها مزعجة ولا تفيد
            if (err.message && err.message.includes('Connect timed out')) {
                // لا نطبع شيئاً ولا نرسل إشعار
                this.isConnected = false;
                this.handleReconnect();
                return;
            }

            // طباعة الأخطاء الأخرى فقط
            console.error(`❌ خطأ في البوت: ${err.message}`);
            this.isConnected = false;
            this.emit('error', err);

            // محاولة إعادة الاتصال
            this.handleReconnect();
        });

        // عند انقطاع الاتصال
        this.bot.on('end', (reason) => {
            console.log(`🔌 السيرفر ${this.config.host}:${this.config.port} مطفي أو غير متصل`);
            this.isConnected = false;
            this.emit('disconnected', {
                reason,
                connectionTime: this.connectionTime,
                disconnectionTime: new Date()
            });

            // محاولة إعادة الاتصال
            this.handleReconnect();
        });

        // عند الموت
        this.bot.on('death', () => {
            console.log(`💀 مات البوت ${this.config.username}`);
            this.emit('death', {
                position: this.bot.entity.position,
                killer: this.bot.lastDamageSource
            });
        });

        // عند الإحياء
        this.bot.on('respawn', () => {
            console.log(`🔄 تم إحياء البوت ${this.config.username}`);
            this.emit('respawn', {
                position: this.bot.entity.position
            });
        });

        // عند تغيير الصحة
        this.bot.on('health', () => {
            this.emit('health', {
                health: this.bot.health,
                food: this.bot.food
            });
        });

        // عند ركل البوت من السيرفر
        this.bot.on('kicked', (reason) => {
            console.log(`👢 تم ركل البوت: ${reason}`);
            this.emit('kicked', { reason });
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
        console.log(`🔄 محاولة إعادة الاتصال ${this.reconnectAttempts}/${this.maxReconnectAttempts} خلال ${this.reconnectDelay/1000} ثواني...`);

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
        if (this.bot) {
            this.bot.quit();
        }
        this.isConnected = false;
        console.log(`🔌 قطع الاتصال نهائياً مع البوت ${this.config.username}`);
    }

    // إرسال رسالة في الشات
    sendMessage(message) {
        if (this.isConnected && this.bot) {
            this.bot.chat(message);
            console.log(`📤 تم إرسال رسالة: ${message}`);
            return true;
        }
        return false;
    }

    // تنفيذ أمر
    executeCommand(command) {
        if (this.isConnected && this.bot) {
            this.bot.chat(`/${command}`);
            console.log(`⚡ تم تنفيذ الأمر: /${command}`);
            return true;
        }
        return false;
    }

    // الحصول على معلومات البوت
    getInfo() {
        if (!this.isConnected || !this.bot) {
            return {
                connected: false,
                username: this.config.username,
                server: `${this.config.host}:${this.config.port}`
            };
        }

        return {
            connected: true,
            username: this.bot.username,
            server: `${this.config.host}:${this.config.port}`,
            version: this.config.version,
            position: this.bot.entity ? this.bot.entity.position : null,
            health: this.bot.health,
            food: this.bot.food,
            experience: this.bot.experience,
            gameMode: this.bot.game ? this.bot.game.gameMode : null,
            dimension: this.bot.game ? this.bot.game.dimension : null,
            connectionTime: this.connectionTime,
            uptime: this.connectionTime ? Date.now() - this.connectionTime.getTime() : 0
        };
    }

    // الحصول على قائمة اللاعبين المتصلين
    getPlayers() {
        if (!this.isConnected || !this.bot) {
            return [];
        }

        return Object.keys(this.bot.players).map(username => ({
            username,
            ping: this.bot.players[username].ping,
            gameMode: this.bot.players[username].gamemode
        }));
    }

    // قطع الاتصال
    disconnect() {
        if (this.bot) {
            console.log(`🔌 قطع الاتصال مع البوت ${this.config.username}`);
            this.bot.quit('تم إيقاف البوت');
            this.bot = null;
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
        return this.isConnected && this.bot && this.bot.entity;
    }

    // الحصول على إحصائيات الأداء
    getPerformanceStats() {
        if (!this.isConnected || !this.bot) {
            return null;
        }

        return {
            ping: this.bot.player ? this.bot.player.ping : null,
            tps: this.bot.getTps ? this.bot.getTps() : null,
            memoryUsage: process.memoryUsage(),
            uptime: this.connectionTime ? Date.now() - this.connectionTime.getTime() : 0
        };
    }
}

module.exports = MinecraftJavaBot;
